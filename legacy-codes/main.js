(function () {
  const root = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  window.addEventListener("pointermove", (event) => {
    root.style.setProperty("--mx", `${event.clientX}px`);
    root.style.setProperty("--my", `${event.clientY}px`);
  }, { passive: true });

  const revealTargets = document.querySelectorAll("[data-reveal]");
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: 0.16, rootMargin: "0px 0px -10% 0px" });
    revealTargets.forEach((target) => observer.observe(target));
  } else {
    revealTargets.forEach((target) => target.classList.add("is-visible"));
  }

  const canvas = document.getElementById("beamfield");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let pointerX = 0.5;
  let pointerY = 0.35;
  let tick = 0;
  let nodes = [];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildNodes();
    draw(0);
  }

  function buildNodes() {
    const count = Math.max(24, Math.min(58, Math.floor(width / 38)));
    nodes = Array.from({ length: count }, (_, index) => {
      const row = index % 7;
      const col = Math.floor(index / 7);
      const jitter = seeded(index * 911 + 17);
      return {
        x: ((col + 0.5 + jitter * 0.35) / (Math.ceil(count / 7) + 0.5)) * width,
        y: ((row + 0.4 + seeded(index * 701 + 5) * 0.8) / 7.8) * height,
        r: 1.4 + seeded(index * 211 + 3) * 2.8,
        phase: seeded(index * 37 + 19) * Math.PI * 2,
        speed: 0.35 + seeded(index * 53 + 29) * 0.65,
        live: seeded(index * 97 + 41) > 0.72
      };
    });
  }

  function seeded(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  function pointer(event) {
    pointerX = event.clientX / Math.max(width, 1);
    pointerY = event.clientY / Math.max(height, 1);
  }

  function draw(time) {
    tick = time * 0.001;
    ctx.clearRect(0, 0, width, height);

    const px = pointerX * width;
    const py = pointerY * height;

    const glow = ctx.createRadialGradient(px, py, 0, px, py, Math.max(width, height) * 0.55);
    glow.addColorStop(0, "rgba(124, 107, 255, 0.14)");
    glow.addColorStop(0.36, "rgba(201, 91, 245, 0.055)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    for (let i = 0; i < nodes.length; i++) {
      const a = nodeAt(nodes[i]);
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodeAt(nodes[j]);
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        const max = width < 700 ? 135 : 185;
        if (dist > max) continue;

        const strength = (1 - dist / max) * 0.28;
        const pulse = 0.5 + Math.sin(tick * 1.5 + i * 0.7 + j * 0.2) * 0.5;
        const alpha = strength * (0.5 + pulse * 0.5);
        const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        gradient.addColorStop(0, `rgba(124, 107, 255, ${alpha})`);
        gradient.addColorStop(0.5, `rgba(245, 194, 75, ${alpha * 0.65})`);
        gradient.addColorStop(1, `rgba(201, 91, 245, ${alpha})`);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    for (const node of nodes) {
      const n = nodeAt(node);
      const near = 1 - Math.min(1, Math.hypot(n.x - px, n.y - py) / 280);
      const radius = n.r + near * 2;
      ctx.beginPath();
      ctx.fillStyle = node.live ? "rgba(245, 194, 75, 0.92)" : "rgba(236, 234, 246, 0.68)";
      ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
      ctx.fill();

      if (node.live) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(245, 194, 75, 0.24)";
        ctx.lineWidth = 1;
        ctx.arc(n.x, n.y, radius + 8 + Math.sin(tick * 2 + node.phase) * 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (!reduceMotion) requestAnimationFrame(draw);
  }

  function nodeAt(node) {
    if (reduceMotion) return node;
    return {
      x: node.x + Math.cos(tick * node.speed + node.phase) * 8,
      y: node.y + Math.sin(tick * node.speed * 0.8 + node.phase) * 10,
      r: node.r
    };
  }

  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", pointer, { passive: true });
  resize();
  if (!reduceMotion) requestAnimationFrame(draw);
})();

