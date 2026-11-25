'use strict';
// Buddy phone app: talks to Buddy through a public MQTT broker. The pairing code (from
// Buddy's page http://buddy.local, passed as #k=...) is the secret part of every topic.
const BROKER = 'wss://broker.hivemq.com:8884/mqtt';
const CODE_RE = /^[a-z2-7]{26}$/;
const FOODS = [
  { name: 'Apfel', color: '#E03030', effect: 'zufrieden' },
  { name: 'Pizza', color: '#F2C14E', effect: 'verliebt + Hüpfer' },
  { name: 'Keks', color: '#C88A4A', effect: 'fröhlich + Hüpfer' },
  { name: 'Kaffee', color: '#8A5A3A', effect: 'hibbelig' },
];
const PRESETS = ['Bin gleich zu Hause', 'Essen ist fertig', 'Gute Nacht, Buddy', 'Hab dich lieb'];
const $ = (id) => document.getElementById(id);

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// --- pairing -------------------------------------------------------------
const fromHash = new URLSearchParams(location.hash.slice(1)).get('k');
if (fromHash && CODE_RE.test(fromHash)) {
  store.set('code', fromHash);
  history.replaceState(null, '', location.pathname);  // keep the secret out of the address bar
}
const code = store.get('code', null);

let client = null;
let state = { online: false };
let food = 0;

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function send(cmd) {
  if (!client || !client.connected) { toast('Keine Verbindung zum Briefkasten'); return null; }
  if (!state.online) toast('Buddy ist gerade offline – er bekommt es, sobald er online ist');
  cmd.id = Math.floor(Math.random() * 2147483647);
  client.publish(`buddy/${code}/cmd`, JSON.stringify(cmd), { qos: 1 });
  return cmd.id;
}

// --- rendering -----------------------------------------------------------
function hungerText(h) { return h === 2 ? 'Großer Hunger' : h === 1 ? 'Hungrig' : 'Satt'; }
function ago(epoch) {
  if (!epoch) return '';
  const h = Math.floor((Date.now() / 1000 - epoch) / 3600);
  return h < 1 ? 'Letztes Essen vor < 1 h' : `Letztes Essen vor ${h} h`;
}

function render() {
  const on = !!state.online;
  $('dot').classList.toggle('on', on);
  $('online').textContent = !client || !client.connected ? 'Verbinde …' : on ? 'Online' : 'Buddy ist offline';
  document.querySelector('.face').classList.toggle('off', !on);
  $('moodText').textContent = !on ? 'Buddy schläft oder hat kein WLAN' : state.mood >= 60 ? 'Buddy ist gut gelaunt' : state.mood >= 30 ? 'Buddy ist ganz okay' : 'Buddy braucht Zuwendung';
  $('mood').textContent = on ? `${state.mood} %` : '–';
  $('moodBar').style.width = on ? `${state.mood}%` : '0';
  for (const [v, l] of [['hunger', 'lastFed'], ['hunger2', 'lastFed2']]) {
    $(v).textContent = on ? hungerText(state.hunger) : '–';
    $(v).classList.toggle('warn', on && state.hunger > 0);
    $(l).textContent = on ? ago(state.lastFed) : '';
  }
  $('weather').textContent = on && state.temp !== undefined ? `${state.temp} ° · ${state.sky}` : '–';
  $('iss').textContent = on && state.issKm !== undefined ? `${state.issKm.toLocaleString('de-DE')} km` : '–';
  $('dnd').setAttribute('aria-pressed', on && state.dnd ? 'true' : 'false');
  $('dnd').textContent = on && state.dnd ? 'Nicht stören: an' : 'Nicht stören';
}

function renderHistory() {
  const ul = $('history');
  ul.replaceChildren();
  for (const m of store.get('history', [])) {
    const li = document.createElement('li');
    const t = document.createElement('span');
    t.textContent = m.text;
    const s = document.createElement('span');
    s.className = m.ok ? 'ok' : 'wait';
    s.textContent = m.ok ? 'angekommen' : 'gesendet';
    li.append(t, s);
    ul.append(li);
  }
}

function showTab(name) {
  for (const t of ['start', 'feed', 'msg']) $('tab-' + t).hidden = t !== name;
  document.querySelectorAll('.tabs button').forEach((b) => b.dataset.go === name ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  window.scrollTo(0, 0);
}

// --- set up --------------------------------------------------------------
function buildUi() {
  const foods = $('foods');
  FOODS.forEach((f, i) => {
    const b = document.createElement('button');
    b.className = 'food';
    b.setAttribute('aria-pressed', i === food ? 'true' : 'false');
    const ball = document.createElement('span');
    ball.className = 'ball';
    ball.style.background = f.color;
    const name = document.createElement('span');
    name.textContent = f.name;
    const eff = document.createElement('small');
    eff.textContent = f.effect;
    b.append(ball, name, eff);
    b.addEventListener('click', () => {
      food = i;
      foods.querySelectorAll('.food').forEach((x, j) => x.setAttribute('aria-pressed', j === i ? 'true' : 'false'));
      $('feedBtn').textContent = `${f.name} füttern`;
    });
    foods.append(b);
  });
  $('feedBtn').textContent = `${FOODS[food].name} füttern`;
  $('feedBtn').addEventListener('click', () => { if (send({ t: 'feed', food })) toast(`${FOODS[food].name} unterwegs zu Buddy`); });

  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.textContent = p;
    b.addEventListener('click', () => { $('text').value = p; $('count').textContent = p.length; });
    $('presets').append(b);
  }
  $('text').addEventListener('input', () => { $('count').textContent = $('text').value.length; });
  $('sendBtn').addEventListener('click', () => {
    const text = $('text').value.trim();
    if (!text) { toast('Bitte erst etwas schreiben'); return; }
    const id = send({ t: 'msg', text });
    if (id === null) return;
    const h = [{ id, text, ok: false }, ...store.get('history', [])].slice(0, 10);
    store.set('history', h);
    renderHistory();
    $('text').value = '';
    $('count').textContent = '0';
    toast('Gesendet');
  });

  $('timer').addEventListener('click', () => { if (send({ t: 'timer', min: 10 })) toast('Timer 10 min gestartet'); });
  $('dnd').addEventListener('click', () => send({ t: 'dnd', on: !state.dnd }));
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.go)));
  renderHistory();
  render();
}

function connect() {
  client = mqtt.connect(BROKER, {
    clientId: 'buddy-app-' + Math.random().toString(16).slice(2, 10),
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });
  client.on('connect', () => {
    client.subscribe([`buddy/${code}/state`, `buddy/${code}/ack`], { qos: 1 });
    render();
  });
  client.on('close', render);
  client.on('message', (topic, payload) => {
    let data;
    try { data = JSON.parse(payload.toString()); } catch { return; }
    if (topic.endsWith('/state')) {
      state = data && typeof data === 'object' ? data : { online: false };
      render();
    } else if (topic.endsWith('/ack')) {
      const h = store.get('history', []);
      const m = h.find((x) => x.id === data.id);
      if (m) { m.ok = true; store.set('history', h); renderHistory(); }
    }
  });
}

if (!code) {
  $('pair').hidden = false;
} else {
  $('app').hidden = false;
  buildUi();
  connect();
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
