(() => {
  "use strict";

  const W = 320;
  const H = 480;
  const PIG_W = 16;
  const PIG_H = 16;
  const BASKET_W = 56;
  const BASKET_H = 14;
  const STORAGE_KEY = "pendingPigs";
  const FLUSH_COUNT = 5;
  const FLUSH_MS = 10000;

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const hud = document.getElementById("hud");
  const scoreEl = document.getElementById("score");
  const startScreen = document.getElementById("start-screen");
  const endScreen = document.getElementById("end-screen");
  const startStats = document.getElementById("start-stats");
  const endStats = document.getElementById("end-stats");
  const endMessage = document.getElementById("end-message");
  const btnStart = document.getElementById("btn-start");
  const btnRetry = document.getElementById("btn-retry");

  const keys = { left: false, right: false };
  const basket = { x: (W - BASKET_W) / 2, y: H - 28, w: BASKET_W, h: BASKET_H };

  let running = false;
  let dragging = false;
  let dragOffsetX = 0;
  let falling = null;
  let stacked = [];
  let score = 0;
  let lastTs = 0;
  let globalTotal = null;
  let pendingPigs = 0;
  let lastFlushAt = Date.now();
  let flushing = false;
  let rafId = 0;

  function loadPending() {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = Number.parseInt(raw, 10);
    pendingPigs = Number.isFinite(n) && n > 0 ? n : 0;
  }

  function savePending() {
    localStorage.setItem(STORAGE_KEY, String(Math.max(0, pendingPigs | 0)));
  }

  function formatGlobal(n) {
    return String(Math.max(0, n | 0));
  }

  function statsMarkup(prefix, n) {
    return (
      '<span class="px-icon px-globe" aria-hidden="true"></span>' +
      prefix +
      '<span class="pixel-num">' +
      formatGlobal(n) +
      "</span> 只猪"
    );
  }

  function renderGlobalStats() {
    const unavailable = "全球统计暂不可用";
    if (globalTotal == null) {
      startStats.textContent = unavailable;
      endStats.textContent = unavailable;
      return;
    }
    startStats.innerHTML = statsMarkup("全球玩家已累计接住 ", globalTotal);
    endStats.innerHTML = statsMarkup("全球玩家已累计接住 ", globalTotal);
  }

  async function fetchStats() {
    try {
      const res = await fetch("/api/stats", { cache: "no-store" });
      if (!res.ok) throw new Error("stats");
      const data = await res.json();
      if (typeof data.totalPigs === "number") {
        globalTotal = data.totalPigs;
        renderGlobalStats();
      } else {
        throw new Error("stats");
      }
    } catch (_err) {
      if (globalTotal == null) renderGlobalStats();
    }
  }

  async function flush() {
    if (flushing) return;
    let n = pendingPigs | 0;
    if (n <= 0) return;
    n = Math.min(n, 50);
    pendingPigs -= n;
    savePending();
    flushing = true;
    lastFlushAt = Date.now();
    try {
      const res = await fetch("/api/stats/pigs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: n }),
      });
      if (!res.ok) throw new Error("flush");
      const data = await res.json();
      if (typeof data.totalPigs === "number") {
        globalTotal = data.totalPigs;
        renderGlobalStats();
      }
    } catch (_err) {
      pendingPigs += n;
      savePending();
    } finally {
      flushing = false;
      if (pendingPigs >= FLUSH_COUNT) flush();
    }
  }

  function noteCatch() {
    pendingPigs += 1;
    savePending();
    if (pendingPigs >= FLUSH_COUNT || Date.now() - lastFlushAt > FLUSH_MS) {
      flush();
    }
  }

  function screenToLogic(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * W,
      y: ((clientY - rect.top) / rect.height) * H,
    };
  }

  function clampBasket() {
    basket.x = Math.max(0, Math.min(W - basket.w, basket.x));
  }

  function spawnPig() {
    falling = {
      x: Math.floor(Math.random() * (W - PIG_W)),
      y: -PIG_H,
      vy: 2.0 + Math.min(3.5, score * 0.045),
    };
  }

  function stackTopY() {
    return basket.y - stacked.length * PIG_H;
  }

  function catchPig() {
    const offsetX = falling.x - basket.x;
    stacked.push({ offsetX: offsetX });
    score += 1;
    scoreEl.textContent = String(score);
    noteCatch();
    spawnPig();
  }

  function gameOver() {
    running = false;
    falling = null;
    hud.classList.add("hidden");
    endMessage.textContent = "你一共接到了 " + score + " 只猪";
    endScreen.classList.remove("hidden");
    fetchStats();
  }

  function resetGame() {
    score = 0;
    stacked = [];
    falling = null;
    basket.x = (W - BASKET_W) / 2;
    scoreEl.textContent = "0";
  }

  function startGame() {
    resetGame();
    startScreen.classList.add("hidden");
    endScreen.classList.add("hidden");
    hud.classList.remove("hidden");
    running = true;
    lastTs = 0;
    spawnPig();
    if (!rafId) rafId = requestAnimationFrame(loop);
  }

  function hitsBasket(pig) {
    const catchY = stackTopY();
    const pigBottom = pig.y + PIG_H;
    const overlapX = pig.x + PIG_W > basket.x && pig.x < basket.x + basket.w;
    return overlapX && pigBottom >= catchY && pig.y <= catchY;
  }

  function update(dt) {
    const speed = 140;
    if (keys.left) basket.x -= speed * dt;
    if (keys.right) basket.x += speed * dt;
    clampBasket();

    if (!falling) return;
    falling.y += falling.vy * (dt * 60);

    if (hitsBasket(falling)) {
      catchPig();
      return;
    }
    if (falling.y > H) gameOver();
  }

  function drawChecker() {
    const cell = 8;
    for (let y = 0; y < H; y += cell) {
      for (let x = 0; x < W; x += cell) {
        const on = ((x / cell) + (y / cell)) % 2 === 0;
        ctx.fillStyle = on ? "#5bb8c8" : "#49a4b5";
        ctx.fillRect(x, y, cell, cell);
      }
    }
    ctx.fillStyle = "#7ed0a0";
    ctx.fillRect(0, H - 18, W, 18);
    ctx.fillStyle = "#5aaa78";
    for (let x = 0; x < W; x += 8) ctx.fillRect(x, H - 18, 4, 4);
  }

  function drawPig(x, y) {
    const px = Math.round(x);
    const py = Math.round(y);
    ctx.fillStyle = "#e07a9a";
    ctx.fillRect(px + 4, py + 2, 3, 3);
    ctx.fillRect(px + 9, py + 2, 3, 3);
    ctx.fillStyle = "#ffc3d4";
    ctx.fillRect(px + 5, py + 3, 1, 1);
    ctx.fillRect(px + 10, py + 3, 1, 1);
    ctx.fillStyle = "#f4a6c1";
    ctx.fillRect(px + 3, py + 5, 10, 8);
    ctx.fillStyle = "#e07a9a";
    ctx.fillRect(px + 6, py + 8, 4, 3);
    ctx.fillStyle = "#a84d6a";
    ctx.fillRect(px + 7, py + 9, 1, 1);
    ctx.fillRect(px + 9, py + 9, 1, 1);
    ctx.fillStyle = "#2a1810";
    ctx.fillRect(px + 5, py + 6, 2, 2);
    ctx.fillRect(px + 9, py + 6, 2, 2);
    ctx.fillStyle = "#fff6ea";
    ctx.fillRect(px + 5, py + 6, 1, 1);
    ctx.fillRect(px + 9, py + 6, 1, 1);
    ctx.fillStyle = "#e07a9a";
    ctx.fillRect(px + 4, py + 13, 2, 3);
    ctx.fillRect(px + 10, py + 13, 2, 3);
  }

  function drawBasket() {
    const x = Math.round(basket.x);
    const y = Math.round(basket.y);
    ctx.fillStyle = "#2a1810";
    ctx.fillRect(x - 1, y - 1, basket.w + 2, basket.h + 2);
    ctx.fillStyle = "#c47a22";
    ctx.fillRect(x, y, basket.w, basket.h);
    ctx.fillStyle = "#e8a24a";
    ctx.fillRect(x + 2, y + 2, basket.w - 4, 3);
    ctx.fillStyle = "#8a4e16";
    ctx.fillRect(x + 2, y + 7, basket.w - 4, 5);
    ctx.fillStyle = "#2a1810";
    ctx.fillRect(x + 10, y + 7, 2, 5);
    ctx.fillRect(x + basket.w - 12, y + 7, 2, 5);
  }

  function draw() {
    drawChecker();
    for (let i = 0; i < stacked.length; i++) {
      const pig = stacked[i];
      drawPig(basket.x + pig.offsetX, basket.y - (i + 1) * PIG_H);
    }
    drawBasket();
    if (falling) drawPig(falling.x, falling.y);
  }

  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    if (running) update(dt);
    draw();
  }

  function onPointerDown(ev) {
    if (!running) return;
    const p = screenToLogic(ev.clientX, ev.clientY);
    dragging = true;
    dragOffsetX = p.x - (basket.x + basket.w / 2);
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch (_err) {
      /* ignore */
    }
  }

  function onPointerMove(ev) {
    if (!running || !dragging) return;
    const p = screenToLogic(ev.clientX, ev.clientY);
    basket.x = p.x - basket.w / 2 - dragOffsetX;
    clampBasket();
  }

  function onPointerUp(ev) {
    dragging = false;
    try {
      canvas.releasePointerCapture(ev.pointerId);
    } catch (_err) {
      /* ignore */
    }
  }

  window.addEventListener("keydown", (ev) => {
    if (ev.code === "ArrowLeft" || ev.code === "KeyA") keys.left = true;
    if (ev.code === "ArrowRight" || ev.code === "KeyD") keys.right = true;
  });
  window.addEventListener("keyup", (ev) => {
    if (ev.code === "ArrowLeft" || ev.code === "KeyA") keys.left = false;
    if (ev.code === "ArrowRight" || ev.code === "KeyD") keys.right = false;
  });

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  btnStart.addEventListener("click", startGame);
  btnRetry.addEventListener("click", startGame);

  window.addEventListener("pagehide", () => {
    const n = Math.min(pendingPigs | 0, 50);
    if (n <= 0 || !navigator.sendBeacon) return;
    pendingPigs -= n;
    savePending();
    const blob = new Blob([JSON.stringify({ count: n })], {
      type: "application/json",
    });
    const ok = navigator.sendBeacon("/api/stats/pigs", blob);
    if (!ok) {
      pendingPigs += n;
      savePending();
    }
  });

  loadPending();
  renderGlobalStats();
  fetchStats();
  if (pendingPigs > 0) flush();
  draw();
  rafId = requestAnimationFrame(loop);
})();
