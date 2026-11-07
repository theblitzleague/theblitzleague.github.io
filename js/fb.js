/* One Firebase connection per page, shared by js/account.js and js/notes.js (an ES module is only ever loaded once
   per URL, so both get this same instance). Settings: js/firebase-config.js. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';

export const app = initializeApp(window.FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db = getFirestore(app);
// Pages other than Account only load the sign-in code on devices where someone has signed in (js/ui.js checks this).
export const SIGNED_IN_KEY = 'blitz.signedIn';
export function rememberSignedIn(on) {
  try { on ? localStorage.setItem(SIGNED_IN_KEY, '1') : localStorage.removeItem(SIGNED_IN_KEY); } catch (e) { /* private mode */ }
}
