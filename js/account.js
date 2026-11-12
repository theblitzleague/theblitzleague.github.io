/* Account page (account.html): sign in, turn on phone notifications, and, for the commissioner, send league-wide
   announcements and link each GM's account to their team.

   Sign-in is Firebase Authentication: Google, or an emailed one-time link (no passwords). On an iPhone the installed
   app keeps its own storage, separate from Safari, so an emailed link that opens in Safari signs in Safari, not the
   app. The page therefore also takes a pasted link, which signs in wherever it's pasted.
   Who may do what is enforced by firestore.rules, not by this page; the page only hides what a person can't use.
   Notifications: Firebase Cloud Messaging registers this phone with the site's own service worker (sw.js), which shows
   what functions/index.js sends.
   Private messages: the commissioner can send to chosen teams instead of the whole league; each linked GM of those
   teams gets their own copy in notes/{id}, which only they (and the commissioner) can read. */
import { app, auth, db, rememberSignedIn } from './fb.js';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, sendSignInLinkToEmail, isSignInWithEmailLink,
  signInWithEmailLink, signOut } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, getDocs, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, arrayUnion, arrayRemove } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';
import { getMessaging, getToken, deleteToken, isSupported } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-messaging.js';

const { esc, teamName } = UI;
const $ = id => document.getElementById(id);
const EMAIL_KEY = 'blitz.signinEmail';
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* private mode */ } } };
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let M, me = null, profile = null, commish = false, owner = null, unsub = [], installPrompt = null;
// Android / desktop Chrome offer their own install button; keep the event so the setup checklist can use it.
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; setupView(); });

const panel = (eyebrow, title, body, cls = 's12') => `<section class="panel ${cls}"><header><div><span class="eyebrow">${eyebrow}</span><h2>${title}</h2></div></header>${body}</section>`;
const note = (id, text = '') => `<p class="acct-note" id="${id}" role="status">${text}</p>`;
const say = (id, text, bad) => { const el = $(id); if (el) { el.textContent = text; el.classList.toggle('bad', !!bad); } };
const nice = e => (e && e.code ? e.code.replace(/^auth\/|^messaging\/|^firestore\//, '').replace(/-/g, ' ') : String((e && e.message) || e));
const teamLabel = id => (M && M.teams[id] ? teamName(M.teams[id]) : `Team ${id}`);

// ---------- signed out ----------
function signedOutView() {
  const pending = store.get(EMAIL_KEY);
  $('content').innerHTML = `<div class="grid"><div class="s12" id="setup"></div>${panel('Blitz Hub account', 'Sign in', `
    <p class="acct-lead">Sign in once on each phone or computer. The commissioner links your account to your team; there's no password to make.</p>
    <div class="acct-row"><button class="btn primary" id="g">Sign in with Google</button></div>
    <div class="acct-or"><span>or</span></div>
    <form class="acct-row" id="mailform"><input type="email" id="mail" required autocomplete="email" placeholder="Your email address" value="${esc(pending || '')}">
      <button class="btn" type="submit">Email me a sign-in link</button></form>
    ${note('mailmsg')}
    <details class="acct-paste" ${pending ? 'open' : ''}><summary>Got the email? Paste the link here</summary>
      <p class="acct-note">${ios && standalone ? 'On iPhone, a link opened from Mail signs in Safari, not this app. ' : ''}In the email, press and hold the sign-in link, choose Copy, and paste it here.</p>
      <form class="acct-row" id="pasteform"><input type="url" id="paste" required placeholder="Paste the sign-in link"><button class="btn" type="submit">Sign in</button></form>
      ${note('pastemsg')}</details>`, 's6')}</div>`;
  $('g').onclick = async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (e) { say('mailmsg', `Google sign-in didn't finish (${nice(e)}).`, true); }
  };
  $('mailform').onsubmit = async ev => {
    ev.preventDefault();
    const email = $('mail').value.trim();
    try {
      await sendSignInLinkToEmail(auth, email, { url: location.origin + location.pathname, handleCodeInApp: true });
      store.set(EMAIL_KEY, email);
      say('mailmsg', `Sent. Check ${email} (and spam) for an email from Blitz Hub, then tap the link or paste it below.`);
      document.querySelector('.acct-paste').open = true;
    } catch (e) { say('mailmsg', `Couldn't send the email (${nice(e)}).`, true); }
  };
  $('pasteform').onsubmit = ev => { ev.preventDefault(); finishEmailLink($('paste').value.trim(), 'pastemsg'); };
  setupView();
}

// ---------- the "get set up" checklist (setup.html sends GMs here) ----------
function pushIsOn() {
  return 'Notification' in window && Notification.permission === 'granted' && !!store.get('blitz.pushId');
}
function setupView() {
  const box = $('setup');
  if (!box) return;
  const phone = ios || /Android/.test(navigator.userAgent);
  const steps = [];
  // 1. Install. On iPhone it must come first: the installed app keeps its own sign-in, separate from Safari.
  if (standalone) steps.push([true, 'Install the app', 'Installed. You opened Blitz Hub from your home screen.']);
  else if (ios) steps.push([false, 'Install the app', `In Safari, tap <b>Share</b> (the square with an arrow) at the bottom, then <b>Add to Home Screen</b> → <b>Add</b>. Then close Safari, open <b>Blitz Hub</b> from your home screen, and tap the <b>profile icon</b> at the top right to carry on there. On iPhone, notifications only work in the installed app.`]);
  else if (installPrompt) steps.push([false, 'Install the app', '<button class="btn primary" id="inst">Install Blitz Hub</button>']);
  else if (phone) steps.push([false, 'Install the app', "Open your browser's menu (⋮) and choose <b>Install app</b> or <b>Add to Home screen</b>, then open Blitz Hub from your home screen."]);
  else steps.push([true, 'Install the app', 'Optional on a computer. Notifications work in this browser.']);
  // 2. Sign in.
  steps.push([!!me, 'Sign in', me ? `Signed in as ${esc(me.email || me.displayName || 'you')}.` : ios && !standalone ? 'Do this in the installed app, after step 1.' : 'Use the sign-in box below: Google, or an emailed link. No password.']);
  // 3. Notifications.
  steps.push([pushIsOn(), 'Turn on notifications', pushIsOn() ? 'On for this device.' : me ? 'Tap <b>Turn on notifications</b> in the Notifications panel below, then <b>Allow</b>.' : 'After you sign in.']);
  // 4. Linked to a team (the commissioner does this).
  if (!commish) steps.push([!!(profile && profile.team), 'Get linked to your team', profile && profile.team ? `You're the GM of <b>${esc(teamLabel(profile.team))}</b>.` : "The commissioner does this once you've signed in. Nothing for you to do."]);
  const left = steps.filter(s => !s[0]).length;
  box.innerHTML = left === 0 ? '' : `<section class="panel setup"><header><div><span class="eyebrow">Get set up · ${steps.length - left} of ${steps.length} done</span><h2>Blitz Hub on your phone</h2></div></header>
    <ol class="setup-steps">${steps.map(([done, title, how], i) => `<li class="${done ? 'done' : ''}${!done && steps.slice(0, i).every(s => s[0]) ? ' next' : ''}">
      <span class="setup-n">${done ? '✓' : i + 1}</span><div><b>${title}</b><p>${how}</p></div></li>`).join('')}</ol></section>`;
  if ($('inst')) $('inst').onclick = async () => { const p = installPrompt; installPrompt = null; if (p) { p.prompt(); await p.userChoice.catch(() => {}); } setupView(); };
}

async function finishEmailLink(link, msgId) {
  if (!isSignInWithEmailLink(auth, link)) { say(msgId, "That isn't a Blitz Hub sign-in link.", true); return; }
  let email = store.get(EMAIL_KEY);
  if (!email) email = prompt('Which email address did you request the sign-in link with?');
  if (!email) return;
  try { await signInWithEmailLink(auth, email, link); store.set(EMAIL_KEY, null); history.replaceState(null, '', location.pathname); }
  catch (e) { say(msgId, `That link didn't work (${nice(e)}). Links work once and expire; request a new one.`, true); }
}

// ---------- signed in ----------
async function ensureProfile(u) {
  const ref = doc(db, 'users', u.uid);
  let snap = await getDoc(ref);
  if (!snap.exists()) { await setDoc(ref, { name: u.displayName || null, email: u.email || null, at: serverTimestamp() }); snap = await getDoc(ref); }
  return snap.data();
}

async function signedInView(u) {
  profile = await ensureProfile(u);
  const roles = await getDoc(doc(db, 'config', 'roles')).catch(() => null);
  const r = roles && roles.exists() ? roles.data() : {};
  commish = (r.commish || []).includes(u.uid);
  owner = r.owner || null;
  const team = profile.team && M.teams[profile.team];
  $('content').innerHTML = `<div class="grid"><div class="s12" id="setup"></div>
    ${panel(commish ? 'Commissioner' : 'Blitz Hub account', esc(u.displayName || u.email || 'Signed in'), `
      <p class="acct-lead">${esc(u.email || '')}</p>
      <p>${team ? `GM of <a href="team.html?team=${team.id}"><b>${esc(teamName(team))}</b></a>.` : commish ? 'Not linked to a team.' : "Not linked to a team yet. The commissioner links your account to your team; you don't need to do anything."}</p>
      <div class="acct-row"><button class="btn" id="out">Sign out</button></div>`, 's6')}
    ${panel('This phone or computer', 'Notifications', `<div id="push"></div>${note('pushmsg')}`, 's6')}
    ${panel('Just for you', 'Messages from the commissioner', `<div id="msgs" class="acct-list"><p class="pmeta">Loading…</p></div>`, 's12')}
    ${commish ? `<div class="s12" id="commish"></div>` : ''}
  </div>`;
  $('out').onclick = () => signOut(auth);
  pushView();
  myMessages();
  setupView();
  if (commish) commishView();
}

async function myMessages() {
  try {
    const snap = await getDocs(query(collection(db, 'notes'), where('to', '==', me.uid)));
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ((b.at && b.at.seconds) || 0) - ((a.at && a.at.seconds) || 0));
    UI.markSeen(list.map(n => n.id));
    $('msgs').innerHTML = list.map(n => `<div class="acct-item"><div><b>${esc(n.title)}</b><p>${esc(n.body)}</p><span class="pmeta">${n.at && n.at.toDate ? UI.annTime(n.at.toDate()) : ''}</span></div></div>`).join('')
      || '<p class="empty">No private messages. League-wide announcements are on the home page.</p>';
  } catch (e) { $('msgs').innerHTML = `<p class="acct-note bad">Couldn't load your messages (${esc(nice(e))}).</p>`; }
}

// ---------- notifications ----------
async function deviceId(token) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return me.uid + '-' + [...new Uint8Array(h)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function pushView() {
  const box = $('push');
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') { box.innerHTML = '<p>Notifications need the secure site (https).</p>'; return; }
  if (ios && !standalone) {
    box.innerHTML = `<p>On iPhone, notifications only work in the installed app. In Safari, tap <b>Share</b> then <b>Add to Home Screen</b>, open Blitz Hub from your home screen, and sign in there.</p>`;
    return;
  }
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !(await isSupported().catch(() => false))) {
    box.innerHTML = "<p>This browser can't receive notifications.</p>"; return;
  }
  const mine = await getDocs(query(collection(db, 'devices'), where('uid', '==', me.uid))).catch(() => null);
  const on = Notification.permission === 'granted' && store.get('blitz.pushId') && mine && mine.docs.some(d => d.id === store.get('blitz.pushId'));
  if (Notification.permission === 'denied') {
    box.innerHTML = `<p>Notifications are blocked for Blitz Hub on this ${ios ? 'phone' : 'browser'}. Turn them back on in ${ios ? 'Settings › Notifications › Blitz Hub' : "the browser's site settings"}, then reload this page.</p>`;
    return;
  }
  box.innerHTML = on
    ? `<p><span class="tag ok">On</span> This ${ios ? 'phone' : 'device'} gets Blitz Hub notifications${commish ? '' : ' once your team is linked'}.</p><div class="acct-row"><button class="btn" id="poff">Turn off on this device</button></div>`
    : `<p>Get the commissioner's announcements on this ${ios ? 'phone' : 'device'}. Lineup and injury alerts come later.</p><div class="acct-row"><button class="btn primary" id="pon">Turn on notifications</button></div>`;
  if ($('pon')) $('pon').onclick = pushOn;
  if ($('poff')) $('poff').onclick = pushOff;
  setupView();
}
async function pushOn() {
  say('pushmsg', 'Asking for permission…');
  try {
    if ((await Notification.requestPermission()) !== 'granted') { say('pushmsg', 'Permission was not given.', true); return pushView(); }
    const reg = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    const token = await getToken(getMessaging(app), { vapidKey: window.FIREBASE_VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) throw new Error('no registration came back');
    const id = await deviceId(token);
    await setDoc(doc(db, 'devices', id), { uid: me.uid, token, at: serverTimestamp(), device: (ios ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'Computer') + (standalone ? ' app' : ' browser') });
    store.set('blitz.pushId', id);
    say('pushmsg', 'Done. This device will get Blitz Hub notifications.');
  } catch (e) { say('pushmsg', `Couldn't turn on notifications (${nice(e)}).`, true); }
  pushView();
}
async function pushOff() {
  try {
    const id = store.get('blitz.pushId');
    if (id) await deleteDoc(doc(db, 'devices', id));
    await deleteToken(getMessaging(app)).catch(() => {});
    store.set('blitz.pushId', null);
    say('pushmsg', 'Turned off on this device.');
  } catch (e) { say('pushmsg', `Couldn't turn off (${nice(e)}).`, true); }
  pushView();
}

// ---------- commissioner ----------
function commishView() {
  $('commish').innerHTML = `<div class="grid">
    ${panel('Commissioner', 'Send an announcement', `
      <form id="annform" class="acct-ann">
        <div class="acct-to" role="radiogroup" aria-label="Send to">
          <label><input type="radio" name="to" value="league" checked> Whole league</label>
          <label><input type="radio" name="to" value="teams"> Specific GMs</label></div>
        <div id="pick" class="acct-pick" hidden></div>
        <input id="anntitle" maxlength="80" required placeholder="Title (shows in bold on the notification)">
        <textarea id="annbody" maxlength="1000" rows="4" required placeholder="Message to the whole league"></textarea>
        <div class="acct-row"><button class="btn primary" type="submit" id="annsend">Send to the league</button><span class="pmeta" id="anncount"></span></div>
      </form>${note('annmsg')}
      <div class="sub">Sent to the league</div><div id="annlist" class="acct-list"></div>
      <div class="sub">Sent to specific GMs</div><div id="notelist" class="acct-list"></div>`, 's7')}
    ${panel('Commissioner', 'Link accounts to teams', `<p class="acct-note">Everyone who has signed in. Pick each GM's team; they get announcements once linked.</p><div id="members" class="acct-list"></div>${note('memmsg')}`, 's5')}
    ${panel('Commissioner', 'League backup', `<p class="acct-note">Everything the League has, as an Excel workbook: franchises, members, rosters, every week's lineups and scores, standings, schedules, playoffs, drafts and every pick, transactions, trades, waiver claims, FAAB, pick ownership, history and the ledger. A copy is saved every night at 2:30 AM Central and kept for good, plus a permanent season-final copy once each Blitz Bowl is official.</p>
      <div class="acct-row"><button class="btn primary" id="bk-now">Download the workbook now</button><select id="bk-day" aria-label="Saved night"><option value="">Saved nights…</option></select><button class="btn" id="bk-get">Download that night</button><button class="btn" id="bk-json">That night's raw data (.json)</button></div>${note('bkmsg')}`, 's12')}
    <div id="scoring-ui" class="s12"></div>
    ${panel('Commissioner', 'Scheduled reminders', `<p class="acct-note">Messages the site sends on its own. Sent ones appear under "Sent to specific GMs" as Automatic reminder.</p><div id="sched" class="acct-list"><p class="pmeta">Loading…</p></div>`, 's12')}
  </div>`;
  const toTeams = () => document.querySelector('input[name="to"]:checked').value === 'teams';
  // The send button says who it goes to: the league, or the GMs of the teams picked.
  const sendLabel = () => {
    const n = toTeams() ? $('pick').querySelectorAll('input:checked').length : 0, one = n === 1 && $('pick').querySelector('input:checked');
    $('annsend').textContent = !toTeams() ? 'Send to the league' : !n ? 'Pick a team to send to'
      : one ? `Send to ${M.teams[one.value] ? teamName(M.teams[one.value]) : 'that team'}` : `Send to ${n} teams`;
    $('annbody').placeholder = toTeams() ? 'Message to the GMs you picked' : 'Message to the whole league';
  };
  for (const r of document.querySelectorAll('input[name="to"]')) r.onchange = () => { $('pick').hidden = !toTeams(); sendLabel(); };
  $('pick').addEventListener('change', sendLabel);
  $('annform').addEventListener('reset', () => setTimeout(sendLabel, 0));
  $('annform').onsubmit = async ev => {
    ev.preventDefault();
    const title = $('anntitle').value.trim(), body = $('annbody').value.trim();
    if (!title || !body) return;
    if (toTeams()) return sendNotes(title, body);
    if (!confirm(`Send this to the whole league now?\n\n${title}\n${body}`)) return;
    try {
      const ref = await addDoc(collection(db, 'announcements'), { title, body, by: me.uid, at: serverTimestamp() });
      UI.markSeen([ref.id]);                        // you wrote it; don't pop it up for you
      $('annform').reset(); say('annmsg', 'Sent. Delivery count appears below in a few seconds.');
    } catch (e) { say('annmsg', `Couldn't send (${nice(e)}).`, true); }
  };
  unsub.push(onSnapshot(query(collection(db, 'announcements'), orderBy('at', 'desc'), limit(10)), s => {
    $('annlist').innerHTML = s.docs.map(d => { const a = d.data(), at = a.at && a.at.toDate ? a.at.toDate() : null;
      return `<div class="acct-item"><div><b>${esc(a.title)}</b><p>${esc(a.body)}</p><span class="pmeta">${at ? at.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'sending…'} · ${a.done ? `delivered to ${a.sent} device${a.sent === 1 ? '' : 's'}${a.failed ? `, ${a.failed} failed` : ''}` : 'sending…'}</span></div>
        <button class="btn small" data-del="${d.id}" title="Remove from the site (doesn't unsend notifications)">Remove</button></div>`; }).join('') || '<p class="empty">Nothing sent yet.</p>';
    UI.markSeen(s.docs.map(d => d.id));            // the commissioner sees them here, so they never pop up for you
    for (const b of $('annlist').querySelectorAll('[data-del]')) b.onclick = async () => {
      if (confirm('Remove this announcement from the site? Notifications already delivered stay on phones.')) await deleteDoc(doc(db, 'announcements', b.dataset.del)).catch(e => say('annmsg', nice(e), true));
    };
  }, e => say('annmsg', `Couldn't load sent announcements (${nice(e)}).`, true)));
  unsub.push(onSnapshot(query(collection(db, 'notes'), orderBy('at', 'desc'), limit(20)), s => {
    UI.markSeen(s.docs.map(d => d.id));
    $('notelist').innerHTML = s.docs.map(d => { const n = d.data(), at = n.at && n.at.toDate ? n.at.toDate() : null;
      return `<div class="acct-item"><div><span class="pmeta">${n.by === 'system' ? (n.team ? `<b>Automatic reminder</b> → ${esc(teamLabel(n.team))}` : '<b>Site alert</b> to you') : `To <b>${esc(n.team ? teamLabel(n.team) : 'a GM')}</b>`}</span><b>${esc(n.title)}</b><p>${esc(n.body)}</p>
        <span class="pmeta">${at ? UI.annTime(at) : 'sending…'} · ${n.done ? (n.sent ? `delivered to ${n.sent} device${n.sent === 1 ? '' : 's'}` : 'no phone with notifications on; they\'ll see it next time they open the site') + (n.failed ? `, ${n.failed} failed` : '') : 'sending…'}</span></div>
        <button class="btn small" data-delnote="${d.id}" title="Remove it (doesn't unsend a notification)">Remove</button></div>`; }).join('') || '<p class="empty">Nothing sent yet.</p>';
    for (const b of $('notelist').querySelectorAll('[data-delnote]')) b.onclick = async () => {
      if (confirm('Remove this message? A notification already delivered stays on their phone.')) await deleteDoc(doc(db, 'notes', b.dataset.delnote)).catch(e => say('annmsg', nice(e), true));
    };
  }, e => say('annmsg', `Couldn't load sent messages (${nice(e)}).`, true)));
  members();
  backupPanel();
  scheduled();
  import('./scoring-admin.js?v=1').then(m => m.scoringAdmin(M, $('scoring-ui'))).catch(e => console.error(e));
}

// Automatic messages and when they run. Keep in step with functions/index.js (DUES dates and the watchRefresh schedule).
const SCHEDULE = [
  { when: '2027-03-06T10:00:00-06:00', title: 'Dues due in one week', to: 'unpaid' },
  { when: '2027-03-12T10:00:00-06:00', title: 'Dues due tomorrow', to: 'unpaid' },
  { when: '2027-03-14T10:00:00-05:00', title: 'Dues are past due', to: 'unpaid' },
  { when: '2027-03-17T10:00:00-05:00', title: 'Last day for dues (seat goes to a replacement March 18)', to: 'unpaid' },
];
async function scheduled() {
  const box = $('sched');
  try {
    const season = Number(M.league.duesSeason) || 2027;
    const [us, led] = await Promise.all([getDocs(collection(db, 'users')), getDocs(query(collection(db, 'ledger'), where('season', '==', season))).catch(() => null)]);
    const entries = led ? led.docs.map(d => ({ id: d.id, ...d.data() })) : [];
    const voided = new Set(entries.filter(e => e.kind === 'void').map(e => e.ref));
    const paid = new Set(entries.filter(e => e.kind === 'dues' && !voided.has(e.id)).map(e => e.team));
    const unpaid = us.docs.filter(u => u.data().team && !paid.has(u.data().team)).map(u => teamLabel(u.data().team));
    const now = Date.now(), fmt = d => d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const rows = SCHEDULE.map(s => ({ ...s, at: new Date(s.when) })).map(s => `<div class="acct-item"><div><b>${esc(s.title)}</b>
        <span class="pmeta">${+s.at < now ? 'Already ran' : `Next: ${fmt(s.at)}`} · goes to GMs whose ${season} dues are unpaid</span>
        <span class="pmeta">${+s.at < now ? '' : unpaid.length ? `If it ran now: ${unpaid.length} team${unpaid.length > 1 ? 's' : ''} (${esc(unpaid.join(', '))})` : 'If it ran now: nobody, every linked team has paid or no GMs are linked yet'}</span></div></div>`);
    rows.push(`<div class="acct-item"><div><b>Nightly refresh check</b><span class="pmeta">Every day at 5:30 AM Central · goes to you only if the site's NFL data didn't refresh overnight</span></div></div>`);
    box.innerHTML = rows.join('');
  } catch (e) { box.innerHTML = `<p class="acct-note bad">Couldn't load the schedule (${esc(nice(e))}).</p>`; }
}

// Linked GMs by team, for the "Specific GMs" picker and for sending.
let linked = {};
function picker() {
  $('pick').innerHTML = Object.values(M.teams).sort((a, b) => teamName(a).localeCompare(teamName(b))).map(t => {
    const gms = linked[t.id] || [];
    return `<label class="${gms.length ? '' : 'off'}"><input type="checkbox" value="${t.id}"${gms.length ? '' : ' disabled'}> ${esc(teamName(t))}
      <span class="pmeta">${gms.length ? esc(gms.map(g => g.name || g.email || 'GM').join(', ')) : 'no GM signed in yet'}</span></label>`; }).join('');
}
async function sendNotes(title, body) {
  const teams = [...$('pick').querySelectorAll('input:checked')].map(i => +i.value);
  if (!teams.length) { say('annmsg', 'Tick at least one team.', true); return; }
  const to = teams.flatMap(t => (linked[t] || []).map(g => ({ uid: g.uid, team: t })));
  if (!confirm(`Send this privately to ${teams.map(teamLabel).join(', ')}?\n\n${title}\n${body}`)) return;
  try {
    const refs = await Promise.all(to.map(r => addDoc(collection(db, 'notes'), { to: r.uid, team: r.team, title, body, by: me.uid, at: serverTimestamp() })));
    UI.markSeen(refs.map(r => r.id));
    $('annform').reset(); $('pick').hidden = true;
    say('annmsg', `Sent to ${teams.length} team${teams.length > 1 ? 's' : ''}. Delivery shows below in a few seconds.`);
  } catch (e) { say('annmsg', `Couldn't send (${nice(e)}).`, true); }
}
async function members() {
  try {
    const [us, ds, rs] = await Promise.all([getDocs(collection(db, 'users')), getDocs(collection(db, 'devices')), getDoc(doc(db, 'config', 'roles'))]);
    const cl = (rs.exists() && rs.data().commish) || [], isOwner = owner === me.uid;
    const role = id => (id === owner ? ' · owner' : cl.includes(id) ? ' · co-commissioner' : '');
    const phones = {};
    for (const d of ds.docs) phones[d.data().uid] = (phones[d.data().uid] || 0) + 1;
    const taken = {};
    linked = {};
    for (const u of us.docs) if (u.data().team) { taken[u.data().team] = u.id; (linked[u.data().team] = linked[u.data().team] || []).push({ uid: u.id, ...u.data() }); }
    if ($('pick')) picker();
    const opts = cur => `<option value="">No team</option>` + Object.values(M.teams).sort((a, b) => teamName(a).localeCompare(teamName(b)))
      .map(t => `<option value="${t.id}"${t.id === cur ? ' selected' : ''}${taken[t.id] && t.id !== cur ? ' disabled' : ''}>${esc(teamName(t))}${taken[t.id] && t.id !== cur ? ' (taken)' : ''}</option>`).join('');
    $('members').innerHTML = us.docs.map(u => { const p = u.data();
      return `<div class="acct-item"><div><b>${esc(p.name || p.email || 'Unnamed')}</b><span class="pmeta">${esc(p.email || '')} · ${phones[u.id] ? `${phones[u.id]} device${phones[u.id] > 1 ? 's' : ''} with notifications` : 'no notifications'}${role(u.id)}${u.id === me.uid ? ' · you' : ''}</span>
          ${isOwner && u.id !== owner ? `<label class="acct-co"><input type="checkbox" data-co="${u.id}"${cl.includes(u.id) ? ' checked' : ''}> Co-commissioner</label>` : ''}</div>
        <select data-uid="${u.id}" aria-label="Team for ${esc(p.name || p.email || 'this person')}">${opts(p.team || null)}</select></div>`; }).join('') || '<p class="empty">No one has signed in yet.</p>';
    for (const c of $('members').querySelectorAll('[data-co]')) c.onchange = async () => {
      const who = c.closest('.acct-item').querySelector('b').textContent;
      if (!confirm(c.checked ? `Make ${who} a co-commissioner? They'll be able to send announcements and private messages, and link accounts to teams.` : `Remove ${who} as co-commissioner?`)) { c.checked = !c.checked; return; }
      try { await updateDoc(doc(db, 'config', 'roles'), { commish: c.checked ? arrayUnion(c.dataset.co) : arrayRemove(c.dataset.co) }); say('memmsg', c.checked ? `${who} is now a co-commissioner.` : `${who} is no longer a co-commissioner.`); members(); }
      catch (e) { c.checked = !c.checked; say('memmsg', `Couldn't change that (${nice(e)}).`, true); }
    };
    for (const s of $('members').querySelectorAll('select')) s.onchange = async () => {
      const team = s.value ? +s.value : null;
      // One person runs each franchise: a team already linked to someone must be unlinked from them first.
      if (team && taken[team] && taken[team] !== s.dataset.uid) { say('memmsg', `${teamLabel(team)} is already linked to another account. One person per franchise: unlink them first.`, true); members(); return; }
      try { await updateDoc(doc(db, 'users', s.dataset.uid), { team }); say('memmsg', team ? `Linked to ${teamLabel(team)}.` : 'Unlinked.'); members(); }
      catch (e) { say('memmsg', `Couldn't save (${nice(e)}).`, true); }
    };
  } catch (e) { say('memmsg', `Couldn't load members (${nice(e)}).`, true); }
}

// ---------- start ----------
UI.boot('<strong>Account</strong>', async model => {
  M = model;
  if (isSignInWithEmailLink(auth, location.href)) {
    $('content').innerHTML = '<div class="loading">Signing you in</div>';
    signedOutView();
    await finishEmailLink(location.href, 'pastemsg');
  }
  onAuthStateChanged(auth, async u => {
    unsub.forEach(f => f()); unsub = [];
    me = u;
    rememberSignedIn(!!u);
    try { u ? await signedInView(u) : signedOutView(); }
    catch (e) { $('content').innerHTML = `<div class="error">Couldn't load your account (${esc(nice(e))}).</div>`; console.error(e); }
  });
});

// League backup (functions/index.js "backup"): a fresh workbook now, or one of the nightly copies.
async function backupPanel() {
  const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/12.6.0/firebase-functions.js');
  const call = httpsCallable(getFunctions(app, 'us-central1'), 'backup', { timeout: 300000 });
  const save = (name, b64, type) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([u], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); };
  const XL = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const run = async (btn, label, fn) => { btn.disabled = true; const t = btn.textContent; btn.textContent = label; try { await fn(); } catch (e) { say('bkmsg', `Couldn't do that (${nice(e)}).`, true); } finally { btn.disabled = false; btn.textContent = t; } };
  call({ action: 'list' }).then(r => { const days = r.data.days || [], finals = r.data.finals || [];
    $('bk-day').innerHTML = `<option value="">${days.length || finals.length ? 'Saved copies…' : 'No saved copies yet'}</option>`
      + finals.map(d => `<option value="${d}">${d.replace(/^season-(\d{4})-final$/, '$1 season final')}</option>`).join('') + days.map(d => `<option>${d}</option>`).join(''); }).catch(() => {});
  $('bk-now').onclick = () => run($('bk-now'), 'Building…', async () => { const r = (await call({ action: 'now' })).data; save(r.name, r.data, XL); say('bkmsg', `Downloaded ${r.name}.`); });
  const get = kind => run(kind === 'json' ? $('bk-json') : $('bk-get'), 'Downloading…', async () => {
    const day = $('bk-day').value; if (!day) { say('bkmsg', 'Pick a saved night first.', true); return; }
    const r = (await call({ action: 'get', day, kind })).data; save(r.name, r.data, kind === 'json' ? 'application/json' : XL); say('bkmsg', `Downloaded ${r.name}.`); });
  $('bk-get').onclick = () => get('xlsx'); $('bk-json').onclick = () => get('json');
}
