// 터치 + 키보드 입력
// 화면 아무 데나 끌면 그 자리에 조이스틱이 생긴다. 달리기·손전등은 버튼.

const STICK_RADIUS = 74;
const DEAD_ZONE = 0.08;

export class Input {
  constructor(surface, stickEl) {
    this.surface = surface;
    this.stickEl = stickEl;
    this.knobEl = stickEl.querySelector('.knob');

    this.move = { x: 0, y: 0 };
    this.sprintHeld = false;
    this.lightToggled = false;

    this.stickId = null;
    this.stickOrigin = { x: 0, y: 0 };
    this.keys = new Set();
    this.pointerAim = null;

    this._bindTouch();
    this._bindKeyboard();
  }

  _bindTouch() {
    const el = this.surface;
    el.addEventListener('pointerdown', (e) => this._onDown(e), { passive: false });
    el.addEventListener('pointermove', (e) => this._onMove(e), { passive: false });
    el.addEventListener('pointerup', (e) => this._onUp(e));
    el.addEventListener('pointercancel', (e) => this._onUp(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _isTouch(e) {
    return e.pointerType === 'touch' || e.pointerType === 'pen';
  }

  _onDown(e) {
    if (!this._isTouch(e)) {
      // 데스크톱: 마우스는 조준에만 쓴다
      this.pointerAim = { x: e.clientX, y: e.clientY };
      return;
    }
    e.preventDefault();
    if (this.stickId !== null) return;
    this.stickId = e.pointerId;
    this.stickOrigin = { x: e.clientX, y: e.clientY };
    this.stickEl.style.left = `${e.clientX}px`;
    this.stickEl.style.top = `${e.clientY}px`;
    this.stickEl.classList.add('active');
    this._updateKnob(0, 0);
  }

  _onMove(e) {
    if (!this._isTouch(e)) {
      this.pointerAim = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.pointerId !== this.stickId) return;
    e.preventDefault();

    let dx = e.clientX - this.stickOrigin.x;
    let dy = e.clientY - this.stickOrigin.y;
    const dist = Math.hypot(dx, dy);

    // 손가락이 조이스틱 밖으로 나가면 중심을 따라 끌고 간다.
    // 이렇게 해야 손가락이 미끄러져도 조작을 놓치지 않는다.
    if (dist > STICK_RADIUS) {
      const pull = dist - STICK_RADIUS;
      this.stickOrigin.x += (dx / dist) * pull;
      this.stickOrigin.y += (dy / dist) * pull;
      this.stickEl.style.left = `${this.stickOrigin.x}px`;
      this.stickEl.style.top = `${this.stickOrigin.y}px`;
      dx = (dx / dist) * STICK_RADIUS;
      dy = (dy / dist) * STICK_RADIUS;
    }

    this._updateKnob(dx, dy);
    const mag = Math.min(Math.hypot(dx, dy) / STICK_RADIUS, 1);
    if (mag < DEAD_ZONE) {
      this.move.x = 0;
      this.move.y = 0;
    } else {
      const len = Math.hypot(dx, dy) || 1;
      // 데드존 밖에서는 곧바로 최대 속도가 나오도록 다시 편다
      const scaled = Math.min(1, (mag - DEAD_ZONE) / (1 - DEAD_ZONE) + 0.35);
      this.move.x = (dx / len) * scaled;
      this.move.y = (dy / len) * scaled;
    }
  }

  _onUp(e) {
    if (e.pointerId !== this.stickId) return;
    this.stickId = null;
    this.move.x = 0;
    this.move.y = 0;
    this.stickEl.classList.remove('active');
  }

  _updateKnob(dx, dy) {
    this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'f' || k === ' ') {
        if (!this.keys.has(k)) this.lightToggled = true;
        e.preventDefault();
      }
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.sprintHeld = false;
    });
  }

  toggleLight() {
    this.lightToggled = true;
  }

  setSprint(held) {
    this.sprintHeld = held;
  }

  // 프레임마다 호출. 키보드 상태를 이동 벡터로 합친다.
  sample() {
    const k = this.keys;
    let kx = 0;
    let ky = 0;
    if (k.has('a') || k.has('arrowleft')) kx -= 1;
    if (k.has('d') || k.has('arrowright')) kx += 1;
    if (k.has('w') || k.has('arrowup')) ky -= 1;
    if (k.has('s') || k.has('arrowdown')) ky += 1;

    let mx = this.move.x;
    let my = this.move.y;
    if (kx || ky) {
      const len = Math.hypot(kx, ky);
      mx = kx / len;
      my = ky / len;
    }

    const result = {
      x: mx,
      y: my,
      sprint: this.sprintHeld || k.has('shift'),
      aimDelta: 0,
      lightToggled: this.lightToggled,
      pointerAim: this.pointerAim,
    };
    this.lightToggled = false;
    return result;
  }
}
