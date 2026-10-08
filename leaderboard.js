(() => {
  'use strict';
  const nameInput = document.getElementById('playerNickname');
  const list = document.getElementById('leaderList');
  const status = document.getElementById('leaderStatus');
  const feedback = document.getElementById('rankFeedback');
  const retryButton = document.getElementById('retryRankBtn');
  const config = window.FAMILY_LEADERBOARD_CONFIG;
  const NAME_KEY = 'family-merge-nickname-v1';
  const TOKEN_KEY = 'family-merge-guest-v1';
  const QUEUE_KEY = 'family-merge-pending-scores-v1';
  const validRun = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
  const validScore = entry => entry && Number.isSafeInteger(entry.points) && entry.points > 0 && entry.points <= 10000000
    && validRun(entry.runId) && ['photo', 'comic'].includes(entry.mode);
  const connected = config?.url && config?.publishableKey;
  let loading = false, submitting = false, activeRun = '', rowsLoaded = false, guestToken = '', pending = [];
  try {
    const saved = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    if (Array.isArray(saved)) pending = saved.filter(validScore).slice(-20);
    const token = localStorage.getItem(TOKEN_KEY);
    if (/^[0-9a-f]{64}$/.test(token || '')) guestToken = token;
  } catch (_) {}
  function cleanName(value) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 12);
  }
  const randomName = () => '合友' + String(crypto.getRandomValues(new Uint16Array(1))[0] % 9000 + 1000);
  let nickname = '';
  try { nickname = localStorage.getItem(NAME_KEY) || ''; } catch (_) {}
  nickname = cleanName(nickname) || randomName();
  nameInput.value = nickname;
  function saveName() {
    nickname = cleanName(nameInput.value) || randomName();
    nameInput.value = nickname;
    try { localStorage.setItem(NAME_KEY, nickname); } catch (_) {}
  }
  function savePending() {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(pending)); } catch (_) {}
  }
  saveName();
  nameInput.addEventListener('change', saveName);
  nameInput.addEventListener('blur', saveName);
  async function request(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const headers = { apikey: config.publishableKey };
      if (body) headers['Content-Type'] = 'application/json';
      const response = await fetch(config.url + path, {
        method: body ? 'POST' : 'GET', headers, cache: 'no-store',
        ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw Object.assign(new Error('Leaderboard request failed'), { code: data?.error, status: response.status });
      return data;
    } finally { clearTimeout(timer); }
  }
  async function getGuest() {
    if (guestToken) return guestToken;
    const data = await request('/functions/v1/family-scores', { action: 'session' });
    if (!/^[0-9a-f]{64}$/.test(data?.token || '')) throw Error('Invalid guest response');
    guestToken = data.token;
    try { localStorage.setItem(TOKEN_KEY, guestToken); } catch (_) {}
    return guestToken;
  }
  function emptyRow(message) {
    const row = document.createElement('li');
    row.className = 'leader-empty'; row.textContent = message;
    list.replaceChildren(row);
  }
  function renderRows(rows) {
    list.replaceChildren();
    if (!rows.length) { emptyRow('近 7 天还没人上榜，来拿第一名！'); return; }
    rows.forEach((entry, index) => {
      const row = document.createElement('li'); row.className = 'leader-row';
      const rank = document.createElement('span'); rank.className = 'leader-rank'; rank.textContent = String(index + 1);
      const name = document.createElement('span'); name.className = 'leader-name'; name.textContent = cleanName(entry.nickname) || '神秘合友';
      const points = document.createElement('strong'); points.className = 'leader-score'; points.textContent = Number(entry.points || 0).toLocaleString();
      const meta = document.createElement('span'); meta.className = 'leader-meta';
      const date = new Date(entry.created_at);
      const dateText = Number.isFinite(date.getTime()) ? (date.getMonth() + 1) + '月' + date.getDate() + '日' : '';
      meta.textContent = (entry.game_mode === 'comic' ? '漫画版' : '原照版') + ' · ' + dateText;
      row.append(rank, name, points, meta); list.appendChild(row);
    });
  }
  async function refresh() {
    if (loading) return;
    if (!connected) { emptyRow('排行榜暂未连接。'); status.textContent = '本机游戏仍可正常游玩。'; return; }
    loading = true; status.textContent = '正在更新排行榜…';
    try {
      const data = await request('/rest/v1/family_recent_leaderboard?select=rank,nickname,points,game_mode,created_at&order=rank.asc&limit=20');
      if (!Array.isArray(data)) throw Error('Invalid leaderboard response');
      renderRows(data); rowsLoaded = true;
      status.textContent = '所有玩家共享 · 每人近 7 天最高分';
    } catch (_) {
      if (!rowsLoaded) emptyRow('榜单暂时无法加载，请稍后刷新。');
      status.textContent = rowsLoaded ? '暂时无法更新，正在显示上次榜单。' : '网络恢复后可再试一次。';
    } finally { loading = false; }
  }
  function beginRun(runId) {
    activeRun = runId; feedback.textContent = ''; retryButton.hidden = true;
  }
  function showFeedback(runId, message, retry = false) {
    if (runId !== activeRun) return;
    feedback.textContent = message; retryButton.hidden = !retry;
  }
  async function sendScore(entry, renew = true) {
    try {
      await request('/functions/v1/family-scores', {
        action: 'score', token: await getGuest(), runId: entry.runId,
        nickname: cleanName(entry.nickname) || nickname, points: entry.points, mode: entry.mode
      });
    } catch (error) {
      if (renew && error.code === 'invalid_session') {
        guestToken = '';
        try { localStorage.removeItem(TOKEN_KEY); } catch (_) {}
        return sendScore(entry, false);
      }
      throw error;
    }
  }
  async function flush() {
    if (submitting || !pending.length || !connected) return;
    submitting = true; retryButton.disabled = true;
    try {
      while (pending.length) {
        const entry = pending[0];
        showFeedback(entry.runId, '正在登记成绩…');
        await sendScore(entry);
        pending = pending.filter(item => item.runId !== entry.runId); savePending();
        showFeedback(entry.runId, '成绩已登记，前 20 名会出现在榜单里！');
        await refresh();
        if (pending.length) await new Promise(resolve => setTimeout(resolve, 3200));
      }
    } catch (error) {
      const dailyLimit = error.code === 'daily_limit';
      if (pending.some(entry => entry.runId === activeRun)) {
        showFeedback(activeRun, dailyLimit ? '今天登记次数已满，明天再来！' : '成绩待登记，联网后会自动重试。', !dailyLimit);
      }
    } finally { submitting = false; retryButton.disabled = false; }
  }
  function submit(points, mode, runId) {
    if (!validScore({ points, mode, runId })) {
      showFeedback(runId, '本局暂无可登记的分数。'); return Promise.resolve();
    }
    saveName();
    if (!pending.some(entry => entry.runId === runId)) pending.push({ points, mode, runId, nickname });
    if (pending.length > 20) pending.shift();
    savePending();
    showFeedback(runId, connected ? '正在登记成绩…' : '榜单未连接，本机纪录已保留。', !connected);
    return flush();
  }
  document.getElementById('refreshLeaderBtn').addEventListener('click', refresh);
  retryButton.addEventListener('click', flush);
  const retryOnline = () => { refresh(); flush(); };
  window.addEventListener('online', retryOnline);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) retryOnline(); });
  setInterval(() => { if (!document.hidden) retryOnline(); }, 60000);
  window.familyLeaderboard = Object.freeze({ submit, refresh, beginRun });
  refresh(); flush();
})();

