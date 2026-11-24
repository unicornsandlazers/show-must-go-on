// Tiny client for the Apps Script backend. Every call is a GET, which avoids
// CORS preflight problems with Apps Script web apps.
window.API = {
  async call(action, params) {
    const base = (window.SMGO_CONFIG && window.SMGO_CONFIG.apiUrl) || '';
    if (!base || base.indexOf('PASTE_') === 0) {
      throw new Error('The game server is not configured yet (config.js).');
    }
    const url = new URL(base, location.href);
    url.searchParams.set('action', action);
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });
    url.searchParams.set('_', String(Date.now()));
    let res;
    try {
      res = await fetch(url.toString(), { cache: 'no-store', redirect: 'follow' });
    } catch (e) {
      throw new Error('Could not reach the server. Check your connection.');
    }
    if (!res.ok) throw new Error('Server error (' + res.status + ')');
    const body = await res.json();
    if (!body.ok) throw new Error(body.error || 'Something went wrong');
    return body.data;
  }
};

window.esc = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
};

window.store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
};
