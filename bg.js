// ===== DYNAMIC BACKGROUND WITH PARTICLES, RINGS & WAVES =====
(function() {
  'use strict';

  const canvas = document.createElement('canvas');
  canvas.id = 'bg-canvas';
  canvas.style.cssText = 'position:fixed;inset:0;z-index:-2;width:100%;height:100%;display:block;';
  document.body.prepend(canvas);

  const ctx = canvas.getContext('2d');
  let W, H;
  let particles = [];
  let rings = [];
  let waves = [];
  let sparkles = [];
  let mouseX = 0, mouseY = 0;
  let time = 0;

  const CONFIG = {
    particleCount: 100,
    ringCount: 8,
    waveCount: 5,
    sparkleCount: 30,
    maxParticleSize: 3.5,
    connectionDistance: 130,
    ringRadius: 90,
  };

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- Particles ----
  class Particle {
    constructor() {
      this.reset();
    }
    reset() {
      this.x = Math.random() * W;
      this.y = Math.random() * H;
      this.vx = (Math.random() - 0.5) * 0.5;
      this.vy = (Math.random() - 0.5) * 0.5;
      this.size = Math.random() * CONFIG.maxParticleSize + 0.5;
      this.opacity = Math.random() * 0.5 + 0.2;
      this.hue = Math.random() * 60 + 220; // blue-purple range
      this.pulse = Math.random() * Math.PI * 2;
      this.pulseSpeed = 0.01 + Math.random() * 0.02;
    }
    update() {
      this.x += this.vx;
      this.y += this.vy;
      this.pulse += this.pulseSpeed;
      if (this.x < 0 || this.x > W) this.vx *= -1;
      if (this.y < 0 || this.y > H) this.vy *= -1;
      
      // Mouse attraction
      const dx = mouseX - this.x;
      const dy = mouseY - this.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < 250 && dist > 10) {
        const force = 0.0004;
        this.vx += dx * force;
        this.vy += dy * force;
        const sp = Math.sqrt(this.vx*this.vx + this.vy*this.vy);
        if (sp > 1.5) {
          this.vx = (this.vx / sp) * 1.5;
          this.vy = (this.vy / sp) * 1.5;
        }
      }
    }
    draw() {
      const sizePulse = this.size * (1 + Math.sin(this.pulse) * 0.2);
      const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, sizePulse * 4);
      gradient.addColorStop(0, `hsla(${this.hue}, 85%, 75%, ${this.opacity * 0.9})`);
      gradient.addColorStop(0.3, `hsla(${this.hue + 20}, 80%, 65%, ${this.opacity * 0.5})`);
      gradient.addColorStop(1, `hsla(${this.hue + 40}, 70%, 50%, 0)`);
      ctx.beginPath();
      ctx.arc(this.x, this.y, sizePulse * 4, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
      
      // Core glow
      ctx.beginPath();
      ctx.arc(this.x, this.y, sizePulse * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${this.hue}, 90%, 90%, ${this.opacity * 0.7})`;
      ctx.fill();
    }
  }

  // ---- Rings ----
  class Ring {
    constructor() {
      this.x = Math.random() * W;
      this.y = Math.random() * H;
      this.radius = CONFIG.ringRadius + Math.random() * 140;
      this.speed = 0.0015 + Math.random() * 0.005;
      this.phase = Math.random() * Math.PI * 2;
      this.opacity = Math.random() * 0.15 + 0.05;
      this.hue = Math.random() * 50 + 220;
      this.width = 1 + Math.random() * 2.5;
      this.rotation = Math.random() * Math.PI * 2;
      this.orbitSpeed = 0.0005 + Math.random() * 0.001;
    }
    update() {
      this.phase += this.speed;
      this.rotation += this.orbitSpeed;
      const pulse = 1 + Math.sin(this.phase) * 0.15;
      this.currentRadius = this.radius * pulse;
      // Orbital movement
      this.x += Math.sin(this.rotation) * 0.1;
      this.y += Math.cos(this.rotation) * 0.1;
    }
    draw() {
      // Outer ring glow
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.currentRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${this.hue}, 70%, 65%, ${this.opacity * 0.6})`;
      ctx.lineWidth = this.width * 1.5;
      ctx.shadowColor = `hsla(${this.hue}, 80%, 70%, ${this.opacity * 0.3})`;
      ctx.shadowBlur = 20;
      ctx.stroke();
      ctx.shadowBlur = 0;
      
      // Main ring
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.currentRadius * 0.85, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${this.hue + 20}, 75%, 70%, ${this.opacity})`;
      ctx.lineWidth = this.width;
      ctx.stroke();
      
      // Inner glow
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.currentRadius * 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${this.hue + 30}, 80%, 80%, ${this.opacity * 0.3})`;
      ctx.lineWidth = this.width * 0.5;
      ctx.stroke();
    }
  }

  // ---- Waves ----
  class Wave {
    constructor() {
      this.y = Math.random() * H;
      this.amplitude = 25 + Math.random() * 50;
      this.frequency = 0.0015 + Math.random() * 0.004;
      this.speed = 0.0015 + Math.random() * 0.003;
      this.phase = Math.random() * Math.PI * 2;
      this.opacity = Math.random() * 0.06 + 0.02;
      this.hue = Math.random() * 40 + 230;
      this.width = 1 + Math.random() * 2.5;
      this.offset = Math.random() * 100;
    }
    update() {
      this.phase += this.speed;
      this.y += Math.sin(this.phase * 0.4) * 0.15;
      this.offset += 0.1;
    }
    draw() {
      // Main wave
      ctx.beginPath();
      for (let x = 0; x < W; x += 2) {
        const y = this.y + Math.sin(x * this.frequency + this.phase + this.offset) * this.amplitude;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `hsla(${this.hue}, 60%, 75%, ${this.opacity})`;
      ctx.lineWidth = this.width;
      ctx.shadowColor = `hsla(${this.hue + 20}, 70%, 70%, ${this.opacity * 0.5})`;
      ctx.shadowBlur = 15;
      ctx.stroke();
      ctx.shadowBlur = 0;
      
      // Secondary wave (offset)
      ctx.beginPath();
      for (let x = 0; x < W; x += 2) {
        const y = this.y + 20 + Math.sin(x * this.frequency * 0.7 + this.phase + this.offset * 0.5) * (this.amplitude * 0.6);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `hsla(${this.hue + 30}, 65%, 70%, ${this.opacity * 0.5})`;
      ctx.lineWidth = this.width * 0.5;
      ctx.stroke();
    }
  }

  // ---- Sparkles ----
  class Sparkle {
    constructor() {
      this.x = Math.random() * W;
      this.y = Math.random() * H;
      this.size = Math.random() * 3 + 1;
      this.speed = 0.005 + Math.random() * 0.02;
      this.phase = Math.random() * Math.PI * 2;
      this.hue = Math.random() * 60 + 200;
      this.life = Math.random() * 100 + 50;
      this.maxLife = this.life;
    }
    update() {
      this.phase += this.speed;
      this.life -= 0.3;
      if (this.life <= 0) {
        this.x = Math.random() * W;
        this.y = Math.random() * H;
        this.life = this.maxLife = Math.random() * 100 + 50;
        this.hue = Math.random() * 60 + 200;
      }
      this.x += Math.sin(this.phase * 2) * 0.2;
      this.y += Math.cos(this.phase * 1.5) * 0.2;
    }
    draw() {
      const progress = 1 - (this.life / this.maxLife);
      const opacity = Math.sin(progress * Math.PI) * 0.8;
      const size = this.size * (1 + Math.sin(this.phase) * 0.3);
      
      // Star shape (4-point)
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.phase);
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const radius = i % 2 === 0 ? size : size * 0.3;
        if (i === 0) ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        else ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      }
      ctx.closePath();
      ctx.fillStyle = `hsla(${this.hue}, 90%, 85%, ${opacity})`;
      ctx.shadowColor = `hsla(${this.hue}, 90%, 85%, ${opacity * 0.5})`;
      ctx.shadowBlur = 15;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    }
  }

  function init() {
    particles = [];
    for (let i = 0; i < CONFIG.particleCount; i++) {
      particles.push(new Particle());
    }
    rings = [];
    for (let i = 0; i < CONFIG.ringCount; i++) {
      rings.push(new Ring());
    }
    waves = [];
    for (let i = 0; i < CONFIG.waveCount; i++) {
      waves.push(new Wave());
    }
    sparkles = [];
    for (let i = 0; i < CONFIG.sparkleCount; i++) {
      sparkles.push(new Sparkle());
    }
  }
  init();

  // ---- Mouse tracking ----
  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    document.documentElement.style.setProperty('--mouse-x', (e.clientX / window.innerWidth * 100) + '%');
    document.documentElement.style.setProperty('--mouse-y', (e.clientY / window.innerHeight * 100) + '%');
  });

  // ---- Animation loop ----
  function animate() {
    time++;
    ctx.clearRect(0, 0, W, H);

    // Deep space glow
    const grad = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W,H) * 0.7);
    grad.addColorStop(0, 'rgba(70, 216, 255, 0.025)');
    grad.addColorStop(0.4, 'rgba(155, 124, 255, 0.015)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Draw waves (background layer)
    waves.forEach(w => { w.update(); w.draw(); });

    // Draw rings
    rings.forEach(r => { r.update(); r.draw(); });

    // Draw particle connections
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < CONFIG.connectionDistance) {
          const opacity = (1 - dist / CONFIG.connectionDistance) * 0.25;
          const hue = 230 + (dist / CONFIG.connectionDistance) * 50;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `hsla(${hue}, 80%, 75%, ${opacity})`;
          ctx.lineWidth = 0.6;
          ctx.shadowColor = `hsla(${hue}, 80%, 75%, ${opacity * 0.3})`;
          ctx.shadowBlur = 8;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }
    }

    // Draw sparkles
    sparkles.forEach(s => { s.update(); s.draw(); });

    // Draw particles
    particles.forEach(p => { p.update(); p.draw(); });

    // Floating light orbs
    for (let i = 0; i < 4; i++) {
      const x = (Math.sin(time * 0.0006 + i * 2.0) * 0.4 + 0.5) * W;
      const y = (Math.cos(time * 0.0007 + i * 1.8) * 0.4 + 0.5) * H;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 80 + Math.sin(time * 0.002 + i) * 30);
      g.addColorStop(0, `hsla(${230 + i * 20}, 70%, 70%, 0.04)`);
      g.addColorStop(0.5, `hsla(${230 + i * 20 + 30}, 70%, 60%, 0.02)`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 120, y - 120, 240, 240);
    }

    requestAnimationFrame(animate);
  }
  animate();

  // ---- Reinitialize on resize ----
  window.addEventListener('resize', () => {
    resize();
    init();
  });

  // ---- Theme change handler ----
  const observer = new MutationObserver(() => {
    init();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

})();