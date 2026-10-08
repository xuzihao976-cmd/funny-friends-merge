(() => {
  'use strict';

  const W = 420, H = 640, DANGER_Y = 118;
  const RADII = [22, 27, 33, 40, 48, 58, 70, 83, 98, 116];
  const COLORS = ['#ffe482','#ffc9db','#d9c2ff','#aeeaf0','#ffbb8b','#bce8b1','#ff9ec2','#c6abfa','#8edbcf','#ffc46e'];
  const PRESETS = [
    {name:'蒙面小号', emoji:'🥷', slug:'mask'},
    {name:'憋笑预备役', emoji:'😏', slug:'smirk'},
    {name:'冷面判官', emoji:'🤓', slug:'glasses'},
    {name:'嘘声特工', emoji:'🤫', slug:'shh'},
    {name:'沉思大师', emoji:'🤔', slug:'nose'},
    {name:'哈欠冲天', emoji:'🥱', slug:'yawn'},
    {name:'泡沫禅师', emoji:'🫧', slug:'spa'},
    {name:'鸡王觉醒', emoji:'🐓', slug:'rooster'},
    {name:'不服战神', emoji:'😤', slug:'duo'},
    {name:'宴席大王', emoji:'👑', slug:'feast'}
  ];
  const MODE_KEY = 'family-merge-mode-v2';
  const SOUND_KEY = 'family-merge-sound-v1';
  const GALLERY_KEY = 'family-merge-gallery-v2';
  const BONUS_DROP_CHANCE = .12;
  const BONUS_LEVEL_DECAY = .46;
  const SOUND_FILES = {
    drop:'assets/sfx/drop.wav', land:'assets/sfx/land.wav', merge:'assets/sfx/merge.wav',
    bigMerge:'assets/sfx/big-merge.wav', unlock:'assets/sfx/unlock.wav',
    finish:'assets/sfx/finish.wav', gameOver:'assets/sfx/game-over.wav', switch:'assets/sfx/switch.wav'
  };
  const params = new URLSearchParams(location.search);
  const requestedMode = params.get('mode');
  let mode = requestedMode === 'photo' || requestedMode === 'comic' ? requestedMode : 'photo';
  try { if (!requestedMode) mode = localStorage.getItem(MODE_KEY) === 'comic' ? 'comic' : 'photo'; } catch (_) {}
  const makeAssets = () => PRESETS.map((preset, i) => {
    const photo = `assets/${mode === 'comic' ? 'level' : 'photo'}-${String(i + 1).padStart(2,'0')}-${preset.slug}.${mode === 'comic' ? 'webp' : 'jpg'}`;
    return {name:preset.name, emoji:preset.emoji, photo, image:null};
  });
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const howDialog = document.getElementById('howDialog');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const nextName = document.getElementById('nextName');
  const poolHint = document.getElementById('poolHint');
  const levelGrid = document.getElementById('levelGrid');
  const levelCount = document.getElementById('levelCount');

  let assets = makeAssets();
  let balls = [], particles = [], floats = [];
  let score = 0, best = 0, current = 0, next = 0, aimX = W / 2;
  let gameOver = false, overTimer = 0, lastDrop = -10, lastTime = 0, accumulator = 0;
  let highestMergedLevel = 3, soundOn = true, audioContext = null, pointerDown = false;
  let unlockedLevels = 1;
  let lastImpactSound = -10;
  const soundBytes = Object.fromEntries(Object.entries(SOUND_FILES).map(([key, path]) =>
    [key, fetch(path).then(response => response.ok ? response.arrayBuffer() : null).catch(() => null)]));
  const soundBuffers = {};
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  try { best = Number(localStorage.getItem('funny-merge-best-v1')) || 0; } catch (_) {}
  try { soundOn = localStorage.getItem(SOUND_KEY) !== 'off'; } catch (_) {}
  try {
    const saved = localStorage.getItem(GALLERY_KEY);
    if (saved !== null) {
      const mask = Number(saved);
      if (Number.isInteger(mask) && mask >= 0 && mask < (1 << RADII.length)) unlockedLevels = mask | 1;
    } else {
      const previous = localStorage.getItem('family-merge-gallery-v1');
      const level = Number(previous);
      if (previous !== null && Number.isInteger(level) && level >= 0 && level < RADII.length) unlockedLevels = (1 << (level + 1)) - 1;
    }
  } catch (_) {}
  bestEl.textContent = best.toLocaleString();
  document.getElementById('soundBtn').setAttribute('aria-pressed', String(soundOn));
  document.getElementById('soundBtn').textContent = soundOn ? '♫ 音效开启' : '♫ 音效关闭';

  function setupCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  setupCanvas();
  window.addEventListener('resize', setupCanvas);

  function randLevel(random = Math.random) {
    if (highestMergedLevel >= 4 && random() < BONUS_DROP_CHANCE) {
      const maxLevel = Math.min(highestMergedLevel, RADII.length - 1);
      let total = 0;
      for (let level = 4; level <= maxLevel; level++) total += BONUS_LEVEL_DECAY ** (level - 4);
      let pick = random() * total;
      for (let level = 4; level <= maxLevel; level++) {
        pick -= BONUS_LEVEL_DECAY ** (level - 4);
        if (pick < 0) return level;
      }
      return maxLevel;
    }
    const n = random();
    return n < .43 ? 0 : n < .76 ? 1 : n < .94 ? 2 : 3;
  }
  function updatePoolHint() {
    const unlocked = highestMergedLevel >= 4;
    poolHint.textContent = unlocked
      ? `大球彩蛋已解锁：后续有 12% 概率空降已合出的第 5–${highestMergedLevel + 1} 级头像。`
      : '合出第 5 级后，后续有 12% 概率直接出现已解锁的大球。';
    poolHint.classList.toggle('unlocked', unlocked);
  }
  function setScore(value) {
    score = value;
    scoreEl.textContent = score.toLocaleString();
    if (score > best) {
      best = score;
      bestEl.textContent = best.toLocaleString();
      try { localStorage.setItem('funny-merge-best-v1', String(best)); } catch (_) {}
    }
  }
  function startGame() {
    balls = []; particles = []; floats = []; overTimer = 0; gameOver = false;
    highestMergedLevel = 3;
    lastImpactSound = -10;
    current = randLevel(); next = randLevel(); aimX = W / 2; lastDrop = -10;
    setScore(0);
    document.getElementById('gameOver').classList.add('hidden');
    updatePoolHint();
    updatePreview();
  }

  function playSound(name, volume = .3, rate = 1) {
    if (!soundOn || !soundBytes[name]) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      const context = audioContext;
      soundBuffers[name] ||= soundBytes[name]
        .then(bytes => bytes ? context.decodeAudioData(bytes.slice(0)) : null)
        .catch(() => null);
      const resumed = context.state === 'suspended' ? context.resume().catch(() => {}) : Promise.resolve();
      Promise.all([soundBuffers[name], resumed]).then(([buffer]) => {
        if (!buffer || !soundOn || context.state !== 'running') return;
        const source = context.createBufferSource(), gain = context.createGain();
        source.buffer = buffer;
        source.playbackRate.value = Math.max(.6, Math.min(1.5, rate));
        gain.gain.value = Math.max(0, Math.min(1, volume));
        source.connect(gain).connect(context.destination);
        source.start();
      });
    } catch (_) {}
  }

  function drop() {
    if (gameOver || howDialog.open) return;
    const time = performance.now() / 1000;
    if (time - lastDrop < .46) return;
    const droppedLevel = current, r = RADII[droppedLevel];
    balls.push({ x: Math.max(r + 4, Math.min(W - r - 4, aimX)), y: Math.max(73, r + 6),
      vx: 0, vy: 32, r, level: droppedLevel, age: 0, impactSounded: false, id: Math.random() });
    lastDrop = time; current = next; next = randLevel();
    updatePreview();
    playSound('drop', .26, 1.12 - droppedLevel * .045);
  }

  function merge(a, b) {
    const level = a.level + 1;
    const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
    balls = balls.filter(ball => ball !== a && ball !== b);
    const points = level >= RADII.length ? 1000 : Math.round(15 * Math.pow(2, level));
    setScore(score + points);
    unlockGalleryLevel(level);
    floats.push({x, y, text: '+' + points, age: 0, life: 1.15});
    if (!reducedMotion) for (let i = 0; i < 13; i++) {
      const ang = (i / 13) * Math.PI * 2;
      const speed = 75 + Math.random() * 110;
      particles.push({x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, age: 0, life: .45 + Math.random() * .3, color: COLORS[Math.min(level, 9)]});
    }
    if (level < RADII.length) {
      balls.push({x, y, vx: (a.vx + b.vx) * .2, vy: -150, r: RADII[level], level,
        age: 0, impactSounded: false, id: Math.random()});
    }
    if (level >= RADII.length) playSound('finish', .42);
    else if (level > highestMergedLevel) {
      highestMergedLevel = level;
      updatePoolHint();
      playSound('unlock', .42, 1.08 - level * .035);
    } else playSound(level >= 6 ? 'bigMerge' : 'merge', level >= 6 ? .42 : .34, 1.15 - level * .055);
  }

  function physics(dt) {
    for (const b of balls) {
      b.age += dt;
      b.vy += 1100 * dt;
      b.vx *= .999;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x < b.r + 3) { b.x = b.r + 3; b.vx = Math.abs(b.vx) * .22; }
      if (b.x > W - b.r - 3) { b.x = W - b.r - 3; b.vx = -Math.abs(b.vx) * .22; }
      if (b.y > H - b.r - 5) {
        const impactSpeed = b.vy;
        b.y = H - b.r - 5; b.vy = -Math.abs(b.vy) * .1; b.vx *= .985;
        if (Math.abs(b.vy) < 12) b.vy = 0;
        const now = performance.now() / 1000;
        if (!b.impactSounded && impactSpeed > 120 && now - lastImpactSound > .07) {
          b.impactSounded = true; lastImpactSound = now;
          playSound('land', .16 + Math.min(b.level, 7) * .016, 1.08 - b.level * .045);
        }
      }
    }
    let pairToMerge = null;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i], b = balls[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.hypot(dx, dy); const minDist = a.r + b.r;
        if (dist >= minDist) continue;
        if (dist < .001) { dx = .001; dy = 0; dist = .001; }
        if (!pairToMerge && a.level === b.level && a.age > .08 && b.age > .08) pairToMerge = [a, b];
        const nx = dx / dist, ny = dy / dist, penetration = minDist - dist;
        const ma = a.r * a.r, mb = b.r * b.r, total = ma + mb;
        const moveA = mb / total, moveB = ma / total;
        a.x -= nx * penetration * moveA * .9; a.y -= ny * penetration * moveA * .9;
        b.x += nx * penetration * moveB * .9; b.y += ny * penetration * moveB * .9;
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < -140 && a.level !== b.level && (!a.impactSounded || !b.impactSounded)) {
          const now = performance.now() / 1000;
          if (now - lastImpactSound > .07) {
            a.impactSounded = b.impactSounded = true; lastImpactSound = now;
            playSound('land', .14 + Math.min(a.level, b.level) * .015, 1.07 - Math.max(a.level, b.level) * .04);
          }
        }
        if (rel < 0) {
          const impulse = -(1.13 * rel) / (1 / ma + 1 / mb);
          a.vx -= impulse * nx / ma; a.vy -= impulse * ny / ma;
          b.vx += impulse * nx / mb; b.vy += impulse * ny / mb;
        }
      }
    }
    if (pairToMerge) merge(pairToMerge[0], pairToMerge[1]);
    for (const p of particles) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 200 * dt; }
    particles = particles.filter(p => p.age < p.life);
    for (const f of floats) { f.age += dt; f.y -= 30 * dt; }
    floats = floats.filter(f => f.age < f.life);

    const danger = balls.some(b => b.age > 1.7 && b.y - b.r < DANGER_Y && Math.abs(b.vy) < 80);
    overTimer = danger ? overTimer + dt : Math.max(0, overTimer - dt * 2);
    if (overTimer > 2.2) endGame();
  }

  function endGame() {
    gameOver = true;
    document.getElementById('finalScore').textContent = score.toLocaleString();
    document.getElementById('recordLine').textContent = score === best && score > 0 ? '新纪录！这波合成有点东西 ✨' : '最高纪录 ' + best.toLocaleString() + ' 分';
    document.getElementById('gameOver').classList.remove('hidden');
    playSound('gameOver', .38);
  }

  function circlePath(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }
  function drawAvatar(level, x, y, r, alpha = 1, ghost = false) {
    const asset = assets[level];
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.shadowColor = 'rgba(42,21,68,.24)'; ctx.shadowBlur = ghost ? 0 : 12; ctx.shadowOffsetY = ghost ? 0 : 6;
    circlePath(x, y, r); ctx.fillStyle = COLORS[level]; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.save(); circlePath(x, y, r - 4); ctx.clip();
    if (asset.image && asset.image.complete) {
      const im = asset.image, side = Math.min(im.naturalWidth, im.naturalHeight);
      const sx = (im.naturalWidth - side) / 2;
      const sy = (im.naturalHeight - side) / 2;
      ctx.drawImage(im, sx, sy, side, side, x - r + 4, y - r + 4, 2 * (r - 4), 2 * (r - 4));
    } else {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `${Math.round(r * 1.15)}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`;
      ctx.fillText(asset.emoji, x, y + 1);
    }
    ctx.restore();
    circlePath(x, y, r - 2); ctx.strokeStyle = ghost ? 'rgba(106,61,222,.5)' : 'rgba(255,255,255,.92)'; ctx.lineWidth = ghost ? 2 : 4; ctx.stroke();
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#fbf7ff'); bg.addColorStop(1, '#eee3ff');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(127,93,171,.065)'; ctx.lineWidth = 1;
    for (let x = 20; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 20; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.fillStyle = '#e6d7fb'; ctx.fillRect(0, H - 5, W, 5);
    ctx.setLineDash([7, 7]); ctx.strokeStyle = overTimer > .4 ? '#ee638a' : 'rgba(193,129,177,.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, DANGER_Y); ctx.lineTo(W, DANGER_Y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = overTimer > .4 ? '#dc4d7b' : '#b18ab0'; ctx.font = '700 10px "DM Sans",sans-serif';
    ctx.fillText('警戒线', 10, DANGER_Y - 10);
    if (!gameOver && !howDialog.open) {
      const r = RADII[current], x = Math.max(r + 4, Math.min(W - r - 4, aimX));
      const ghostY = Math.max(62, r + 7);
      ctx.setLineDash([4, 8]); ctx.strokeStyle = 'rgba(112,62,188,.38)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, ghostY + r + 5); ctx.lineTo(x, H - 8); ctx.stroke(); ctx.setLineDash([]);
      drawAvatar(current, x, ghostY, r, .87, true);
      if (r <= 70) {
        ctx.fillStyle = '#67499d'; ctx.textAlign = 'center'; ctx.font = '800 11px "Noto Sans SC",sans-serif';
        ctx.fillText(assets[current].name, x, Math.max(14, ghostY - r - 10));
      }
    }
    for (const b of balls) drawAvatar(b.level, b.x, b.y, b.r);
    for (const p of particles) {
      ctx.globalAlpha = 1 - p.age / p.life; circlePath(p.x, p.y, 3.5); ctx.fillStyle = p.color; ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of floats) {
      ctx.globalAlpha = 1 - f.age / f.life;
      ctx.font = '900 21px "DM Sans",sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = '#6a3dde'; ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    if (overTimer > .15 && !gameOver) {
      ctx.fillStyle = '#ee638a'; ctx.fillRect(0, 0, W * Math.min(1, overTimer / 2.2), 5);
    }
  }

  function frame(time) {
    if (!lastTime) lastTime = time;
    const dt = Math.min((time - lastTime) / 1000, .05); lastTime = time;
    if (!gameOver && !howDialog.open && !document.hidden) {
      accumulator += dt;
      let n = 0;
      while (accumulator >= 1 / 120 && n < 7) { physics(1 / 120); accumulator -= 1 / 120; n++; }
      if (n === 7) accumulator = 0;
    } else accumulator = 0;
    render();
    requestAnimationFrame(frame);
  }

  function avatarElement(asset, className) {
    const el = document.createElement('div'); el.className = className;
    if (asset.photo) { const img = document.createElement('img'); img.src = asset.photo; img.alt = ''; el.appendChild(img); }
    else el.textContent = asset.emoji;
    return el;
  }
  function loadImage(asset) {
    asset.image = null;
    if (!asset.photo) return;
    const im = new Image(); im.onload = () => { asset.image = im; }; im.src = asset.photo;
  }
  function updatePreview() {
    const preview = avatarElement(assets[next], 'next-avatar');
    preview.id = 'nextAvatar';
    document.getElementById('nextAvatar').replaceWith(preview);
    nextName.textContent = assets[next].name;
  }
  function renderLevels() {
    levelGrid.replaceChildren();
    assets.forEach((asset, i) => {
      const item = document.createElement('div'); item.className = 'level-item';
      const unlocked = Boolean(unlockedLevels & (1 << i));
      item.classList.toggle('locked', !unlocked);
      item.setAttribute('aria-label', unlocked ? `第 ${i + 1} 级：${asset.name}` : `第 ${i + 1} 级：未解锁`);
      if (unlocked) item.appendChild(avatarElement(asset, 'level-face'));
      else {
        const face = document.createElement('div'); face.className = 'level-face locked-face'; face.setAttribute('aria-hidden', 'true'); face.textContent = '?';
        item.appendChild(face);
      }
      const label = document.createElement('span'); label.textContent = unlocked ? asset.name : `${i + 1}级待解锁`;
      item.appendChild(label); levelGrid.appendChild(item);
    });
    const count = assets.reduce((total, _, i) => total + Number(Boolean(unlockedLevels & (1 << i))), 0);
    levelCount.textContent = `${count} / ${RADII.length} 已解锁`;
  }
  function unlockGalleryLevel(level) {
    if (level < 0 || level >= RADII.length || (unlockedLevels & (1 << level))) return;
    unlockedLevels |= 1 << level;
    try { localStorage.setItem(GALLERY_KEY, String(unlockedLevels)); } catch (_) {}
    renderLevels();
    if (!reducedMotion) levelGrid.children[level]?.classList.add('just-unlocked');
  }
  function updateModeButtons() {
    for (const [id, value] of [['photoModeBtn','photo'],['comicModeBtn','comic']]) {
      const button = document.getElementById(id);
      button.setAttribute('aria-pressed', String(mode === value));
      button.classList.toggle('selected', mode === value);
    }
    document.getElementById('modeHint').textContent = mode === 'comic'
      ? '夸张描边，保留每个人的招牌表情。'
      : '原片精裁，保留照片现场感。';
  }
  function setMode(value) {
    if (value !== 'photo' && value !== 'comic') return;
    if (mode !== value) {
      playSound('switch', .21);
      mode = value;
      assets = makeAssets(); assets.forEach(loadImage); renderLevels();
      updatePreview();
    }
    try { localStorage.setItem(MODE_KEY, mode); } catch (_) {}
    const url = new URL(location.href); url.searchParams.set('mode', mode);
    history.replaceState(null, '', url);
    updateModeButtons();
  }
  function canvasX(clientX) { const rect = canvas.getBoundingClientRect(); return (clientX - rect.left) * W / rect.width; }
  canvas.addEventListener('pointerdown', e => { pointerDown = true; aimX = canvasX(e.clientX); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' || pointerDown) aimX = canvasX(e.clientX); });
  canvas.addEventListener('pointerup', e => { if (pointerDown) { aimX = canvasX(e.clientX); drop(); } pointerDown = false; });
  canvas.addEventListener('pointercancel', () => { pointerDown = false; });
  window.addEventListener('keydown', e => {
    if (howDialog.open || /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); aimX += e.code === 'ArrowLeft' ? -15 : 15; aimX = Math.max(24,Math.min(W-24,aimX)); }
    if (e.code === 'Space') { e.preventDefault(); drop(); }
    if (e.code === 'KeyR') startGame();
  });

  document.getElementById('restartBtn').addEventListener('click', () => { playSound('switch', .21); startGame(); });
  document.getElementById('againBtn').addEventListener('click', () => { playSound('switch', .21); startGame(); });
  document.getElementById('howBtn').addEventListener('click', () => howDialog.showModal());
  document.getElementById('closeHow').addEventListener('click', () => howDialog.close());
  document.getElementById('gotItBtn').addEventListener('click', () => howDialog.close());
  document.getElementById('soundBtn').addEventListener('click', e => {
    soundOn = !soundOn;
    try { localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off'); } catch (_) {}
    e.currentTarget.setAttribute('aria-pressed', String(soundOn));
    e.currentTarget.textContent = soundOn ? '♫ 音效开启' : '♫ 音效关闭';
    if (soundOn) playSound('switch', .21);
  });
  document.getElementById('photoModeBtn').addEventListener('click', () => setMode('photo'));
  document.getElementById('comicModeBtn').addEventListener('click', () => setMode('comic'));
  assets.forEach(loadImage); renderLevels(); updateModeButtons(); startGame(); requestAnimationFrame(frame);
})();
