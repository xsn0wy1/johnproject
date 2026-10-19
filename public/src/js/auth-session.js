(() => {
    'use strict';
    const api = window.HospitalApi;
    const loginUrl = api.page('index.html');
    const homeUrl = api.page('src/views/main-menu.html');
    const publicPage = location.pathname === new URL(loginUrl).pathname ||
        location.pathname === new URL(api.page('')).pathname || location.pathname.includes('/views/register-restore/');
    let current = null;
    let ready;
    let lastActivity = 0;
    let refreshing = null;
    let channel;
    let diagnosticsSent = false;
    function diagnostics(payload) {
        if (diagnosticsSent || !payload.settings.optional_diagnostics || document.readyState !== 'complete') return;
        const timing = performance.getEntriesByType('navigation')[0];
        if (!timing?.loadEventEnd) return;
        diagnosticsSent = true;
        api.post('settings/diagnostics.php', {load_ms:Math.min(120000, Math.max(0, Math.round(timing.loadEventEnd - timing.startTime)))})
            .catch(error => api.report(error, 'diagnostics'));
    }
    window.addEventListener('load', () => { if (current) setTimeout(() => diagnostics(current), 0); });
    try { channel = new BroadcastChannel(`hospital-auth:${api.page('')}`); } catch (_) { /* Polling still handles revocation. */ }

    function expired() {
        current = null;
        if (!publicPage) location.replace(loginUrl + '?reason=session_expired');
    }

    function render(payload) {
        const user = payload.user;
        const name = user.full_name || user.username;
        document.querySelectorAll('[data-current-user-name], .user-name').forEach(el => { window.HospitalI18n.bindText(el, () => name); });
        document.querySelectorAll('[data-current-user-welcome]').forEach(el => { window.HospitalI18n.bindText(el, () => window.HospitalI18n.t("auth_session.bienvenido_value", {value0: name})); });
        document.querySelectorAll('.profile-button').forEach(button => {
            button.toggleAttribute('data-profile-photo', Boolean(payload.settings.avatar_url));
            if (payload.settings.avatar_url && !button.querySelector('img')) { const image = document.createElement('img'); window.HospitalI18n.bindAttr(image, "alt", () => name); button.append(image); }
            if (!payload.settings.avatar_url) button.querySelector('img')?.remove();
        });
        document.querySelectorAll('[data-current-user-avatar], .user-avatar img, .profile-button img').forEach(el => {
            if (!el.dataset.defaultAvatar) el.dataset.defaultAvatar = el.getAttribute('src') || '';
            const source = payload.settings.avatar_url ? api.page(payload.settings.avatar_url) : el.dataset.defaultAvatar;
            if (el.getAttribute('src') !== source) el.src = source;
            window.HospitalI18n.bindAttr(el, "alt", () => name);
            el.toggleAttribute('data-profile-photo', Boolean(payload.settings.avatar_url));
            el.onerror = () => {
                console.error('[Hospital avatar]', {code:'AVATAR_UNAVAILABLE',message:window.HospitalI18n.t('auth.avatar_unavailable')}); el.onerror = null; el.removeAttribute('data-profile-photo');
                if (el.dataset.defaultAvatar) el.src = el.dataset.defaultAvatar;
                else { el.closest('.profile-button')?.removeAttribute('data-profile-photo'); el.remove(); }
            };
        });
        document.querySelectorAll('[data-current-user-national-id]').forEach(el => { window.HospitalI18n.bindText(el, () => user.national_id); });
        document.querySelectorAll('[data-current-user-role]').forEach(el => { window.HospitalI18n.bindText(el, () => window.HospitalI18n.t("auth_session.cargo_value", {value0: user.roles.map(window.HospitalI18n.role).join(', ')})); });
        window.HospitalTheme.accountTheme(payload.settings.theme, payload.user.id);
        window.HospitalI18n?.accountLocale(payload.settings.locale);
        document.querySelectorAll('[data-required-role]').forEach(el => { el.hidden = !user.roles.includes(el.dataset.requiredRole); });
        window.dispatchEvent(new CustomEvent('hospital:session', { detail: payload }));
        diagnostics(payload);
    }

    function apply(payload) {
        if (current?.user.id === payload.user.id && current.settings.version > payload.settings.version) return current;
        current = payload; render(payload); return payload;
    }

    async function refresh(touch = false) {
        if (refreshing) return refreshing;
        refreshing = (touch ? api.post('auth/heartbeat.php') : api.get('auth/me.php')).then(payload => {
            return apply(payload);
        }).catch(error => {
            api.report(error, 'session'); if (error.status === 401) expired();
            return null;
        }).finally(() => { refreshing = null; });
        return refreshing;
    }

    function start() {
        if (ready) return ready;
        ready = refresh().then(payload => {
            if (payload && publicPage) location.replace(homeUrl);
            if (payload && !publicPage) {
                setInterval(() => {
                    if (!document.hidden) refresh(Date.now() - lastActivity < 60000);
                }, 60000);
            }
            return payload;
        });
        return ready;
    }

    async function logout(button) {
        if (button) button.disabled = true;
        try {
            await api.post('auth/logout.php'); api.clearToken();
            channel?.postMessage('logout'); current = null; location.replace(loginUrl);
        } catch (error) {
            api.report(error, 'logout');
            if (error.status === 401) expired(); else if (button) button.disabled = false;
        }
    }

    ['pointerdown', 'keydown', 'touchstart'].forEach(type => document.addEventListener(type, event => {
        if (event.isTrusted) lastActivity = Date.now();
    }, { passive: true }));
    document.addEventListener('click', event => {
        const button = event.target.closest('[data-logout]');
        if (button) { event.preventDefault(); logout(button); }
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !publicPage) refresh(); });
    window.addEventListener('pageshow', event => { if (event.persisted && !publicPage) refresh(); });
    window.addEventListener('hospital:unauthorized', () => { if (!publicPage) expired(); });
    if (channel) channel.onmessage = event => { if (event.data === 'logout') expired(); else if (event.data === 'settings' && !publicPage) refresh(); };
    window.HospitalAuth = Object.freeze({ get ready() { return start(); }, get current() { return current; }, refresh, logout, apply,
        settingsChanged: payload => { apply(payload); channel?.postMessage('settings'); }
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
