// 게임 로직 — 이동, 수집, 추격 AI, 긴장도

import {
  TILE,
  generateMaze,
  mulberry32,
  isWall,
  floorTiles,
  tileCenter,
  hasLineOfSight,
  bfsPath,
} from './maze.js';

export const CFG = {
  cols: 13,
  rows: 17,
  playerRadius: 11,
  walkSpeed: 108,
  sprintSpeed: 176,
  turnSpeed: 11,
  staminaMax: 100,
  staminaDrain: 16,
  staminaRegen: 20,
  staminaDelay: 0.6,
  batteryMax: 100,
  batteryDrain: 1.5,
  batteryPickup: 32,
  beamRange: 7 * TILE,
  beamHalfAngle: 0.46,
  ambientRadius: 1.8 * TILE,
  cameraLookAhead: 2.6 * TILE,
  presentCount: 5,
  batteryCount: 7,
  enemyRadius: 13,
  enemyWander: 62,
  enemySearch: 112,
  enemyHunt: 132,
  // 놓친 채로 쫓을 때는 느려진다 — 모퉁이를 돌면 거리를 벌 수 있어야 한다
  enemyHuntBlind: 112,
  // 빔보다 조금 더 멀리 본다 — 보이기 전에 들킬 수 있어야 무섭다
  sightLit: 8.5 * TILE,
  // 어둠 속에서는 플레이어가 보는 범위보다 좁게 — 불을 끄면 실제로 유리해야 한다
  sightDark: 2.2 * TILE,
  hearSprint: 7 * TILE,
  hearWalk: 3.4 * TILE,
  loseTrackTime: 3.0,
  catchDistance: 18,
};

function vibrate(pattern) {
  if (navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch (e) {
      /* 지원하지 않는 브라우저 */
    }
  }
}

function resolveX(maze, e, r, dir) {
  if (!dir) return;
  const ty0 = Math.floor((e.y - r) / TILE);
  const ty1 = Math.floor((e.y + r) / TILE);
  const tx = Math.floor((e.x + dir * r) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) {
    if (isWall(maze, tx, ty)) {
      e.x = dir > 0 ? tx * TILE - r - 0.01 : (tx + 1) * TILE + r + 0.01;
      return;
    }
  }
}

function resolveY(maze, e, r, dir) {
  if (!dir) return;
  const tx0 = Math.floor((e.x - r) / TILE);
  const tx1 = Math.floor((e.x + r) / TILE);
  const ty = Math.floor((e.y + dir * r) / TILE);
  for (let tx = tx0; tx <= tx1; tx++) {
    if (isWall(maze, tx, ty)) {
      e.y = dir > 0 ? ty * TILE - r - 0.01 : (ty + 1) * TILE + r + 0.01;
      return;
    }
  }
}

function moveEntity(maze, e, dx, dy, r) {
  e.x += dx;
  resolveX(maze, e, r, Math.sign(dx));
  e.y += dy;
  resolveY(maze, e, r, Math.sign(dy));
}

function angleLerp(from, to, t) {
  let diff = ((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return from + diff * t;
}

export class Game {
  constructor(audio) {
    this.audio = audio;
  }

  start(seed) {
    const rand = mulberry32(seed >>> 0);
    this.rand = rand;
    this.seed = seed;
    this.maze = generateMaze(CFG.cols, CFG.rows, rand);

    const open = floorTiles(this.maze).filter(([x, y]) => !isWall(this.maze, x, y));
    const startTile = open[0];
    const start = tileCenter(startTile[0], startTile[1]);

    this.exit = { tx: startTile[0], ty: startTile[1], x: start.x, y: start.y };
    this.player = {
      x: start.x,
      y: start.y,
      angle: Math.PI / 2,
      light: true,
      battery: CFG.batteryMax,
      stamina: CFG.staminaMax,
      moving: false,
      sprinting: false,
      footPhase: 0,
    };

    const tileDist = (t) => Math.hypot(t[0] - startTile[0], t[1] - startTile[1]);

    // 선물은 시작 지점에서 멀리, 서로도 떨어뜨려 놓는다
    this.presents = [];
    const candidates = open.filter((t) => tileDist(t) > 7).sort(() => rand() - 0.5);
    for (const t of candidates) {
      if (this.presents.length >= CFG.presentCount) break;
      const c = tileCenter(t[0], t[1]);
      const tooClose = this.presents.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 6 * TILE);
      if (tooClose) continue;
      this.presents.push({ x: c.x, y: c.y, taken: false, bob: rand() * 6.28 });
    }
    // 미로가 작아 자리가 안 나오면 조건을 풀고 채운다
    while (this.presents.length < CFG.presentCount && candidates.length) {
      const t = candidates.pop();
      const c = tileCenter(t[0], t[1]);
      this.presents.push({ x: c.x, y: c.y, taken: false, bob: rand() * 6.28 });
    }

    this.batteries = [];
    const batteryPool = open.filter((t) => tileDist(t) > 3).sort(() => rand() - 0.5);
    for (let i = 0; i < CFG.batteryCount && i < batteryPool.length; i++) {
      const c = tileCenter(batteryPool[i][0], batteryPool[i][1]);
      this.batteries.push({ x: c.x, y: c.y, taken: false });
    }

    this.spawnPool = open.filter((t) => tileDist(t) > 11);
    this.enemies = [this._makeEnemy()];

    this.collected = 0;
    this.time = 0;
    this.tension = 0;
    this.shake = 0;
    this.status = 'playing';
    this.doorOpen = false;
    this.wasSpotted = false;
    this.flicker = 1;
    this.jingleTimer = 0;
    this.heartTimer = 0;
    this.footTimer = 0;
    this.hint = '어둠 속에서 선물 5개를 찾아 현관으로 돌아가세요';
    this.hintTimer = 5;
  }

  _makeEnemy() {
    const pool = this.spawnPool.length ? this.spawnPool : floorTiles(this.maze);
    const t = pool[(this.rand() * pool.length) | 0];
    const c = tileCenter(t[0], t[1]);
    return {
      x: c.x,
      y: c.y,
      angle: this.rand() * Math.PI * 2,
      state: 'wander',
      path: null,
      pathTimer: 0,
      lostTimer: 0,
      wobble: this.rand() * 6.28,
      lastSeen: null,
    };
  }

  update(dt, input) {
    if (this.status !== 'playing') return;
    this.time += dt;
    if (this.hintTimer > 0) this.hintTimer -= dt;

    this._updatePlayer(dt, input);
    this._updatePickups(dt);
    for (const enemy of this.enemies) this._updateEnemy(dt, enemy);
    this._updateThreat(dt);
    this._updateAudioCues(dt);

    this.shake = Math.max(0, this.shake - dt * 3);

    if (this.collected >= this.presents.length && !this.doorOpen) {
      this.doorOpen = true;
      this.audio.door();
      this.hint = '현관문이 열렸습니다. 돌아가세요.';
      this.hintTimer = 4;
      vibrate([40, 60, 40]);
    }

    if (this.doorOpen && Math.hypot(this.player.x - this.exit.x, this.player.y - this.exit.y) < TILE * 0.7) {
      this.status = 'won';
      this.audio.setTension(0);
      this.audio.playEscapeMusic();
      vibrate([60, 40, 60, 40, 120]);
    }
  }

  _updatePlayer(dt, input) {
    const p = this.player;

    if (input.lightToggled && p.battery > 0) {
      p.light = !p.light;
      this.audio.lightSwitch(p.light);
    }
    if (p.battery <= 0) p.light = false;

    // 조준: 조이스틱 방향을 따라가되, 오른쪽 드래그로 미세 조정
    const moveMag = Math.hypot(input.x, input.y);
    if (moveMag > 0.15) {
      const target = Math.atan2(input.y, input.x);
      p.angle = angleLerp(p.angle, target, Math.min(1, dt * CFG.turnSpeed));
    }
    p.angle += input.aimDelta;
    if (input.pointerAim) {
      p.angle = Math.atan2(input.pointerAim.y - innerHeight / 2, input.pointerAim.x - innerWidth / 2);
    }

    const wantSprint = input.sprint && moveMag > 0.3 && p.stamina > 1;
    p.sprinting = wantSprint;
    if (wantSprint) {
      p.stamina = Math.max(0, p.stamina - CFG.staminaDrain * dt);
      p.staminaIdle = 0;
    } else {
      p.staminaIdle = (p.staminaIdle || 0) + dt;
      if (p.staminaIdle > CFG.staminaDelay) {
        p.stamina = Math.min(CFG.staminaMax, p.stamina + CFG.staminaRegen * dt);
      }
    }

    const speed = wantSprint ? CFG.sprintSpeed : CFG.walkSpeed;
    const vx = input.x * speed * dt;
    const vy = input.y * speed * dt;
    p.moving = moveMag > 0.15;
    if (p.moving) moveEntity(this.maze, p, vx, vy, CFG.playerRadius);

    if (p.light) {
      p.battery = Math.max(0, p.battery - CFG.batteryDrain * dt);
      // 배터리가 바닥나면 깜빡이기 시작한다
      this.flicker = p.battery < 18 ? (Math.random() < 0.09 ? 0.25 : 1) : 1;
    } else {
      this.flicker = 1;
    }

    // 발소리
    if (p.moving) {
      this.footTimer -= dt * (wantSprint ? 1.8 : 1);
      if (this.footTimer <= 0) {
        this.footTimer = 0.42;
        this.audio.footstep(wantSprint);
      }
    }
  }

  _updatePickups() {
    const p = this.player;
    for (const present of this.presents) {
      if (present.taken) continue;
      if (Math.hypot(present.x - p.x, present.y - p.y) < TILE * 0.55) {
        present.taken = true;
        this.collected++;
        this.audio.pickup();
        vibrate(35);
        this.hint = `선물 ${this.collected} / ${this.presents.length}`;
        this.hintTimer = 2;
        // 절반쯤 모으면 집 안의 다른 것도 깨어난다
        if (this.collected === 4 && this.enemies.length < 2) {
          this.enemies.push(this._makeEnemy());
          this.hint = '무언가 하나 더 깨어났습니다';
          this.hintTimer = 3;
          this.audio.spotted();
          vibrate([80, 50, 80]);
        }
      }
    }
    for (const bat of this.batteries) {
      if (bat.taken) continue;
      if (Math.hypot(bat.x - p.x, bat.y - p.y) < TILE * 0.5) {
        bat.taken = true;
        p.battery = Math.min(CFG.batteryMax, p.battery + CFG.batteryPickup);
        this.audio.battery();
        vibrate(20);
      }
    }
  }

  _canSeePlayer(enemy) {
    const p = this.player;
    const dx = enemy.x - p.x;
    const dy = enemy.y - p.y;
    const dist = Math.hypot(dx, dy);

    let range = CFG.sightDark;
    if (p.light && p.battery > 0) {
      // 빔이 향한 쪽에 있으면 멀리서도 보인다. 등 뒤로는 새어나오는 빛만 보인다.
      const toEnemy = Math.atan2(dy, dx);
      let off = Math.abs(((toEnemy - p.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      range = off < 1.2 ? CFG.sightLit : CFG.sightLit * 0.5;
    }
    if (dist > range) return false;
    return hasLineOfSight(this.maze, enemy.x, enemy.y, p.x, p.y);
  }

  _hearsPlayer(enemy) {
    const p = this.player;
    if (!p.moving) return false;
    const dist = Math.hypot(p.x - enemy.x, p.y - enemy.y);
    return dist < (p.sprinting ? CFG.hearSprint : CFG.hearWalk);
  }

  _updateEnemy(dt, enemy) {
    const p = this.player;
    const sees = this._canSeePlayer(enemy);

    if (sees) {
      if (enemy.state !== 'hunt') {
        enemy.state = 'hunt';
        this.audio.spotted();
        vibrate([30, 40, 30]);
        this.shake = Math.min(1, this.shake + 0.5);
        if (!this.wasSpotted) {
          this.wasSpotted = true;
          this.hint = '손전등을 끄고 도망치세요';
          this.hintTimer = 3;
        }
      }
      enemy.lostTimer = 0;
      enemy.lastSeen = { x: p.x, y: p.y };
    } else if (enemy.state === 'hunt') {
      enemy.lostTimer += dt;
      if (enemy.lostTimer > CFG.loseTrackTime) {
        enemy.state = 'search';
        enemy.path = null;
      }
    } else if (this._hearsPlayer(enemy)) {
      enemy.state = 'search';
      enemy.lastSeen = { x: p.x, y: p.y };
      enemy.path = null;
    }

    // 쫓을 때도 "마지막으로 본 자리"만 안다. 모퉁이를 돌면 따돌릴 수 있어야 한다.
    let goal = null;
    if ((enemy.state === 'hunt' || enemy.state === 'search') && enemy.lastSeen) goal = enemy.lastSeen;

    enemy.pathTimer -= dt;
    if (enemy.pathTimer <= 0 || !enemy.path || !enemy.path.length) {
      enemy.pathTimer = enemy.state === 'hunt' ? 0.3 : 0.8;
      if (!goal) {
        // 배회: 임의의 먼 지점을 목표로 삼는다
        const pool = this.spawnPool.length ? this.spawnPool : floorTiles(this.maze);
        const t = pool[(this.rand() * pool.length) | 0];
        goal = tileCenter(t[0], t[1]);
        enemy.lastSeen = null;
      }
      enemy.path = bfsPath(
        this.maze,
        Math.floor(enemy.x / TILE),
        Math.floor(enemy.y / TILE),
        Math.floor(goal.x / TILE),
        Math.floor(goal.y / TILE)
      );
      if (enemy.state === 'search' && enemy.lastSeen) {
        const d = Math.hypot(enemy.x - enemy.lastSeen.x, enemy.y - enemy.lastSeen.y);
        if (d < TILE) {
          enemy.state = 'wander';
          enemy.lastSeen = null;
        }
      }
    }

    let speed = CFG.enemyWander;
    if (enemy.state === 'hunt') speed = sees ? CFG.enemyHunt : CFG.enemyHuntBlind;
    else if (enemy.state === 'search') speed = CFG.enemySearch;

    if (enemy.path && enemy.path.length) {
      const [tx, ty] = enemy.path[0];
      const c = tileCenter(tx, ty);
      const dx = c.x - enemy.x;
      const dy = c.y - enemy.y;
      const d = Math.hypot(dx, dy);
      if (d < 6) {
        enemy.path.shift();
      } else {
        moveEntity(this.maze, enemy, (dx / d) * speed * dt, (dy / d) * speed * dt, CFG.enemyRadius);
        enemy.angle = angleLerp(enemy.angle, Math.atan2(dy, dx), Math.min(1, dt * 8));
      }
    }

    enemy.wobble += dt * (enemy.state === 'hunt' ? 9 : 3);
    enemy.visible = sees;

    if (Math.hypot(p.x - enemy.x, p.y - enemy.y) < CFG.catchDistance) {
      this._die();
    }
  }

  _die() {
    if (this.status !== 'playing') return;
    this.status = 'dead';
    this.audio.jumpscare();
    this.audio.stopMusic();
    this.shake = 1.5;
    vibrate([0, 400, 80, 300]);
  }

  _updateThreat(dt) {
    const p = this.player;
    let tension = 0;
    for (const enemy of this.enemies) {
      const dist = Math.hypot(p.x - enemy.x, p.y - enemy.y);
      const prox = Math.max(0, 1 - dist / (14 * TILE));
      const t = enemy.state === 'hunt' ? Math.max(0.7, prox) : prox * 0.55;
      tension = Math.max(tension, t);
    }
    this.tension += (tension - this.tension) * Math.min(1, dt * 3);
    this.audio.setTension(this.tension);
  }

  _updateAudioCues(dt) {
    const p = this.player;

    // 가까이 있으면 숨소리가 들린다 — 어둠 속에서 부딪히기 전에 알아챌 유일한 단서
    let nearest = Infinity;
    for (const enemy of this.enemies) {
      nearest = Math.min(nearest, Math.hypot(p.x - enemy.x, p.y - enemy.y));
    }
    if (nearest < 5.5 * TILE) {
      this.breathTimer = (this.breathTimer || 0) - dt;
      if (this.breathTimer <= 0) {
        this.breathTimer = 1.5 + this.rand() * 0.8;
        this.audio.breath(Math.max(0, 1 - nearest / (5.5 * TILE)));
      }
    }

    // 심장 박동 — 긴장할수록 빨라진다
    if (this.tension > 0.12) {
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        this.heartTimer = 1.15 - this.tension * 0.65;
        this.audio.heartbeat(Math.min(1, this.tension * 1.2));
      }
    }

    // 가장 가까운 선물의 방울 소리 — 볼륨이 곧 나침반이다
    const remaining = this.presents.filter((x) => !x.taken);
    if (remaining.length) {
      this.jingleTimer -= dt;
      if (this.jingleTimer <= 0) {
        let best = Infinity;
        for (const present of remaining) {
          best = Math.min(best, Math.hypot(present.x - p.x, present.y - p.y));
        }
        const closeness = Math.max(0, 1 - best / (13 * TILE));
        this.jingleTimer = 1.9 - closeness * 0.9;
        if (closeness > 0.02) this.audio.jingle(closeness);
      }
    }
  }

  nearestPresentDistance() {
    const remaining = this.presents.filter((x) => !x.taken);
    if (!remaining.length) return null;
    let best = Infinity;
    for (const present of remaining) {
      best = Math.min(best, Math.hypot(present.x - this.player.x, present.y - this.player.y));
    }
    return best;
  }
}
