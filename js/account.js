/* Account page (account.html): sign in, turn on phone notifications, and, for the commissioner, send league-wide
   announcements and link each GM's account to their team.

   Sign-in is Firebase Authentication: Google, or an emailed one-time link (no passwords). On an iPhone the installed
   app keeps its own storage, separate from Safari, so an emailed link that opens in Safari signs in Safari, not the
   app. The page therefore also takes a pasted link, which signs in wherever it's pasted.
   Who may do what is enforced by firestore.rules, not by this page; the page only hides what a person can't use.
   Notifications: Firebase Cloud Messaging registers this phone with the site's own service worker (sw.js), which shows
   what functions/index.js sends. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, sendSignInLinkToEmail, isSignInWithEmailLink,
  signInWithEmailLink, signOut } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, getDocs, query, where, orderBy, limit,
  onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';
import { getMessaging, getToken, deleteToken, isSupported } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-messaging.js';

const { esc, teamName } = UI;
const app = initializeApp(window.FIREBASE_CONFIG);
const auth = getAuth(app), db = getFirestore(app);
const $ = id => document.getElementById(id);
const EMAIL_KEY = 'blitz.signinEmail';
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* private mode */ } } };
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let M, me = null, profile = null, commish = false, unsub = [];

const panel = (eyebrow, title, body, cls = 's12') => `<section class="panel ${cls}"><header><div><span class="eyebrow">${eyebrow}</span><h2>${title}</h2></div></header>${body}</section>`;
const note = (id, text = '') => `<p class="acct-note" id="${id}" role="status">${text}</p>`;
const say = (id, text, bad) => { const el = $(id); if (el) { el.textContent = text; el.classList.toggle('bad', !!bad); } };
const nice = e => (e && e.code ? e.code.replace(/^auth\/|^messaging\/|^firestore\//, '').replace(/-/g, ' ') : String((e && e.message) || e));
const teamLabel = id => (M && M.teams[id] ? teamName(M.teams[id]) : `Team ${id}`);

// ---------- signed out ----------
function signedOutView() {
  const pending = store.get(EMAIL_KEY);
  $('content').innerHTML = `<div class="grid">${panel('Blitz Hub account', 'Sign in', `
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
  commish = !!(roles && roles.exists() && (roles.data().commish || []).includes(u.uid));
  const team = profile.team && M.teams[profile.team];
  $('content').innerHTML = `<div class="grid">
    ${panel(commish ? 'Commissioner' : 'Blitz Hub account', esc(u.displayName || u.email || 'Signed in'), `
      <p class="acct-lead">${esc(u.email || '')}</p>
      <p>${team ? `GM of <a href="team.html?team=${team.id}"><b>${esc(teamName(team))}</b></a>.` : commish ? 'Not linked to a team.' : "Not linked to a team yet. The commissioner links your account to your team; you don't need to do anything."}</p>
      <div class="acct-row"><button class="btn" id="out">Sign out</button></div>`, 's6')}
    ${panel('This phone or computer', 'Notifications', `<div id="push"></div>${note('pushmsg')}`, 's6')}
    ${commish ? `<div class="s12" id="commish"></div>` : ''}
  </div>`;
  $('out').onclick = () => signOut(auth);
  pushView();
  if (commish) commishView();
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
        <input id="anntitle" maxlength="80" required placeholder="Title (shows in bold on the notification)">
        <textarea id="annbody" maxlength="1000" rows="4" required placeholder="Message to the whole league"></textarea>
        <div class="acct-row"><button class="btn primary" type="submit">Send to the league</button><span class="pmeta" id="anncount"></span></div>
      </form>${note('annmsg')}
      <div class="sub">Sent</div><div id="annlist" class="acct-list"></div>`, 's7')}
    ${panel('Commissioner', 'Link accounts to teams', `<p class="acct-note">Everyone who has signed in. Pick each GM's team; they get announcements once linked.</p><div id="members" class="acct-list"></div>${note('memmsg')}`, 's5')}
  </div>`;
  $('annform').onsubmit = async ev => {
    ev.preventDefault();
    const title = $('anntitle').value.trim(), body = $('annbody').value.trim();
    if (!title || !body) return;
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
  members();
}
async function members() {
  try {
    const [us, ds] = await Promise.all([getDocs(collection(db, 'users')), getDocs(collection(db, 'devices'))]);
    const phones = {};
    for (const d of ds.docs) phones[d.data().uid] = (phones[d.data().uid] || 0) + 1;
    const taken = {};
    for (const u of us.docs) if (u.data().team) taken[u.data().team] = u.id;
    const opts = cur => `<option value="">No team</option>` + Object.values(M.teams).sort((a, b) => teamName(a).localeCompare(teamName(b)))
      .map(t => `<option value="${t.id}"${t.id === cur ? ' selected' : ''}>${esc(teamName(t))}${taken[t.id] && t.id !== cur ? ' (linked)' : ''}</option>`).join('');
    $('members').innerHTML = us.docs.map(u => { const p = u.data();
      return `<div class="acct-item"><div><b>${esc(p.name || p.email || 'Unnamed')}</b><span class="pmeta">${esc(p.email || '')} · ${phones[u.id] ? `${phones[u.id]} device${phones[u.id] > 1 ? 's' : ''} with notifications` : 'no notifications'}${u.id === me.uid ? ' · you' : ''}</span></div>
        <select data-uid="${u.id}" aria-label="Team for ${esc(p.name || p.email || 'this person')}">${opts(p.team || null)}</select></div>`; }).join('') || '<p class="empty">No one has signed in yet.</p>';
    for (const s of $('members').querySelectorAll('select')) s.onchange = async () => {
      const team = s.value ? +s.value : null;
      if (team && taken[team] && taken[team] !== s.dataset.uid && !confirm(`${teamLabel(team)} is already linked to someone else. Link this person too?`)) { members(); return; }
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
    try { u ? await signedInView(u) : signedOutView(); }
    catch (e) { $('content').innerHTML = `<div class="error">Couldn't load your account (${esc(nice(e))}).</div>`; console.error(e); }
  });
});
