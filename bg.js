// ===== LIGHTWEIGHT DYNAMIC BACKGROUND =====
(function() {
  'use strict';

  // Use CSS-based animated background instead of heavy canvas
  const style = document.createElement('style');
  style.textContent = `
    #bg-canvas {
      position: fixed;
      inset: 0;
      z-index: -2;
      width: 100%;
      height: 100%;
      pointer-events: none;
      overflow: hidden;
      background: var(--bg);
      transition: background 0.8s ease;
    }
    #bg-canvas .orb {
      position: absolute;
      border-radius: 50%;
      filter: blur(80px);
      opacity: 0.3;
      will-change: transform;
      animation: orbFloat 20s ease-in-out infinite alternate;
    }
    #bg-canvas .orb:nth-child(1) {
      width: 400px;
      height: 400px;
      background: radial-gradient(circle, rgba(155,124,255,0.3), transparent 70%);
      top: -100px;
      left: -100px;
      animation-duration: 25s;
    }
    #bg-canvas .orb:nth-child(2) {
      width: 500px;
      height: 500px;
      background: radial-gradient(circle, rgba(70,216,255,0.2), transparent 70%);
      bottom: -150px;
      right: -150px;
      animation-duration: 30s;
      animation-delay: -5s;
    }
    #bg-canvas .orb:nth-child(3) {
      width: 300px;
      height: 300px;
      background: radial-gradient(circle, rgba(255,201,107,0.15), transparent 70%);
      top: 40%;
      left: 50%;
      animation-duration: 22s;
      animation-delay: -10s;
    }
    @keyframes orbFloat {
      0% { transform: translate(0, 0) scale(1); }
      33% { transform: translate(60px, -40px) scale(1.1); }
      66% { transform: translate(-30px, 60px) scale(0.9); }
      100% { transform: translate(40px, 30px) scale(1.05); }
    }
    #bg-canvas .particle {
      position: absolute;
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: rgba(255,255,255,0.3);
      will-change: transform, opacity;
      animation: particleDrift 15s linear infinite;
    }
    #bg-canvas .particle:nth-child(n+4) { animation-duration: 18s; }
    #bg-canvas .particle:nth-child(n+8) { animation-duration: 22s; }
    #bg-canvas .particle:nth-child(n+12) { animation-duration: 14s; }
    #bg-canvas .particle:nth-child(n+16) { animation-duration: 20s; }
    #bg-canvas .particle:nth-child(n+20) { animation-duration: 25s; }
    @keyframes particleDrift {
      0% { transform: translate(0, 0) scale(1); opacity: 0; }
      10% { opacity: 0.6; }
      90% { opacity: 0.6; }
      100% { transform: translate(var(--tx, 200px), var(--ty, -200px)) scale(0); opacity: 0; }
    }
    #bg-canvas .connection-line {
      position: absolute;
      height: 1px;
      background: linear-gradient(90deg, rgba(155,124,255,0.05), rgba(70,216,255,0.05));
      will-change: transform, opacity;
      animation: linePulse 8s ease-in-out infinite alternate;
    }
    @keyframes linePulse {
      0% { opacity: 0.2; transform: scaleX(0.8); }
      100% { opacity: 0.6; transform: scaleX(1.2); }
    }
    [data-theme="light"] #bg-canvas .orb:nth-child(1) {
      background: radial-gradient(circle, rgba(155,124,255,0.15), transparent 70%);
    }
    [data-theme="light"] #bg-canvas .orb:nth-child(2) {
      background: radial-gradient(circle, rgba(70,216,255,0.1), transparent 70%);
    }
    [data-theme="light"] #bg-canvas .particle {
      background: rgba(0,0,0,0.15);
    }
    [data-theme="retro"] #bg-canvas .orb {
      opacity: 0.1;
      filter: blur(40px);
    }
    [data-theme="retro"] #bg-canvas .orb:nth-child(1) {
      background: radial-gradient(circle, rgba(0,255,0,0.15), transparent 70%);
    }
    [data-theme="retro"] #bg-canvas .particle {
      background: rgba(0,255,0,0.2);
    }
    [data-theme="matrix"] #bg-canvas .orb {
      opacity: 0.08;
      filter: blur(30px);
    }
    [data-theme="matrix"] #bg-canvas .orb:nth-child(1) {
      background: radial-gradient(circle, rgba(0,255,65,0.15), transparent 70%);
    }
  `;
  document.head.appendChild(style);

  const container = document.createElement('div');
  container.id = 'bg-canvas';
  document.body.prepend(container);

  // Orbs
  for (let i = 0; i < 3; i++) {
    const orb = document.createElement('div');
    orb.className = 'orb';
    container.appendChild(orb);
  }

  // Particles (30 particles with random positions and directions)
  const particleCount = 30;
  const particles = [];
  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');
    el.className = 'particle';
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    const size = 1.5 + Math.random() * 2.5;
    const tx = (Math.random() - 0.5) * 400;
    const ty = (Math.random() - 0.5) * 400;
    const delay = Math.random() * 20;
    el.style.cssText = `
      left: ${x}%;
      top: ${y}%;
      width: ${size}px;
      height: ${size}px;
      --tx: ${tx}px;
      --ty: ${ty}px;
      animation-delay: ${delay}s;
    `;
    container.appendChild(el);
    particles.push(el);
  }

  // Connection lines (subtle)
  for (let i = 0; i < 5; i++) {
    const line = document.createElement('div');
    line.className = 'connection-line';
    const x = 5 + Math.random() * 90;
    const y = 5 + Math.random() * 90;
    const w = 30 + Math.random() * 80;
    const angle = Math.random() * 360;
    const delay = Math.random() * 6;
    line.style.cssText = `
      left: ${x}%;
      top: ${y}%;
      width: ${w}px;
      transform: rotate(${angle}deg);
      animation-delay: ${delay}s;
    `;
    container.appendChild(line);
  }

  // Mouse tracking for glass effect
  document.addEventListener('mousemove', (e) => {
    const x = (e.clientX / window.innerWidth * 100);
    const y = (e.clientY / window.innerHeight * 100);
    document.documentElement.style.setProperty('--mouse-x', x + '%');
    document.documentElement.style.setProperty('--mouse-y', y + '%');
  });

  // Theme change - re-init colors
  const observer = new MutationObserver(() => {
    // Just update via CSS, nothing else needed
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

})();
