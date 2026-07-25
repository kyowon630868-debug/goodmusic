// 미로 생성 및 타일 유틸리티

export const WALL = 1;
export const FLOOR = 0;
export const TILE = 48;

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 재귀적 백트래킹으로 완전 미로를 만든 뒤, 벽 일부를 허물어 순환로와 방을 만든다.
// 막다른 길만 있는 미로는 추격전에서 너무 가혹하기 때문.
export function generateMaze(cols, rows, rand) {
  const w = cols * 2 + 1;
  const h = rows * 2 + 1;
  const tiles = new Uint8Array(w * h).fill(WALL);
  const at = (x, y) => y * w + x;

  const visited = new Uint8Array(cols * rows);
  const stack = [[0, 0]];
  visited[0] = 1;
  tiles[at(1, 1)] = FLOOR;

  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => {
      const nx = cx + dx;
      const ny = cy + dy;
      return nx >= 0 && ny >= 0 && nx < cols && ny < rows && !visited[ny * cols + nx];
    });
    if (!dirs.length) {
      stack.pop();
      continue;
    }
    const [dx, dy] = dirs[(rand() * dirs.length) | 0];
    const nx = cx + dx;
    const ny = cy + dy;
    tiles[at(cx * 2 + 1 + dx, cy * 2 + 1 + dy)] = FLOOR;
    tiles[at(nx * 2 + 1, ny * 2 + 1)] = FLOOR;
    visited[ny * cols + nx] = 1;
    stack.push([nx, ny]);
  }

  // 순환로: 두 통로 사이를 막고 있는 벽을 확률적으로 허문다
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (tiles[at(x, y)] !== WALL) continue;
      if ((x % 2 === 0) !== (y % 2 === 0) && rand() < 0.16) tiles[at(x, y)] = FLOOR;
    }
  }

  // 방: 넓은 공간이 있어야 도망칠 여지가 생긴다
  const roomCount = 4 + ((rand() * 3) | 0);
  for (let i = 0; i < roomCount; i++) {
    const rw = 3 + 2 * ((rand() * 2) | 0);
    const rh = 3 + 2 * ((rand() * 2) | 0);
    const rx = 1 + 2 * ((rand() * (cols - 2)) | 0);
    const ry = 1 + 2 * ((rand() * (rows - 2)) | 0);
    for (let y = ry; y < Math.min(ry + rh, h - 1); y++) {
      for (let x = rx; x < Math.min(rx + rw, w - 1); x++) tiles[at(x, y)] = FLOOR;
    }
  }

  return { w, h, tiles };
}

export function isWall(maze, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= maze.w || ty >= maze.h) return true;
  return maze.tiles[ty * maze.w + tx] === WALL;
}

export function isWallAt(maze, x, y) {
  return isWall(maze, Math.floor(x / TILE), Math.floor(y / TILE));
}

export function floorTiles(maze) {
  const list = [];
  for (let y = 1; y < maze.h - 1; y++) {
    for (let x = 1; x < maze.w - 1; x++) {
      if (!isWall(maze, x, y)) list.push([x, y]);
    }
  }
  return list;
}

export function tileCenter(tx, ty) {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}

// 벽을 통과하지 않고 두 지점이 서로 보이는지
export function hasLineOfSight(maze, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  const steps = Math.ceil(dist / (TILE / 3));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (isWallAt(maze, x1 + dx * t, y1 + dy * t)) return false;
  }
  return true;
}

// 격자 위 광선 추적 (DDA). 벽에 맞은 지점, 또는 최대 거리 지점을 반환한다.
export function castRay(maze, ox, oy, angle, maxDist) {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const posX = ox / TILE;
  const posY = oy / TILE;
  let mapX = Math.floor(posX);
  let mapY = Math.floor(posY);

  const deltaX = dirX === 0 ? Infinity : Math.abs(1 / dirX);
  const deltaY = dirY === 0 ? Infinity : Math.abs(1 / dirY);

  let stepX, stepY, sideDistX, sideDistY;
  if (dirX < 0) {
    stepX = -1;
    sideDistX = (posX - mapX) * deltaX;
  } else {
    stepX = 1;
    sideDistX = (mapX + 1 - posX) * deltaX;
  }
  if (dirY < 0) {
    stepY = -1;
    sideDistY = (posY - mapY) * deltaY;
  } else {
    stepY = 1;
    sideDistY = (mapY + 1 - posY) * deltaY;
  }

  const maxTiles = maxDist / TILE;
  let dist = 0;
  for (let guard = 0; guard < 256; guard++) {
    if (sideDistX < sideDistY) {
      dist = sideDistX;
      sideDistX += deltaX;
      mapX += stepX;
    } else {
      dist = sideDistY;
      sideDistY += deltaY;
      mapY += stepY;
    }
    if (dist > maxTiles) {
      dist = maxTiles;
      break;
    }
    if (isWall(maze, mapX, mapY)) break;
  }

  const d = Math.min(dist, maxTiles) * TILE;
  return { x: ox + dirX * d, y: oy + dirY * d, dist: d };
}

// 너비 우선 탐색으로 타일 경로를 찾는다 (추격 AI용)
export function bfsPath(maze, sx, sy, tx, ty) {
  if (isWall(maze, sx, sy) || isWall(maze, tx, ty)) return null;
  const size = maze.w * maze.h;
  const prev = new Int32Array(size).fill(-1);
  const start = sy * maze.w + sx;
  const goal = ty * maze.w + tx;
  prev[start] = start;

  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;

  while (head < tail) {
    const cur = queue[head++];
    if (cur === goal) break;
    const cx = cur % maze.w;
    const cy = (cur / maze.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (isWall(maze, nx, ny)) continue;
      const ni = ny * maze.w + nx;
      if (prev[ni] !== -1) continue;
      prev[ni] = cur;
      queue[tail++] = ni;
    }
  }

  if (prev[goal] === -1) return null;
  const path = [];
  let node = goal;
  while (node !== start) {
    path.push([node % maze.w, (node / maze.w) | 0]);
    node = prev[node];
  }
  path.reverse();
  return path;
}
