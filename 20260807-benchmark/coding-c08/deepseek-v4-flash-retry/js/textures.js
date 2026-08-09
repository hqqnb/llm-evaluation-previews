(function () {
  const THREE = window.THREE;
  const cache = {};
  function canvas(w, h, draw) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const x = c.getContext("2d");
    draw(x, w, h);
    return c;
  }
  function tex(c, repeatX, repeatY) {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX || 1, repeatY || 1);
    t.anisotropy = 4;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function noise(x, w, h, alpha, n) {
    for (let i = 0; i < n; i++) {
      x.fillStyle = `rgba(${Math.random() * 255 | 0},${Math.random() * 255 | 0},${Math.random() * 255 | 0},${alpha})`;
      x.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
  }
  const T = {
    get(kind) {
      if (cache[kind]) return cache[kind];
      let t;
      switch (kind) {
        case "sandWall": {
          const c = canvas(256, 256, x => {
            x.fillStyle = "#c9a878"; x.fillRect(0, 0, 256, 256);
            const g = x.createLinearGradient(0, 0, 0, 256);
            g.addColorStop(0, "rgba(255,240,200,0.22)"); g.addColorStop(0.5, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(80,50,20,0.22)");
            x.fillStyle = g; x.fillRect(0, 0, 256, 256);
            x.fillStyle = "rgba(120,85,45,0.10)"; for (let y = 0; y < 256; y += 28) x.fillRect(0, y, 256, 1);
            noise(x, 256, 256, 0.045, 2600);
            x.fillStyle = "rgba(90,60,30,0.12)"; for (let i = 0; i < 30; i++) x.fillRect(Math.random() * 256, Math.random() * 256, 10 + Math.random() * 28, 2 + Math.random() * 3);
          });
          t = tex(c, 2, 2); break;
        }
        case "sandGround": {
          const c = canvas(256, 256, x => {
            x.fillStyle = "#b3915f"; x.fillRect(0, 0, 256, 256);
            noise(x, 256, 256, 0.07, 3200);
            x.fillStyle = "rgba(255,230,170,0.08)"; for (let i = 0; i < 80; i++) x.fillRect(Math.random() * 256, Math.random() * 256, 3 + Math.random() * 8, 1);
            x.fillStyle = "rgba(80,50,25,0.12)"; for (let i = 0; i < 50; i++) x.fillRect(Math.random() * 256, Math.random() * 256, 4 + Math.random() * 12, 1 + Math.random() * 2);
          });
          t = tex(c, 8, 8); break;
        }
        case "concrete": {
          const c = canvas(256, 256, x => {
            x.fillStyle = "#8d9298"; x.fillRect(0, 0, 256, 256);
            noise(x, 256, 256, 0.06, 3000);
            x.fillStyle = "rgba(50,55,60,0.18)"; for (let i = 0; i < 22; i++) x.fillRect(Math.random() * 256, Math.random() * 256, 20 + Math.random() * 80, 2);
            x.fillStyle = "rgba(255,255,255,0.10)"; for (let i = 0; i < 16; i++) x.fillRect(Math.random() * 256, Math.random() * 256, 30 + Math.random() * 90, 2);
            x.strokeStyle = "rgba(40,45,50,0.35)"; x.lineWidth = 2;
            for (let gx = 0; gx <= 256; gx += 64) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, 256); x.stroke(); }
            for (let gy = 0; gy <= 256; gy += 64) { x.beginPath(); x.moveTo(0, gy); x.lineTo(256, gy); x.stroke(); }
          });
          t = tex(c, 3, 3); break;
        }
        case "metal": {
          const c = canvas(256, 256, x => {
            x.fillStyle = "#5c636d"; x.fillRect(0, 0, 256, 256);
            const g = x.createLinearGradient(0, 0, 0, 256);
            g.addColorStop(0, "rgba(255,255,255,0.12)"); g.addColorStop(0.5, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.2)");
            x.fillStyle = g; x.fillRect(0, 0, 256, 256);
            x.strokeStyle = "rgba(30,34,40,0.4)"; x.lineWidth = 2;
            for (let i = 0; i < 8; i++) { const y = i * 32; x.beginPath(); x.moveTo(0, y); x.lineTo(256, y); x.stroke(); }
            noise(x, 256, 256, 0.05, 1200);
          });
          t = tex(c, 2, 2); break;
        }
        case "crateWood": {
          const c = canvas(256, 256, x => {
            x.fillStyle = "#7b5a33"; x.fillRect(0, 0, 256, 256);
            x.strokeStyle = "rgba(40,25,10,0.85)"; x.lineWidth = 7;
            x.strokeRect(8, 8, 240, 240);
            x.beginPath(); x.moveTo(8, 8); x.lineTo(248, 248); x.stroke();
            x.beginPath(); x.moveTo(248, 8); x.lineTo(8, 248); x.stroke();
            x.strokeStyle = "rgba(255,220,150,0.16)"; x.lineWidth = 3; x.strokeRect(24, 24, 208, 208);
            x.fillStyle = "rgba(60,35,15,0.25)"; for (let i = 0; i < 14; i++) x.fillRect(Math.random() * 256, Math.random() * 256, 14 + Math.random() * 30, 3);
            noise(x, 256, 256, 0.04, 800);
          });
          t = tex(c, 1, 1); break;
        }
        case "crateMetal": {
          const c = canvas(256, 256, x => {
            x.fillStyle = "#4d535c"; x.fillRect(0, 0, 256, 256);
            x.strokeStyle = "rgba(20,24,30,0.9)"; x.lineWidth = 6; x.strokeRect(10, 10, 236, 236);
            x.strokeStyle = "rgba(20,24,30,0.5)"; x.lineWidth = 2;
            for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, 256); x.stroke(); x.beginPath(); x.moveTo(0, i * 64); x.lineTo(256, i * 64); x.stroke(); }
            x.fillStyle = "rgba(255,255,255,0.08)"; for (let i = 0; i < 10; i++) x.fillRect(Math.random() * 256, Math.random() * 256, 8, 8);
          });
          t = tex(c, 1, 1); break;
        }
        case "brick": {
          const c = canvas(256, 256, x => {
            x.fillStyle = "#6f5a47"; x.fillRect(0, 0, 256, 256);
            x.fillStyle = "#7c6450";
            for (let row = 0; row < 8; row++) for (let col = -1; col < 6; col++) {
              const bx = col * 48 + (row % 2 ? 24 : 0);
              x.fillRect(bx + 2, row * 32 + 2, 44, 28);
            }
            x.strokeStyle = "rgba(50,35,25,0.6)"; x.lineWidth = 2;
            for (let row = 0; row < 8; row++) { x.beginPath(); x.moveTo(0, row * 32); x.lineTo(256, row * 32); x.stroke(); }
            noise(x, 256, 256, 0.05, 1400);
          });
          t = tex(c, 2, 2); break;
        }
        case "snow": {
          const c = canvas(256, 256, x => {
            x.fillStyle = "#e8edf2"; x.fillRect(0, 0, 256, 256);
            noise(x, 256, 256, 0.05, 2600);
            x.fillStyle = "rgba(160,190,220,0.16)"; for (let i = 0; i < 40; i++) x.fillRect(Math.random() * 256, Math.random() * 256, 10 + Math.random() * 40, 2);
            x.fillStyle = "rgba(255,255,255,0.5)"; for (let i = 0; i < 100; i++) x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
          });
          t = tex(c, 8, 8); break;
        }
        case "snowWall": {
          const c = canvas(256, 256, x => {
            x.fillStyle = "#b7c2cc"; x.fillRect(0, 0, 256, 256);
            x.fillStyle = "#c3cdd7"; for (let row = 0; row < 8; row++) x.fillRect(0, row * 34, 256, 26);
            x.strokeStyle = "rgba(80,95,110,0.35)"; x.lineWidth = 2;
            for (let row = 0; row <= 8; row++) { x.beginPath(); x.moveTo(0, row * 34); x.lineTo(256, row * 34); x.stroke(); }
            noise(x, 256, 256, 0.05, 1800);
          });
          t = tex(c, 2, 2); break;
        }
        case "ice": {
          const c = canvas(256, 256, x => {
            x.fillStyle = "#a9cfe0"; x.fillRect(0, 0, 256, 256);
            const g = x.createLinearGradient(0, 0, 256, 256);
            g.addColorStop(0, "rgba(255,255,255,0.35)"); g.addColorStop(1, "rgba(120,170,210,0.2)");
            x.fillStyle = g; x.fillRect(0, 0, 256, 256);
            x.strokeStyle = "rgba(255,255,255,0.5)"; x.lineWidth = 2;
            for (let i = 0; i < 8; i++) { const a = Math.random() * Math.PI; x.beginPath(); x.moveTo(128 + Math.cos(a) * 20, 128 + Math.sin(a) * 20); x.lineTo(128 + Math.cos(a) * 160, 128 + Math.sin(a) * 160); x.stroke(); }
            noise(x, 256, 256, 0.06, 1000);
          });
          t = tex(c, 5, 5); break;
        }
        case "metalFloor": {
          const c = canvas(256, 256, x => {
            x.fillStyle = "#525b66"; x.fillRect(0, 0, 256, 256);
            x.strokeStyle = "rgba(20,24,30,0.6)"; x.lineWidth = 3;
            for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32, 256); x.stroke(); }
            x.fillStyle = "rgba(255,180,40,0.25)"; x.fillRect(100, 100, 56, 56); x.strokeRect(100, 100, 56, 56);
            noise(x, 256, 256, 0.05, 900);
          });
          t = tex(c, 4, 4); break;
        }
        case "darkWall": {
          const c = canvas(256, 256, x => {
            x.fillStyle = "#4a525e"; x.fillRect(0, 0, 256, 256);
            noise(x, 256, 256, 0.06, 2000);
            x.strokeStyle = "rgba(20,24,30,0.5)"; x.lineWidth = 3;
            for (let i = 0; i <= 6; i++) { const y = i * 42; x.beginPath(); x.moveTo(0, y); x.lineTo(256, y); x.stroke(); }
            x.fillStyle = "rgba(120,160,200,0.08)"; for (let i = 0; i < 10; i++) x.fillRect(Math.random() * 256, Math.random() * 256, 30, 20);
          });
          t = tex(c, 2, 2); break;
        }
        case "tile": {
          const c = canvas(256, 256, x => {
            x.fillStyle = "#56606e"; x.fillRect(0, 0, 256, 256);
            x.fillStyle = "rgba(255,255,255,0.06)"; for (let i = 0; i < 6; i++) x.fillRect(Math.random() * 256, Math.random() * 256, 40, 40);
            x.strokeStyle = "rgba(20,25,32,0.5)"; x.lineWidth = 3;
            for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, 256); x.stroke(); x.beginPath(); x.moveTo(0, i * 64); x.lineTo(256, i * 64); x.stroke(); }
          });
          t = tex(c, 3, 3); break;
        }
        case "roof": {
          const c = canvas(256, 256, x => {
            x.fillStyle = "#282d34"; x.fillRect(0, 0, 256, 256);
            x.strokeStyle = "rgba(0,0,0,0.4)"; x.lineWidth = 3;
            for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32, 256); x.stroke(); x.beginPath(); x.moveTo(0, i * 32); x.lineTo(256, i * 32); x.stroke(); }
            x.fillStyle = "rgba(180,190,200,0.06)"; for (let i = 0; i < 30; i++) x.fillRect(Math.random() * 256, Math.random() * 256, 6, 6);
          });
          t = tex(c, 4, 4); break;
        }
        default: t = tex(canvas(64, 64, x => x.fillStyle = "#888" && x.fillRect(0, 0, 64, 64)));
      }
      cache[kind] = t;
      return t;
    },
    sky(kind) {
      const key = "sky_" + kind;
      if (cache[key]) return cache[key];
      const c = canvas(512, 256, x => {
        const top = kind === "snow" ? "#9fb8cf" : kind === "night" ? "#101820" : "#6fa8cf";
        const horizon = kind === "snow" ? "#dde5ec" : kind === "night" ? "#28323e" : "#e8d9b5";
        const g = x.createLinearGradient(0, 0, 0, 256);
        g.addColorStop(0, top); g.addColorStop(0.68, horizon); g.addColorStop(1, "#cbb98f");
        x.fillStyle = g; x.fillRect(0, 0, 512, 256);
        if (kind === "snow") {
          x.fillStyle = "rgba(255,255,255,0.9)";
          for (let i = 0; i < 40; i++) x.fillRect(Math.random() * 512, Math.random() * 120, 2, 2);
        } else if (kind !== "night") {
          x.fillStyle = "rgba(255,240,200,0.55)";
          x.beginPath(); x.arc(400, 56, 22, 0, Math.PI * 2); x.fill();
        }
      });
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      cache[key] = t;
      return t;
    },
    marker: function (color, text) {
      const c = canvas(128, 128, x => {
        x.fillStyle = color; x.beginPath(); x.arc(64, 64, 52, 0, Math.PI * 2); x.fill();
        x.fillStyle = "#fff"; x.font = "bold 34px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
        x.fillText(text, 64, 68);
      });
      return new THREE.CanvasTexture(c);
    }
  };
  window.TFPS.TEX = T;
})();
