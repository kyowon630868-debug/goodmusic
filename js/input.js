// 터치 + 키보드 입력
// 왼쪽 절반: 가상 조이스틱(이동 + 시선). 오른쪽 절반: 누르면 달리기, 좌우로 끌면 시선 회전.

const STICK_RADIUS = 62;

export class Input {
  constructor(surface, stickEl) {
    this.surface = surface;
    this.stickEl = stickEl;
    this.knobEl = stickEl.querySelector('.knob');

    this.move = { x: 0, y: 0 };
    this.sprint = false;
    this.aimDelta = 0;
    this.lightToggled = false;
    this.anyKeyPressed = false;

    this.stickId = null;
    this.stickOrigin = { x: 0, y: 0 };
    this.lookId = null;
    this.lookLastX = 0;
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
    this.anyKeyPressed = true;
    if (!this._isTouch(e)) {
      // 데스크톱: 마우스는 조준에만 쓴다
      this.pointerAim = { x: e.clientX, y: e.clientY };
      return;
    }
    e.preventDefault();
    const half = window.innerWidth / 2;
    if (e.clientX < half && this.stickId === null) {
      this.stickId = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stickEl.style.left = `${e.clientX}px`;
      this.stickEl.style.top = `${e.clientY}px`;
      this.stickEl.classList.add('active');
      this._updateKnob(0, 0);
    } else if (e.clientX >= half && this.lookId === null) {
      this.lookId = e.pointerId;
      this.lookLastX = e.clientX;
      this.sprint = true;
    }
  }

  _onMove(e) {
    if (!this._isTouch(e)) {
      this.pointerAim = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.pointerId === this.stickId) {
      e.preventDefault();
      let dx = e.clientX - this.stickOrigin.x;
      let dy = e.clientY - this.stickOrigin.y;
      const dist = Math.hypot(dx, dy);
      if (dist > STICK_RADIUS) {
        dx = (dx / dist) * STICK_RADIUS;
        dy = (dy / dist) * STICK_RADIUS;
      }
      this._updateKnob(dx, dy);
      const mag = Math.min(dist / STICK_RADIUS, 1);
      if (mag < 0.14) {
        this.move.x = 0;
        this.move.y = 0;
      } else {
        const len = Math.hypot(dx, dy) || 1;
        this.move.x = (dx / len) * mag;
        this.move.y = (dy / len) * mag;
      }
    } else if (e.pointerId === this.lookId) {
      e.preventDefault();
      this.aimDelta += (e.clientX - this.lookLastX) * 0.007;
      this.lookLastX = e.clientX;
    }
  }

  _onUp(e) {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.move.x = 0;
      this.move.y = 0;
      this.stickEl.classList.remove('active');
    } else if (e.pointerId === this.lookId) {
      this.lookId = null;
      this.sprint = false;
    }
  }

  _updateKnob(dx, dy) {
    this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      this.anyKeyPressed = true;
      const k = e.key.toLowerCase();
      if (k === 'f' || k === ' ') {
        if (!this.keys.has(k)) this.lightToggled = true;
        e.preventDefault();
      }
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  toggleLight() {
    this.lightToggled = true;
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
      sprint: this.sprint || k.has('shift'),
      aimDelta: this.aimDelta,
      lightToggled: this.lightToggled,
      pointerAim: this.pointerAim,
    };
    this.aimDelta = 0;
    this.lightToggled = false;
    return result;
  }
}
