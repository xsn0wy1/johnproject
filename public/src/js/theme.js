/* Appearance only: SQL owns staff preferences; the cache contains one theme string. */
(() => {
    'use strict';
    const root = new URL('../../', document.currentScript.src);
    const publicPage = location.pathname === root.pathname || location.pathname === new URL('index.html', root).pathname ||
        location.pathname.includes('/register-restore/') || location.pathname.endsWith('/surveys/user-view/survey-user.html');
    const cacheKey = `hospital-theme:${root.pathname}`;
    const normalize = value => value === 'light' ? 'light' : 'dark';
    let current = 'dark', confirmed = 'dark', pending = null, account = null;
    try { current = normalize(localStorage.getItem(cacheKey)); } catch (_) { /* Appearance works without browser storage. */ }
    function remember(value) { try { localStorage.setItem(cacheKey, value); } catch (_) { /* Keep the in-memory choice. */ } }
    function controls() {
        document.querySelectorAll('[data-public-theme]').forEach(button => {
            const selected = button.dataset.publicTheme === current;
            button.setAttribute('aria-pressed', String(selected));
            button.classList.toggle('active', selected);
        });
        document.querySelectorAll('meta[name="theme-color"]').forEach(meta => { meta.content = current === 'light' ? '#f3f5fa' : '#101732'; });
    }
    function apply(value) {
        const next = normalize(value), changed = next !== current;
        current = next;
        document.documentElement.dataset.theme = current;
        controls();
        if (changed) window.dispatchEvent(new CustomEvent('hospital:themechange', {detail:{theme:current}}));
        return current;
    }
    function accountTheme(value, userId) {
        if (account !== userId) { account = userId; pending = null; }
        confirmed = normalize(value);
        if (!publicPage) { remember(confirmed); apply(pending?.theme || confirmed); }
    }
    function preview(value) { pending = {theme:normalize(value)}; apply(pending.theme); return pending; }
    function settle(choice) { if (pending === choice) { pending = null; apply(confirmed); } }
    function setPublicTheme(value) {
        if (!publicPage) return current;
        const next = apply(value); remember(next); return next;
    }
    window.HospitalTheme = Object.freeze({get current(){return current;}, accountTheme, preview, settle, setPublicTheme});
    apply(current);
    document.addEventListener('DOMContentLoaded', controls, {once:true});
    document.addEventListener('click', event => {
        const button = event.target.closest('[data-public-theme]');
        if (button && !button.disabled) setPublicTheme(button.dataset.publicTheme);
    });
    window.addEventListener('storage', event => {
        if (publicPage && event.key === cacheKey) apply(event.newValue);
    });
})();
