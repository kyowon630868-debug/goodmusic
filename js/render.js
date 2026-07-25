// 렌더러 — 어둠, 손전등 광선, 그것

import { TILE, isWall, castRay } from './maze.js';
import { CFG } from './game.js';

const BEAM_RAYS = 132;
const AMBIENT_RAYS = 44;

function hash(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: 0 };
    this.grain = this._makeGrain();
    this.deathTime = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _makeGrain() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.cssW = window.innerWidth;
    this.cssH = window.innerHeight;
    this.canvas.width = Math.floor(this.cssW * dpr);
    this.canvas.height = Math.floor(this.cssH * dpr);
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    this.dpr = dpr;
    // 손전등 빔이 화면 밖으로 새지 않을 만큼만 확대한다
    const raw = Math.min(this.cssW, this.cssH * 0.62) / (8.6 * TILE);
    this.scale = Math.max(0.75, Math.min(1.2, raw));
  }

  render(game, dt) {
    const ctx = this.ctx;
    const p = game.player;

    // 카메라는 바라보는 쪽으로 앞서 나가고, 놀랐을 때 흔들린다.
    // 불을 끄면 볼 수 있는 범위가 좁아지므로 앞서 나갈 이유도 없다.
    const lit = p.light && p.battery > 0;
    const look = CFG.cameraLookAhead * (lit ? 1 : 0.22);
    const targetX = p.x + Math.cos(p.angle) * look;
    const targetY = p.y + Math.sin(p.angle) * look;
    this.cam.x += (targetX - this.cam.x) * Math.min(1, dt * 5);
    this.cam.y += (targetY - this.cam.y) * Math.min(1, dt * 5);
    const shake = game.shake;
    const sx = (Math.random() - 0.5) * shake * 16;
    const sy = (Math.random() - 0.5) * shake * 16;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    const s = this.scale;
    const originX = this.cssW / 2 - (this.cam.x + sx) * s;
    const originY = this.cssH / 2 - (this.cam.y + sy) * s;
    this.playerScreen = { x: originX + p.x * s, y: originY + p.y * s };
    ctx.setTransform(this.dpr * s, 0, 0, this.dpr * s, this.dpr * originX, this.dpr * originY);

    const lightOn = p.light && p.battery > 0 && game.flicker > 0.5;

    // 주변 시야 (아주 좁은 원)
    const ambient = this._visibilityPolygon(game, p.angle, Math.PI, AMBIENT_RAYS, CFG.ambientRadius);
    ctx.save();
    this._pathPolygon(ctx, ambient);
    ctx.clip();
    this._drawScene(ctx, game);
    this._falloff(ctx, p, CFG.ambientRadius, 0.6, 1.0);
    // 손전등의 따뜻한 빛과 구분되는 차가운 어스름
    ctx.fillStyle = 'rgba(40,58,92,0.22)';
    ctx.fill();
    ctx.restore();

    if (lightOn) {
      const beam = this._visibilityPolygon(game, p.angle, CFG.beamHalfAngle, BEAM_RAYS, CFG.beamRange);
      ctx.save();
      this._pathPolygon(ctx, beam);
      ctx.clip();
      this._drawScene(ctx, game);
      this._falloff(ctx, p, CFG.beamRange, 0.0, 0.86);
      // 따뜻한 빛 번짐
      const warm = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, CFG.beamRange);
      warm.addColorStop(0, 'rgba(255,226,160,0.20)');
      warm.addColorStop(0.45, 'rgba(255,208,130,0.07)');
      warm.addColorStop(1, 'rgba(255,190,110,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = warm;
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }

    this._drawPlayer(ctx, game, lightOn);

    // 화면 효과
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._vignette(ctx, game);
    if (game.status === 'dead') {
      this.deathTime += dt;
      this._jumpscare(ctx, game);
    } else {
      this.deathTime = 0;
    }
    this._drawGrain(ctx, game);
    if (game.doorOpen && game.status === 'playing') this._exitArrow(ctx, game);
  }

  _visibilityPolygon(game, centerAngle, halfAngle, rays, range) {
    const p = game.player;
    const pts = [];
    for (let i = 0; i <= rays; i++) {
      const a = centerAngle - halfAngle + (halfAngle * 2 * i) / rays;
      pts.push(castRay(game.maze, p.x, p.y, a, range));
    }
    return { origin: p, pts, full: halfAngle >= Math.PI - 1e-6 };
  }

  _pathPolygon(ctx, poly) {
    ctx.beginPath();
    if (!poly.full) ctx.moveTo(poly.origin.x, poly.origin.y);
    else ctx.moveTo(poly.pts[0].x, poly.pts[0].y);
    for (const pt of poly.pts) ctx.lineTo(pt.x, pt.y);
    ctx.closePath();
  }

  _falloff(ctx, p, range, innerAlpha, outerAlpha) {
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, range);
    g.addColorStop(0, `rgba(0,0,0,${innerAlpha})`);
    g.addColorStop(0.55, `rgba(0,0,0,${(innerAlpha + outerAlpha) / 2.2})`);
    g.addColorStop(1, `rgba(0,0,0,${outerAlpha})`);
    ctx.fillStyle = g;
    ctx.fill();
  }

  _drawScene(ctx, game) {
    const maze = game.maze;
    const p = game.player;
    const view = CFG.beamRange + TILE;
    const tx0 = Math.max(0, Math.floor((p.x - view) / TILE));
    const tx1 = Math.min(maze.w - 1, Math.ceil((p.x + view) / TILE));
    const ty0 = Math.max(0, Math.floor((p.y - view) / TILE));
    const ty1 = Math.min(maze.h - 1, Math.ceil((p.y + view) / TILE));

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const x = tx * TILE;
        const y = ty * TILE;
        if (isWall(maze, tx, ty)) {
          const v = hash(tx, ty);
          ctx.fillStyle = `rgb(${(96 + v * 26) | 0}, ${(80 + v * 22) | 0}, ${(71 + v * 20) | 0})`;
          ctx.fillRect(x, y, TILE, TILE);
          // 벽지 무늬
          ctx.fillStyle = 'rgba(48,32,26,0.35)';
          for (let i = 0; i < 3; i++) ctx.fillRect(x + 6 + i * 14, y, 3, TILE);
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(x, y + TILE - 5, TILE, 5);
          ctx.fillStyle = 'rgba(220,196,170,0.16)';
          ctx.fillRect(x, y, TILE, 3);
        } else {
          const v = hash(tx * 3.1, ty * 1.7);
          ctx.fillStyle = `rgb(${(54 + v * 16) | 0}, ${(44 + v * 13) | 0}, ${(37 + v * 11) | 0})`;
          ctx.fillRect(x, y, TILE, TILE);
          // 마룻바닥 결
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.fillRect(x, y + 15, TILE, 1);
          ctx.fillRect(x, y + 33, TILE, 1);
          ctx.fillStyle = 'rgba(255,240,215,0.04)';
          ctx.fillRect(x, y + 16, TILE, 1);
        }
      }
    }

    this._drawExit(ctx, game);

    for (const bat of game.batteries) {
      if (bat.taken) continue;
      ctx.fillStyle = '#caa63a';
      ctx.fillRect(bat.x - 5, bat.y - 9, 10, 18);
      ctx.fillStyle = '#8d6f1f';
      ctx.fillRect(bat.x - 5, bat.y - 9, 10, 4);
      ctx.fillStyle = 'rgba(255,230,140,0.55)';
      ctx.fillRect(bat.x - 2, bat.y - 12, 4, 3);
    }

    const t = game.time;
    for (const present of game.presents) {
      if (present.taken) continue;
      const bob = Math.sin(t * 2 + present.bob) * 2;
      const px = present.x;
      const py = present.y + bob;
      ctx.save();
      ctx.shadowColor = 'rgba(220,60,60,0.85)';
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#8e2230';
      ctx.fillRect(px - 12, py - 11, 24, 22);
      ctx.restore();
      ctx.fillStyle = '#d8c47a';
      ctx.fillRect(px - 3, py - 11, 6, 22);
      ctx.fillRect(px - 12, py - 3, 24, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(px - 12, py - 11, 24, 3);
    }

    for (const enemy of game.enemies) this._drawEnemy(ctx, enemy, game);
  }

  _drawExit(ctx, game) {
    const e = game.exit;
    const open = game.doorOpen;
    ctx.save();
    if (open) {
      ctx.shadowColor = 'rgba(255,70,50,0.9)';
      ctx.shadowBlur = 28;
    }
    ctx.fillStyle = open ? '#5c2018' : '#2e2018';
    ctx.fillRect(e.x - 17, e.y - 24, 34, 48);
    ctx.restore();
    ctx.fillStyle = open ? 'rgba(255,140,90,0.35)' : 'rgba(150,120,90,0.18)';
    ctx.fillRect(e.x - 17, e.y - 24, 34, 3);
    ctx.fillStyle = '#c9a24a';
    ctx.beginPath();
    ctx.arc(e.x + 11, e.y, 2.6, 0, Math.PI * 2);
    ctx.fill();
    // 문 위의 낡은 화환
    ctx.strokeStyle = open ? 'rgba(120,180,110,0.65)' : 'rgba(70,95,65,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(e.x, e.y - 15, 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 창백하고 비쩍 마른 형상. 어두운 실루엣은 바닥에 묻혀 보이지 않으므로
  // 반대로 빛에 드러났을 때 확 튀도록 밝게 그린다.
  _drawEnemy(ctx, enemy) {
    const hunting = enemy.state === 'hunt';
    const sway = Math.sin(enemy.wobble) * (hunting ? 6 : 3);
    const lean = hunting ? 0.14 : 0.045;
    const skin = hunting ? '#d8c4bc' : '#c2bcae';
    const shade = hunting ? '#7d5c58' : '#6e6a5f';

    ctx.save();
    ctx.translate(enemy.x, enemy.y);

    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.beginPath();
    ctx.ellipse(0, 13, 16, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(Math.sin(enemy.wobble * 0.5) * lean);

    // 늘어진 팔은 몸 뒤에서 먼저
    ctx.strokeStyle = shade;
    ctx.lineWidth = 4.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-7, -24);
    ctx.quadraticCurveTo(-19 - sway * 0.7, -6, -15 - sway, 18);
    ctx.moveTo(7, -24);
    ctx.quadraticCurveTo(19 + sway * 0.7, -6, 15 + sway, 18);
    ctx.stroke();

    // 길고 마른 몸
    const body = ctx.createLinearGradient(-11, 0, 11, 0);
    body.addColorStop(0, shade);
    body.addColorStop(0.42, skin);
    body.addColorStop(1, shade);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-10, 15);
    ctx.quadraticCurveTo(-7, -14, -5.5, -30);
    ctx.lineTo(5.5, -30);
    ctx.quadraticCurveTo(7, -14, 10, 15);
    ctx.closePath();
    ctx.fill();

    // 갈비뼈
    ctx.strokeStyle = 'rgba(40,30,28,0.4)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 4; i++) {
      const y = -22 + i * 6;
      ctx.beginPath();
      ctx.moveTo(-6, y);
      ctx.lineTo(6, y);
      ctx.stroke();
    }

    // 머리 — 늘 조금 기울어져 있다
    ctx.save();
    ctx.translate(0, -35);
    ctx.rotate(Math.sin(enemy.wobble * 0.33) * 0.32 + (hunting ? 0.28 : 0));
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(0, 0, 8.5, 11, 0, 0, Math.PI * 2);
    ctx.fill();

    // 움푹 팬 눈구멍
    ctx.fillStyle = '#0a0709';
    ctx.beginPath();
    ctx.ellipse(-3.4, -1.5, 2.7, 3.6, 0, 0, Math.PI * 2);
    ctx.ellipse(3.4, -1.5, 2.7, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = hunting ? 'rgba(255,60,40,0.95)' : 'rgba(190,215,255,0.7)';
    ctx.shadowBlur = hunting ? 16 : 7;
    ctx.fillStyle = hunting ? '#ff6a4a' : '#9fb6d4';
    ctx.beginPath();
    ctx.arc(-3.4, -1.2, 1.15, 0, Math.PI * 2);
    ctx.arc(3.4, -1.2, 1.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // 벌어진 입
    ctx.fillStyle = '#150e10';
    ctx.beginPath();
    ctx.ellipse(0, 6, 2.2, hunting ? 3.6 : 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 추격 중에는 붉은 기운이 번진다
    if (hunting) {
      ctx.globalCompositeOperation = 'lighter';
      const aura = ctx.createRadialGradient(0, -12, 4, 0, -12, 40);
      aura.addColorStop(0, 'rgba(150,20,10,0.30)');
      aura.addColorStop(1, 'rgba(150,20,10,0)');
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(0, -12, 40, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.restore();
  }

  _drawPlayer(ctx, game, lightOn) {
    const p = game.player;
    ctx.save();
    ctx.translate(p.x, p.y);

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.ellipse(0, 6, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(p.angle);
    ctx.fillStyle = '#2c3b4a';
    ctx.beginPath();
    ctx.ellipse(0, 0, 11, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5d7385';
    ctx.beginPath();
    ctx.ellipse(3, 0, 6.5, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
    if (lightOn) {
      ctx.fillStyle = 'rgba(255,235,180,0.95)';
      ctx.beginPath();
      ctx.arc(9, 0, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _vignette(ctx, game) {
    const w = this.cssW;
    const h = this.cssH;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.22, w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.78)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    if (game.tension > 0.25) {
      const a = (game.tension - 0.25) * 0.42;
      const r = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.6);
      r.addColorStop(0, 'rgba(90,0,0,0)');
      r.addColorStop(1, `rgba(120,0,0,${a})`);
      ctx.fillStyle = r;
      ctx.fillRect(0, 0, w, h);
    }
  }

  _drawGrain(ctx, game) {
    ctx.save();
    ctx.globalAlpha = 0.045 + game.tension * 0.05;
    const ox = -Math.random() * 128;
    const oy = -Math.random() * 128;
    const pattern = ctx.createPattern(this.grain, 'repeat');
    ctx.translate(ox, oy);
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, this.cssW + 128, this.cssH + 128);
    ctx.restore();
  }

  _exitArrow(ctx, game) {
    const p = game.player;
    const ang = Math.atan2(game.exit.y - p.y, game.exit.x - p.x);
    const r = Math.min(this.cssW, this.cssH) * 0.33;
    const origin = this.playerScreen || { x: this.cssW / 2, y: this.cssH / 2 };
    const cx = origin.x + Math.cos(ang) * r;
    const cy = origin.y + Math.sin(ang) * r;
    const pulse = 0.55 + Math.sin(game.time * 5) * 0.3;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#ff5540';
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-8, -9);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _jumpscare(ctx, game) {
    const t = this.deathTime;
    const w = this.cssW;
    const h = this.cssH;
    const flash = Math.max(0, 1 - t * 2.2);
    ctx.fillStyle = `rgba(90,0,0,${0.5 + flash * 0.5})`;
    ctx.fillRect(0, 0, w, h);

    // 그것의 얼굴이 화면을 가득 채우며 달려든다
    const grow = Math.min(1, t * 5);
    const jitter = Math.max(0, 1 - t * 0.8) * 18;
    ctx.save();
    ctx.translate(w / 2 + (Math.random() - 0.5) * jitter, h / 2 + (Math.random() - 0.5) * jitter);
    ctx.rotate((Math.random() - 0.5) * 0.05 * Math.max(0, 1 - t));
    const size = Math.min(w, h) * 0.44 * (0.55 + grow * 0.85);
    ctx.globalAlpha = Math.min(1, t * 4);

    const skin = ctx.createRadialGradient(0, -size * 0.2, size * 0.1, 0, 0, size);
    skin.addColorStop(0, '#ded4c4');
    skin.addColorStop(0.6, '#a99c8c');
    skin.addColorStop(1, '#3a3029');
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.66, size, 0, 0, Math.PI * 2);
    ctx.fill();
    // 울퉁불퉁한 두개골 윤곽
    ctx.beginPath();
    ctx.ellipse(-size * 0.4, -size * 0.42, size * 0.26, size * 0.3, -0.4, 0, Math.PI * 2);
    ctx.ellipse(size * 0.42, -size * 0.3, size * 0.22, size * 0.26, 0.5, 0, Math.PI * 2);
    ctx.ellipse(-size * 0.3, size * 0.55, size * 0.24, size * 0.3, 0.3, 0, Math.PI * 2);
    ctx.fill();

    // 살갗 아래 비치는 핏줄
    ctx.strokeStyle = 'rgba(70,30,28,0.35)';
    ctx.lineWidth = size * 0.012;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * size * 0.12, Math.sin(a) * size * 0.16);
      ctx.quadraticCurveTo(
        Math.cos(a + 0.5) * size * 0.4,
        Math.sin(a + 0.5) * size * 0.55,
        Math.cos(a) * size * 0.6,
        Math.sin(a) * size * 0.9
      );
      ctx.stroke();
    }

    // 움푹 팬 눈구멍
    ctx.fillStyle = '#070507';
    ctx.beginPath();
    ctx.ellipse(-size * 0.27, -size * 0.2, size * 0.15, size * 0.19, 0, 0, Math.PI * 2);
    ctx.ellipse(size * 0.27, -size * 0.2, size * 0.15, size * 0.19, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = 'rgba(255,60,40,0.95)';
    ctx.shadowBlur = 35;
    ctx.fillStyle = '#ff5a3c';
    ctx.beginPath();
    ctx.arc(-size * 0.25, -size * 0.18, size * 0.035, 0, Math.PI * 2);
    ctx.arc(size * 0.25, -size * 0.18, size * 0.035, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // 크게 벌어진 입
    ctx.fillStyle = '#0b0709';
    ctx.beginPath();
    ctx.ellipse(0, size * 0.42, size * 0.22, size * 0.32 * (0.5 + grow * 0.5), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(150,40,35,0.55)';
    ctx.beginPath();
    ctx.ellipse(0, size * 0.52, size * 0.13, size * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
