(() => {
  'use strict';

  const W = 420, H = 640, DANGER_Y = 118;
  const RADII = [22, 27, 33, 40, 48, 58, 70, 83, 98, 116];
  const COLORS = ['#ffe482','#ffc9db','#d9c2ff','#aeeaf0','#ffbb8b','#bce8b1','#ff9ec2','#c6abfa','#8edbcf','#ffc46e'];
  const PRESETS = [
    {name:'蒙面小号', emoji:'🥷', slug:'mask', focus:[.50,.38], zoom:1.38},
    {name:'憋笑预备役', emoji:'😏', slug:'smirk', focus:[.50,.42], zoom:1.35},
    {name:'冷面判官', emoji:'🤓', slug:'glasses', focus:[.51,.51], zoom:1.00},
    {name:'嘘声特工', emoji:'🤫', slug:'shh', focus:[.43,.34], zoom:1.38},
    {name:'沉思大师', emoji:'🤔', slug:'nose', focus:[.50,.45], zoom:1.16},
    {name:'哈欠冲天', emoji:'🥱', slug:'yawn', focus:[.48,.53], zoom:1.20},
    {name:'泡沫禅师', emoji:'🫧', slug:'spa', focus:[.48,.34], zoom:1.00},
    {name:'鸡王觉醒', emoji:'🐓', slug:'rooster', focus:[.46,.43], zoom:1.00},
    {name:'不服战神', emoji:'😤', slug:'finger', focus:[.53,.42], zoom:1.00},
    {name:'宴席大王', emoji:'👑', slug:'feast', focus:[.50,.49], zoom:1.00}
  ];
  const MODE_KEY = 'funny-merge-mode-v1';
  const params = new URLSearchParams(location.search);
  const requestedMode = params.get('mode');
  let mode = requestedMode === 'photo' || requestedMode === 'comic' ? requestedMode : 'comic';
  try { if (!requestedMode) mode = localStorage.getItem(MODE_KEY) === 'photo' ? 'photo' : 'comic'; } catch (_) {}
  const STORAGE = () => `funny-merge-assets-v2-${mode}`;
  const makeAssets = () => PRESETS.map((preset, i) => {
    const photo = `assets/${mode === 'comic' ? 'level' : 'photo'}-${String(i + 1).padStart(2,'0')}-${preset.slug}.${mode === 'comic' ? 'webp' : 'jpg'}`;
    return {name:preset.name, emoji:preset.emoji, photo, basePhoto:photo,
      image:null, focus:mode === 'comic' ? [.5,.5] : preset.focus,
      zoom:mode === 'comic' ? 1 : preset.zoom};
  });
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const studio = document.getElementById('studio');
  const howDialog = document.getElementById('howDialog');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const nextName = document.getElementById('nextName');
  const levelGrid = document.getElementById('levelGrid');
  const studioGrid = document.getElementById('studioGrid');

  let assets = makeAssets();
  let balls = [], particles = [], floats = [];
  let score = 0, best = 0, current = 0, next = 0, aimX = W / 2;
  let gameOver = false, overTimer = 0, lastDrop = -10, lastTime = 0, accumulator = 0;
  let soundOn = true, audioContext = null, pointerDown = false;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  try { best = Number(localStorage.getItem('funny-merge-best-v1')) || 0; } catch (_) {}
  bestEl.textContent = best.toLocaleString();

  function setupCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  setupCanvas();
  window.addEventListener('resize', setupCanvas);

  function randLevel() { const n = Math.random(); return n < .43 ? 0 : n < .76 ? 1 : n < .94 ? 2 : 3; }
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
    current = randLevel(); next = randLevel(); aimX = W / 2; lastDrop = -10;
    setScore(0);
    document.getElementById('gameOver').classList.add('hidden');
    updatePreview();
  }

  function playTone(freq, duration, type = 'sine', volume = .07) {
    if (!soundOn) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume();
      const now = audioContext.currentTime;
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * .72, now + duration);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(.001, now + duration);
      osc.connect(gain).connect(audioContext.destination);
      osc.start(now); osc.stop(now + duration);
    } catch (_) {}
  }

  function drop() {
    if (gameOver || studio.open || howDialog.open) return;
    const time = performance.now() / 1000;
    if (time - lastDrop < .46) return;
    const r = RADII[current];
    balls.push({ x: Math.max(r + 4, Math.min(W - r - 4, aimX)), y: 73, vx: 0, vy: 32, r, level: current, age: 0, id: Math.random() });
    lastDrop = time; current = next; next = randLevel();
    updatePreview();
    playTone(290, .09, 'triangle', .04);
  }

  function merge(a, b) {
    const level = a.level + 1;
    const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
    balls = balls.filter(ball => ball !== a && ball !== b);
    const points = level >= RADII.length ? 1000 : Math.round(15 * Math.pow(2, level));
    setScore(score + points);
    floats.push({x, y, text: '+' + points, age: 0, life: 1.15});
    if (!reducedMotion) for (let i = 0; i < 13; i++) {
      const ang = (i / 13) * Math.PI * 2;
      const speed = 75 + Math.random() * 110;
      particles.push({x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, age: 0, life: .45 + Math.random() * .3, color: COLORS[Math.min(level, 9)]});
    }
    if (level < RADII.length) {
      balls.push({x, y, vx: (a.vx + b.vx) * .2, vy: -150, r: RADII[level], level, age: 0, id: Math.random()});
    }
    playTone(390 + level * 65, .23, 'sine', .09);
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
      if (b.y > H - b.r - 5) { b.y = H - b.r - 5; b.vy = -Math.abs(b.vy) * .1; b.vx *= .985; if (Math.abs(b.vy) < 12) b.vy = 0; }
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
    playTone(220, .35, 'triangle', .07);
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
      const im = asset.image, side = Math.min(im.naturalWidth, im.naturalHeight) / asset.zoom;
      const sx = Math.max(0, Math.min(im.naturalWidth - side, im.naturalWidth * asset.focus[0] - side / 2));
      const sy = Math.max(0, Math.min(im.naturalHeight - side, im.naturalHeight * asset.focus[1] - side / 2));
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
    if (!gameOver && !studio.open && !howDialog.open) {
      const r = RADII[current], x = Math.max(r + 4, Math.min(W - r - 4, aimX));
      ctx.setLineDash([4, 8]); ctx.strokeStyle = 'rgba(112,62,188,.38)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, 75 + r); ctx.lineTo(x, H - 8); ctx.stroke(); ctx.setLineDash([]);
      drawAvatar(current, x, 62, r, .87, true);
      ctx.fillStyle = '#67499d'; ctx.textAlign = 'center'; ctx.font = '800 11px "Noto Sans SC",sans-serif';
      ctx.fillText(assets[current].name, x, Math.max(14, 60 - r - 10));
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
    if (!gameOver && !studio.open && !howDialog.open && !document.hidden) {
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
    if (asset.photo) { const img = document.createElement('img'); img.src = asset.photo; img.alt = ''; img.style.objectPosition = `${asset.focus[0]*100}% ${asset.focus[1]*100}%`; el.appendChild(img); }
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
      item.appendChild(avatarElement(asset, 'level-face'));
      const label = document.createElement('span'); label.textContent = asset.name; label.title = `${i + 1} 级 · ${asset.name}`;
      item.appendChild(label); levelGrid.appendChild(item);
    });
  }
  function saveAssets() {
    try { localStorage.setItem(STORAGE(), JSON.stringify(assets.map(({name,photo}) => ({name,photo})))); return true; }
    catch (_) { alert('浏览器存储空间不足。照片本局可用，建议导出照片包保存。'); return false; }
  }
  function loadAssets() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE()) || 'null');
      if (Array.isArray(saved) && saved.length === PRESETS.length) saved.forEach((entry, i) => {
        if (typeof entry.name === 'string') assets[i].name = entry.name.slice(0, 16) || PRESETS[i].name;
        if (entry.photo === null) assets[i].photo = null;
        else if (typeof entry.photo === 'string' && (/^data:image\/(jpeg|png|webp);base64,/.test(entry.photo) || entry.photo === assets[i].basePhoto)) assets[i].photo = entry.photo;
      });
    } catch (_) {}
    assets.forEach((asset, i) => {
      if (asset.photo !== asset.basePhoto) { asset.focus = [.5,.5]; asset.zoom = 1; }
      loadImage(asset);
    });
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
      mode = value;
      assets = makeAssets(); loadAssets(); renderLevels();
      if (studio.open) studioSlots();
      updatePreview();
    }
    try { localStorage.setItem(MODE_KEY, mode); } catch (_) {}
    const url = new URL(location.href); url.searchParams.set('mode', mode);
    history.replaceState(null, '', url);
    updateModeButtons();
  }
  function studioSlots() {
    const scrollTop = studioGrid.scrollTop;
    studioGrid.replaceChildren();
    assets.forEach((asset, i) => {
      const slot = document.createElement('div'); slot.className = 'studio-slot';
      slot.appendChild(avatarElement(asset, 'slot-preview'));
      const controls = document.createElement('div'); controls.className = 'slot-controls';
      const label = document.createElement('label'); label.textContent = `第 ${i + 1} 级 · ${i === 9 ? '终极形态' : '合成升级'}`;
      const name = document.createElement('input'); name.type = 'text'; name.maxLength = 16; name.value = asset.name; name.setAttribute('aria-label', `第 ${i + 1} 级外号`);
      name.addEventListener('change', () => { asset.name = name.value.trim().slice(0,16) || PRESETS[i].name; saveAssets(); renderLevels(); updatePreview(); });
      const buttons = document.createElement('div'); buttons.className = 'slot-buttons';
      const upload = document.createElement('button'); upload.type = 'button'; upload.textContent = asset.photo ? '换照片' : '上传照片';
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.hidden = true;
      upload.addEventListener('click', () => input.click());
      input.addEventListener('change', async () => {
        const file = input.files?.[0]; if (!file) return;
        if (file.size > 15 * 1024 * 1024) { alert('请选小于 15 MB 的图片。'); return; }
        try { asset.photo = await compressPhoto(file); asset.focus = [.5,.5]; asset.zoom = 1; loadImage(asset); saveAssets(); studioSlots(); renderLevels(); updatePreview(); }
        catch (_) { alert('这张照片无法读取，请换一张试试。'); }
      });
      buttons.append(upload, input);
      if (asset.photo) {
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove'; remove.textContent = '移除';
        remove.addEventListener('click', () => { asset.photo = null; asset.image = null; saveAssets(); studioSlots(); renderLevels(); updatePreview(); });
        buttons.appendChild(remove);
      }
      if (asset.photo !== asset.basePhoto) {
        const restore = document.createElement('button'); restore.type = 'button'; restore.textContent = '恢复预设';
        restore.addEventListener('click', () => { asset.photo = asset.basePhoto; asset.focus = mode === 'comic' ? [.5,.5] : PRESETS[i].focus; asset.zoom = mode === 'comic' ? 1 : PRESETS[i].zoom; loadImage(asset); saveAssets(); studioSlots(); renderLevels(); updatePreview(); });
        buttons.appendChild(restore);
      }
      controls.append(label, name, buttons); slot.appendChild(controls); studioGrid.appendChild(slot);
    });
    studioGrid.scrollTop = scrollTop;
  }
  function compressPhoto(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        const c = document.createElement('canvas'); c.width = c.height = 320;
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0,0,320,320);
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        g.drawImage(image,(image.naturalWidth-side)/2,(image.naturalHeight-side)/2,side,side,0,0,320,320);
        resolve(c.toDataURL('image/jpeg', .78));
      };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      image.src = url;
    });
  }

  function canvasX(clientX) { const rect = canvas.getBoundingClientRect(); return (clientX - rect.left) * W / rect.width; }
  canvas.addEventListener('pointerdown', e => { pointerDown = true; aimX = canvasX(e.clientX); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' || pointerDown) aimX = canvasX(e.clientX); });
  canvas.addEventListener('pointerup', e => { if (pointerDown) { aimX = canvasX(e.clientX); drop(); } pointerDown = false; });
  canvas.addEventListener('pointercancel', () => { pointerDown = false; });
  window.addEventListener('keydown', e => {
    if (studio.open || howDialog.open || /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); aimX += e.code === 'ArrowLeft' ? -15 : 15; aimX = Math.max(24,Math.min(W-24,aimX)); }
    if (e.code === 'Space') { e.preventDefault(); drop(); }
    if (e.code === 'KeyR') startGame();
  });

  document.getElementById('restartBtn').addEventListener('click', startGame);
  document.getElementById('againBtn').addEventListener('click', startGame);
  document.getElementById('editBtn').addEventListener('click', () => { studioSlots(); studio.showModal(); });
  document.getElementById('closeStudio').addEventListener('click', () => studio.close());
  document.getElementById('doneBtn').addEventListener('click', () => { saveAssets(); studio.close(); startGame(); });
  document.getElementById('howBtn').addEventListener('click', () => howDialog.showModal());
  document.getElementById('closeHow').addEventListener('click', () => howDialog.close());
  document.getElementById('gotItBtn').addEventListener('click', () => howDialog.close());
  document.getElementById('soundBtn').addEventListener('click', e => { soundOn = !soundOn; e.currentTarget.setAttribute('aria-pressed', String(soundOn)); e.currentTarget.textContent = soundOn ? '♫ 音效开启' : '♫ 音效关闭'; });
  document.getElementById('photoModeBtn').addEventListener('click', () => setMode('photo'));
  document.getElementById('comicModeBtn').addEventListener('click', () => setMode('comic'));
  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({version:2,mode,levels:assets.map(({name,photo}) => ({name,photo}))},null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `爆笑合成局-${mode === 'comic' ? '漫画版' : '照片版'}-照片包.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importInput').click());
  document.getElementById('importInput').addEventListener('change', async e => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      if (file.size > 6 * 1024 * 1024) throw new Error('large');
      const pack = JSON.parse(await file.text());
      if (![1,2].includes(pack.version) || !Array.isArray(pack.levels) || pack.levels.length !== 10) throw new Error('invalid');
      if (pack.version === 2 && pack.mode !== 'photo' && pack.mode !== 'comic') throw new Error('invalid');
      pack.levels.forEach(entry => {
        if (typeof entry.name !== 'string' || entry.name.length > 16 || (entry.photo !== null && (typeof entry.photo !== 'string' || !(/^data:image\/(jpeg|png|webp);base64,/.test(entry.photo) || /^assets\/(photo|level)-\d{2}-[a-z]+\.(jpg|png|webp)$/.test(entry.photo))))) throw new Error('invalid');
      });
      if (pack.version === 2) setMode(pack.mode);
      pack.levels.forEach((entry, i) => {
        assets[i].name = entry.name || PRESETS[i].name; assets[i].photo = entry.photo;
        assets[i].focus = entry.photo === assets[i].basePhoto ? (mode === 'comic' ? [.5,.5] : PRESETS[i].focus) : [.5,.5];
        assets[i].zoom = entry.photo === assets[i].basePhoto ? (mode === 'comic' ? 1 : PRESETS[i].zoom) : 1;
        loadImage(assets[i]);
      });
      saveAssets(); studioSlots(); renderLevels(); updatePreview(); startGame();
    } catch (_) { alert('照片包格式不对，或文件太大。'); }
    e.target.value = '';
  });

  loadAssets(); renderLevels(); updateModeButtons(); startGame(); requestAnimationFrame(frame);
})();
