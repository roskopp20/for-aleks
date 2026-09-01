const bootEl = document.getElementById("boot");
const bootLog = document.getElementById("bootLog");
const bootSkip = document.getElementById("bootSkip");
const view = document.getElementById("view");
const ctx = view.getContext("2d", { alpha: false });
const spark = document.getElementById("spark");
const sctx = spark.getContext("2d");

const stSpp = document.getElementById("stSpp");
const stRays = document.getElementById("stRays");
const stPaths = document.getElementById("stPaths");
const stRes = document.getElementById("stRes");
const stExplain = document.getElementById("stExplain");
const filmHint = document.getElementById("filmHint");
const stSize = document.getElementById("stSize");
const uvRead = document.getElementById("uvRead");
const eta = document.getElementById("eta");
const etaLabel = document.getElementById("etaLabel");
const etaRead = document.getElementById("etaRead");
const fuzz = document.getElementById("fuzz");
const fuzzLabel = document.getElementById("fuzzLabel");

const mobile = window.matchMedia("(max-width: 900px)").matches || window.innerWidth < 800;
const W = mobile ? 168 : 280;
const H = mobile ? 126 : 210;

view.width = W;
view.height = H;
stRes.textContent = `${W}×${H}`;
stSize.textContent = `${W}×${H} px`;

const scene = {
  left: "glass",
  right: "metal",
  eta: 1.5,
  fuzz: 0.04,
  theta: 0.08,
  phi: 0.0,
  radius: 3.45,
};

let worker = null;
let busy = false;
let booted = false;
let lastT = performance.now();
let rayAcc = 0;
let rayT = 0;
let rps = 0;
const sppHist = [];
let lastSpp = 0;

const bootLines = [
  "For Aleks.",
  "Aim: draw a room with simulated light.",
  "Purpose: this page is a gift. It is for you.",
  "It starts noisy. That is the computer guessing.",
  "Wait a few seconds and it gets sure.",
  "ready.",
];

function typeBoot(done) {
  let i = 0;
  bootLog.textContent = "";
  const id = setInterval(() => {
    if (i >= bootLines.length) {
      clearInterval(id);
      setTimeout(done, 280);
      return;
    }
    bootLog.textContent += bootLines[i] + "\n";
    i++;
  }, 180);
  return () => {
    clearInterval(id);
    done();
  };
}

let cancelBoot = typeBoot(finishBoot);
bootSkip.addEventListener("click", () => {
  cancelBoot();
});
bootEl.addEventListener("click", (e) => {
  if (e.target === bootSkip) return;
  cancelBoot();
});

function finishBoot() {
  if (booted) return;
  booted = true;
  bootEl.classList.add("gone");
  startWorker();
  loop();
}

function startWorker() {
  worker = new Worker("tracer.worker.js");
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type !== "frame") return;
    busy = false;
    const img = new ImageData(new Uint8ClampedArray(m.rgba), m.w, m.h);
    ctx.putImageData(img, 0, 0);
    stSpp.textContent = m.spp.toFixed(1);
    stPaths.textContent = m.paths.toLocaleString();
    if (m.spp < 1.2) {
      stExplain.textContent = "Still guessing the light…";
    } else if (m.spp < 4) {
      stExplain.textContent = "Getting clearer. Keep watching.";
      filmHint.classList.add("hide");
    } else {
      stExplain.textContent = "Pretty sure about the light now. Drag to look around.";
      filmHint.classList.add("hide");
    }
    rayAcc += m.drays;
    const now = performance.now();
    rayT += now - lastT;
    lastT = now;
    if (rayT > 400) {
      rps = (rayAcc / rayT) * 1000;
      rayAcc = 0;
      rayT = 0;
      stRays.textContent = Math.round(rps).toLocaleString();
    }
    if (Math.abs(m.spp - lastSpp) > 0.04) {
      lastSpp = m.spp;
      sppHist.push(m.spp);
      if (sppHist.length > 64) sppHist.shift();
      drawSpark();
    }
  };
  worker.onerror = (err) => {
    console.error(err);
    bootLog.textContent += "\nworker error — see console";
  };
  worker.postMessage({ type: "init", w: W, h: H, state: { ...scene } });
}

function pushState() {
  if (!worker) return;
  worker.postMessage({ type: "state", state: { ...scene } });
  filmHint.classList.remove("hide");
  stExplain.textContent = "New view — guessing the light again.";
}

function loop() {
  if (booted && worker && !busy) {
    busy = true;
    worker.postMessage({ type: "tick", budget: mobile ? 22 : 32 });
  }
  requestAnimationFrame(loop);
}

function drawSpark() {
  const w = spark.width;
  const h = spark.height;
  sctx.fillStyle = "#0a0b0d";
  sctx.fillRect(0, 0, w, h);
  if (sppHist.length < 2) return;
  const max = Math.max(...sppHist, 1);
  sctx.strokeStyle = "#8cff6a";
  sctx.lineWidth = 1;
  sctx.beginPath();
  sppHist.forEach((v, i) => {
    const x = (i / (sppHist.length - 1)) * (w - 2) + 1;
    const y = h - 3 - (v / max) * (h - 6);
    if (i === 0) sctx.moveTo(x, y);
    else sctx.lineTo(x, y);
  });
  sctx.stroke();
}

function bindMat(id, key) {
  const root = document.getElementById(id);
  root.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      scene[key] = btn.dataset.mat;
      root.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
      highlightBsdf();
      pushState();
    });
  });
}
bindMat("leftMat", "left");
bindMat("rightMat", "right");

function highlightBsdf() {
  document.querySelectorAll(".methods li").forEach((li) => {
    const b = li.dataset.bsdf;
    li.classList.toggle("on", b === scene.left || b === scene.right);
  });
}
highlightBsdf();

eta.addEventListener("input", () => {
  scene.eta = Number(eta.value);
  etaLabel.textContent = scene.eta.toFixed(2);
  etaRead.textContent = scene.eta.toFixed(2);
  pushState();
});
fuzz.addEventListener("input", () => {
  scene.fuzz = Number(fuzz.value);
  fuzzLabel.textContent = scene.fuzz.toFixed(2);
  pushState();
});
document.getElementById("reset").addEventListener("click", () => {
  worker && worker.postMessage({ type: "reset" });
  filmHint.classList.remove("hide");
  stExplain.textContent = "Starting the guesses over.";
});

let drag = false;
let lx = 0;
let ly = 0;
view.addEventListener("pointerdown", (e) => {
  drag = true;
  lx = e.clientX;
  ly = e.clientY;
  view.setPointerCapture(e.pointerId);
});
view.addEventListener("pointerup", () => {
  drag = false;
});
view.addEventListener("pointermove", (e) => {
  const rect = view.getBoundingClientRect();
  const u = (e.clientX - rect.left) / rect.width;
  const v = (e.clientY - rect.top) / rect.height;
  uvRead.textContent = "looking around";
  if (!drag) return;
  const dx = e.clientX - lx;
  const dy = e.clientY - ly;
  lx = e.clientX;
  ly = e.clientY;
    scene.phi += dx * 0.008;
    scene.theta = Math.min(1.15, Math.max(-0.2, scene.theta + dy * 0.006));
  pushState();
});
view.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    scene.radius = Math.min(6, Math.max(2.1, scene.radius + e.deltaY * 0.004));
    pushState();
  },
  { passive: false }
);

let pinch0 = 0;
view.addEventListener("touchstart", (e) => {
  if (e.touches.length === 2) {
    const a = e.touches[0];
    const b = e.touches[1];
    pinch0 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }
});
view.addEventListener(
  "touchmove",
  (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const a = e.touches[0];
      const b = e.touches[1];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinch0) {
        scene.radius = Math.min(6, Math.max(2.1, scene.radius * (pinch0 / d)));
        pinch0 = d;
        pushState();
      }
    }
  },
  { passive: false }
);

window.addEventListener("keydown", (e) => {
  if (e.key === "r" || e.key === "R") worker && worker.postMessage({ type: "reset" });
  if (e.key === "1") setBoth("lambert");
  if (e.key === "2") setBoth("metal");
  if (e.key === "3") setBoth("glass");
});

function setBoth(kind) {
  scene.left = kind;
  scene.right = kind;
  document.querySelectorAll("#leftMat button, #rightMat button").forEach((b) => {
    b.classList.toggle("on", b.dataset.mat === kind);
  });
  highlightBsdf();
  pushState();
}
