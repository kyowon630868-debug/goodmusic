// 진입점 — 화면 전환, 루프, HUD

import { AudioEngine } from './audio.js';
import { Game, CFG } from './game.js';
import { Renderer } from './render.js';
import { Input } from './input.js';

const $ = (sel) => document.querySelector(sel);

const canvas = $('#game');
const audio = new AudioEngine();
const game = new Game(audio);
const renderer = new Renderer(canvas);
const input = new Input($('#touch-surface'), $('#stick'));

const screens = {
  title: $('#screen-title'),
  loading: $('#screen-loading'),
  dead: $('#screen-dead'),
  win: $('#screen-win'),
};

let running = false;
let deathDelay = 0;
let wakeLock = null;

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) el.classList.toggle('show', key === name);
  document.body.classList.toggle('in-game', name === null);
}

function hideAllScreens() {
  for (const el of Object.values(screens)) el.classList.remove('show');
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function keepAwake() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) {
    /* 배터리 절약 모드 등에서 거부될 수 있다 */
  }
}

async function boot() {
  showScreen('loading');
  await audio.init();
  await audio.resume();
  await audio.loadTracks((ratio) => {
    $('#loading-bar').style.width = `${Math.round(ratio * 100)}%`;
  });
  keepAwake();
  startRun();
}

function startRun() {
  hideAllScreens();
  document.body.classList.add('in-game');
  game.start((Math.random() * 0xffffffff) >>> 0);
  audio.startCreepyMusic();
  deathDelay = 0;
  renderer.deathTime = 0;
  if (!running) {
    running = true;
    lastFrame = performance.now();
    requestAnimationFrame(frame);
  }
}

const hud = {
  presents: $('#hud-presents'),
  battery: $('#hud-battery-fill'),
  stamina: $('#hud-stamina-fill'),
  hint: $('#hud-hint'),
  timer: $('#hud-timer'),
  lightBtn: $('#btn-light'),
  sprintBtn: $('#btn-sprint'),
};

function updateHud() {
  document.body.classList.toggle('over', game.status !== 'playing');
  hud.presents.textContent = `${game.collected} / ${game.presents.length}`;
  hud.battery.style.width = `${game.player.battery}%`;
  hud.battery.classList.toggle('low', game.player.battery < 20);
  hud.stamina.style.width = `${game.player.stamina}%`;
  hud.timer.textContent = formatTime(game.time);
  hud.lightBtn.classList.toggle('on', game.player.light && game.player.battery > 0);
  hud.sprintBtn.classList.toggle('on', game.player.sprinting);
  hud.sprintBtn.classList.toggle('spent', game.player.stamina < 12);

  if (game.hintTimer > 0) {
    hud.hint.textContent = game.hint;
    hud.hint.style.opacity = Math.min(1, game.hintTimer);
  } else {
    hud.hint.style.opacity = 0;
  }
}

let lastFrame = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  const sample = input.sample();
  game.update(dt, sample);
  renderer.render(game, dt);
  updateHud();

  if (game.status === 'dead') {
    deathDelay += dt;
    if (deathDelay > 1.8 && !screens.dead.classList.contains('show')) {
      $('#dead-stats').textContent = `선물 ${game.collected} / ${game.presents.length} · 버틴 시간 ${formatTime(game.time)}`;
      screens.dead.classList.add('show');
    }
  } else if (game.status === 'won' && !screens.win.classList.contains('show')) {
    const best = Number(localStorage.getItem('silentnight_best') || 0);
    if (!best || game.time < best) localStorage.setItem('silentnight_best', String(game.time));
    const bestNow = Number(localStorage.getItem('silentnight_best'));
    $('#win-stats').textContent = `탈출 시간 ${formatTime(game.time)} · 최고 기록 ${formatTime(bestNow)}`;
    screens.win.classList.add('show');
  }

  requestAnimationFrame(frame);
}

$('#btn-start').addEventListener('click', boot);
$('#btn-retry').addEventListener('click', startRun);
$('#btn-again').addEventListener('click', startRun);

hud.lightBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  input.toggleLight();
});

// 달리기는 누르고 있는 동안만
const holdSprint = (held) => (e) => {
  e.preventDefault();
  e.stopPropagation();
  input.setSprint(held);
};
hud.sprintBtn.addEventListener('pointerdown', holdSprint(true));
hud.sprintBtn.addEventListener('pointerup', holdSprint(false));
hud.sprintBtn.addEventListener('pointercancel', holdSprint(false));
hud.sprintBtn.addEventListener('pointerleave', holdSprint(false));

document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.stopMusic();
  else if (game.status === 'playing' && running) audio.startCreepyMusic();
});

// 스크롤·확대 방지
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener(
  'touchmove',
  (e) => {
    // 타이틀·결과 화면은 낮은 기기에서 스크롤이 필요하다
    if (!(e.target instanceof Element) || !e.target.closest('.screen')) e.preventDefault();
  },
  { passive: false }
);

const bestSaved = Number(localStorage.getItem('silentnight_best') || 0);
if (bestSaved) $('#title-best').textContent = `최고 기록 ${formatTime(bestSaved)}`;

showScreen('title');

// 디버깅용
window.__game = game;
window.__CFG = CFG;
export { game, CFG };
