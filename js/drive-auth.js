// ============================================================
//  ReelOra – drive-auth.js
//  Google Login über Google Identity Services (GSI) – Popup-Flow.
//  Kein Redirect, kein Client-Secret, kein Backend-Auth-Endpunkt.
// ============================================================
// Ablauf:
//  1. driveLoginPopup()  → öffnet Google-Popup, User bestätigt Zugriff
//  2. Access Token (~60 Min gültig) wird in localStorage abgelegt
//  3. scheduleSilentRefresh() holt alle 50 Min automatisch einen neuen
//     Token im Hintergrund (ohne Popup), solange die Google-Session
//     im Browser noch aktiv ist – "prompt:''" zeigt dabei kein UI
// ============================================================

let gsiTokenClient   = null;
let gsiInitAttempts  = 0;
let gsiRefreshTimer  = null;

function initGsiTokenClient() {
  if (typeof google === 'undefined' || !google.accounts?.oauth2) {
    // GSI-Script lädt async – notfalls kurz erneut versuchen
    if (gsiInitAttempts++ < 40) { setTimeout(initGsiTokenClient, 250); }
    return;
  }
  gsiTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: REELORA_CONFIG.GOOGLE_CLIENT_ID,
    scope:     REELORA_CONFIG.DRIVE_SCOPE,
    prompt:    '',
    callback:  () => {}, // wird pro Aufruf überschrieben
  });
  scheduleSilentRefresh();
}
window.addEventListener('load', initGsiTokenClient);

function saveDriveToken(tokenResponse) {
  const data = {
    access_token: tokenResponse.access_token,
    expires_at:   Date.now() + (Number(tokenResponse.expires_in || 3600) * 1000),
  };
  localStorage.setItem('reelora_drive_token', JSON.stringify(data));
  return data;
}

async function fetchGoogleUserInfo(accessToken) {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// Öffnet das Google-Popup und liefert { email } nach erfolgreichem Login
function driveLoginPopup() {
  return new Promise((resolve, reject) => {
    if (!gsiTokenClient) {
      reject(new Error('Google Login ist noch nicht bereit – bitte kurz warten und erneut versuchen.'));
      return;
    }
    gsiTokenClient.callback = async (resp) => {
      if (resp.error) { reject(new Error(resp.error)); return; }
      saveDriveToken(resp);
      const info = await fetchGoogleUserInfo(resp.access_token);
      resolve({ email: info?.email || '' });
    };
    gsiTokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

// Stille Erneuerung im Hintergrund – kein Popup, kein User-Interaction nötig
function scheduleSilentRefresh() {
  if (gsiRefreshTimer) clearInterval(gsiRefreshTimer);
  gsiRefreshTimer = setInterval(() => {
    if (!gsiTokenClient) return;
    const raw = localStorage.getItem('reelora_drive_token');
    if (!raw) return; // nicht verbunden -> nichts zu erneuern
    gsiTokenClient.callback = (resp) => {
      if (resp?.access_token) saveDriveToken(resp);
    };
    gsiTokenClient.requestAccessToken({ prompt: '' });
  }, 50 * 60 * 1000); // alle 50 Min, Access Token lebt ~60 Min
}

// Google-seitigen Zugriff widerrufen (beim Trennen)
function driveRevokeToken() {
  try {
    const raw = localStorage.getItem('reelora_drive_token');
    if (!raw) return;
    const { access_token } = JSON.parse(raw);
    if (access_token && typeof google !== 'undefined' && google.accounts?.oauth2) {
      google.accounts.oauth2.revoke(access_token, () => {});
    }
  } catch (_) { /* egal, lokale Daten werden trotzdem gelöscht */ }
}
