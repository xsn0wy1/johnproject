/* Shared interface translations. SQL owns staff preferences; record text is never translated. */
(() => {
    'use strict';
    const root = new URL('../../', document.currentScript.src);
    const dictionaries = { es: {}, en: {} };
    const bindings = new Map();
    let locale = 'es-UY', pendingLocale = null, confirmedLocale = 'es-UY', readyDone = false;
    const normalize = value => value === 'en' ? 'en' : 'es-UY';
    const publicPage = location.pathname === root.pathname || location.pathname === new URL('index.html', root).pathname || location.pathname.includes('/register-restore/') || location.pathname.endsWith('/surveys/user-view/survey-user.html');
    if (publicPage) locale = normalize(new URL(location.href).searchParams.get('lang'));
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    function lookup(key, params = {}) {
        let value = dictionaries[locale === 'en' ? 'en' : 'es'][key] ?? dictionaries.es[key];
        if (value && typeof value === 'object') { const form=Number(params.count) === 1 ? 'one' : 'other'; value = value[form] ?? dictionaries.es[key]?.[form]; }
        if (typeof value !== 'string' && typeof dictionaries.es[key] === 'string') value=dictionaries.es[key];
        return typeof value === 'string' ? value : null;
    }
    function t(key, params = {}) {
        const value = lookup(key, params);
        if (value === null) return '';
        return value.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name] ?? '') : match);
    }
    // Only explicitly bound copy is translated; interpolated record values remain data.
    function mark(key, params = {}) {
        return `<i18n-text style="display:contents" data-i18n="${escape(key)}" data-i18n-params="${escape(JSON.stringify(params))}">${escape(t(key, params))}</i18n-text>`;
    }
    function paramsFor(node, name = '') {
        try { return JSON.parse(node.getAttribute(`data-i18n${name ? '-'+name : ''}-params`) || node.getAttribute('data-i18n-params') || '{}'); }
        catch (_) { return {}; }
    }
    function translate(node = document) {
        if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_NODE) return;
        const elements = [...(node.matches?.('[data-i18n], [data-i18n-title], [data-i18n-placeholder], [data-i18n-alt], [data-i18n-aria-label], [data-i18n-aria-description], [data-i18n-caption]') ? [node] : []), ...node.querySelectorAll('[data-i18n], [data-i18n-title], [data-i18n-placeholder], [data-i18n-alt], [data-i18n-aria-label], [data-i18n-aria-description], [data-i18n-caption]')];
        for (const el of elements) {
            const key = el.getAttribute('data-i18n');
            if (key && lookup(key, paramsFor(el)) !== null) {
                const value = t(key, paramsFor(el)); if (el.textContent !== value) el.textContent = value;
            }
            for (const name of ['title','placeholder','alt','aria-label','aria-description','caption']) {
                const attrKey = el.getAttribute('data-i18n-'+name);
                if (attrKey && lookup(attrKey, paramsFor(el, name)) !== null) el.setAttribute(name === 'caption' ? 'data-caption' : name, t(attrKey, paramsFor(el, name)));
            }
        }
        publicLinks(node);
    }
    function binding(node, name, getter) {
        if (!node) return '';
        if (!node.nodeType && node !== document) { const value=getter(); node[name]=value; return value; }
        if (name === 'textContent') { node.removeAttribute?.('data-i18n'); node.removeAttribute?.('data-i18n-params'); }
        else node.removeAttribute?.('data-i18n-'+name);
        let fields = bindings.get(node); if (!fields) bindings.set(node, fields = new Map()); fields.set(name, getter);
        const value = String(getter() ?? '');
        if (name === 'textContent' || name === 'title' && node.nodeType === Node.DOCUMENT_NODE) { if (node[name] !== value) node[name] = value; }
        else if (name === '$validity') node.setCustomValidity(value);
        else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
        return value;
    }
    function publicLinks(node = document) {
        if (!publicPage) return;
        for (const link of [...(node.matches?.('a[href]') ? [node] : []), ...(node.querySelectorAll?.('a[href]') || [])]) {
            const url = new URL(link.getAttribute('href'), location.href);
            if (url.origin !== location.origin || url.hash && url.pathname === location.pathname || !(/(?:index\.html|register-restore\/[^/]+\.html)$/.test(url.pathname))) continue;
            if (locale === 'en') url.searchParams.set('lang', 'en'); else url.searchParams.delete('lang');
            if (link.href !== url.href) link.href = url.href;
        }
    }
    function apply(value) {
        const next = normalize(value); const changed = next !== locale;
        locale = next; document.documentElement.lang = locale === 'en' ? 'en' : 'es-UY';
        if (!readyDone) return locale;
        const active = document.activeElement, activeId = active?.id;
        const scopeId=active?.parentElement?.closest('[id]')?.id;
        const stableAttributes=['name','data-action','data-id','data-select-id','data-route-id','data-transfer-id','data-page','data-item-action','data-edit-answer','data-answer-rating','data-answer-choice'];
        const focusAttributes=stableAttributes.filter(name=>active?.hasAttribute(name)).map(name=>`[${name}="${CSS.escape(active.getAttribute(name))}"]`).join('');
        const focusSelector=focusAttributes?`${active.tagName.toLowerCase()}${focusAttributes}${active.matches('input[type=radio],input[type=checkbox]')?`[value="${CSS.escape(active.value)}"]`:''}`:null;
        const selection = typeof active?.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
        const scroll = [...document.querySelectorAll('*')].filter(el => el.scrollTop || el.scrollLeft).map(el => [el, el.scrollTop, el.scrollLeft]);
        const pageScroll = [window.scrollX, window.scrollY];
        translate();
        if (changed) window.dispatchEvent(new CustomEvent('hospital:localechange', {detail:{locale}}));
        for (const [node, fields] of bindings) {
            if (!node.isConnected && node !== document) { bindings.delete(node); continue; }
            for (const [name, getter] of fields) binding(node, name, getter);
        }
        document.querySelectorAll('[data-language-select], #settings-language').forEach(select => { select.value = select.querySelector('option[value="es-UY"]') ? locale : locale === 'en' ? 'en' : 'es'; select.lang=document.documentElement.lang; });
        if (active && !active.isConnected) {
            const scope=scopeId?document.getElementById(scopeId):document;
            const replacement = activeId?document.getElementById(activeId):focusSelector?scope?.querySelector(focusSelector):null; replacement?.focus({preventScroll:true});
            if (selection && replacement?.setSelectionRange && !['number','date','time','datetime-local'].includes(replacement.type)) replacement.setSelectionRange(...selection);
        }
        scroll.forEach(([el, top, left]) => { if (el.isConnected) { el.scrollTop=top; el.scrollLeft=left; } });
        window.scrollTo(...pageScroll);
        return locale;
    }
    function accountLocale(value) {
        confirmedLocale = normalize(value);
        if (!publicPage) apply(pendingLocale?.locale || confirmedLocale);
    }
    // Identity of the pending choice prevents older queued acknowledgements from replacing it.
    function preview(value) { pendingLocale = {locale:normalize(value)}; apply(pendingLocale.locale); return pendingLocale; }
    function settle(value) { if (pendingLocale === value) { pendingLocale = null; apply(confirmedLocale); } }
    function setPublicLocale(value) {
        const url = new URL(location.href); const next = normalize(value);
        if (next === 'en') url.searchParams.set('lang','en'); else url.searchParams.delete('lang');
        history.replaceState(history.state, '', url); apply(next);
    }
    function validationMessage(input) {
        const validity = input.validity;
        if (validity.customError) return input.validationMessage;
        const key = validity.valueMissing ? 'validation.required' : validity.typeMismatch ? 'validation.type' : validity.tooShort ? 'validation.too_short' : validity.tooLong ? 'validation.too_long' : validity.rangeUnderflow || validity.rangeOverflow ? 'validation.range' : validity.stepMismatch ? 'validation.step' : 'validation.format';
        return t(key, {min:input.minLength, max:input.maxLength, minimum:input.min, maximum:input.max});
    }
    const ready = Promise.all(['es','en'].map(async language => {
        try {
            const response = await fetch(new URL(`assets/i18n/${language}.json?v=20261019`, root), {credentials:'same-origin',cache:'no-cache'});
            if (!response.ok) throw new Error('I18N_ASSET_UNAVAILABLE');
            const dictionary = await response.json(); if (!dictionary || typeof dictionary !== 'object' || Array.isArray(dictionary)) throw new Error('I18N_ASSET_INVALID');
            dictionaries[language] = dictionary;
        } catch (_) { console.error('[Hospital i18n]', {code:'I18N_ASSET_UNAVAILABLE', language}); }
    })).then(() => { readyDone = true; apply(locale); });
    window.HospitalI18n = Object.freeze({
        ready, t, mark, escape, resolve:value => typeof value === "function" ? value() : value,
        category:item => dictionaries.es["catalog.document_categories."+item?.code] === item?.name ? t("catalog.document_categories."+item.code) : item?.name || "",
        role:code => t("account_role_code."+code) || code, html:(key,params) => escape(t(key,params)), translate, apply, normalize,
        get locale(){return locale;}, accountLocale, preview, settle, setPublicLocale, validationMessage,
        bindText:(node,getter) => binding(node,'textContent',getter),
        bindAttr:(node,name,getter) => binding(node,name,getter),
        bindValidity:(node,getter) => binding(node,'$validity',getter),
        bindTitle:getter => binding(document,'title',getter),
        setHTML(node,html) { node.removeAttribute?.('data-i18n'); bindings.delete(node); node.innerHTML=html; translate(node); return html; },
        option(getter,value,defaultSelected=false,selected=false) { const option=value===undefined?new Option():new Option('',value,defaultSelected,selected);binding(option,'textContent',getter);return option; },
        textNode(getter) { const node=document.createTextNode('');binding(node,'textContent',getter);return node; },
        date(value,options={}) {return new Intl.DateTimeFormat(locale,{timeZone:'America/Montevideo',...options}).format(value instanceof Date?value:new Date(value));},
        number(value,options={}) {return new Intl.NumberFormat(locale,options).format(value);}
    });
    const observer = new MutationObserver(records => {
        for (const record of records) {
            for (const node of record.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) translate(node);
            for (const node of record.removedNodes) if (!node.isConnected) for (const bound of bindings.keys()) if (bound === node || node.contains?.(bound)) bindings.delete(bound);
        }
    });
    observer.observe(document.documentElement,{childList:true,subtree:true});
    document.addEventListener('DOMContentLoaded', () => { ready.then(() => translate()); });
})();
