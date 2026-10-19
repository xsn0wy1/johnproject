(() => {
    'use strict';
    const appRoot = new URL('../../', document.currentScript.src);
    const apiRoot = new URL('api/v1/', appRoot);
    let csrfToken = null;
    let csrfRequest = null;
    const reported = new WeakSet();

    function report(error, context = 'request') {
        if (error && typeof error === 'object') {
            if (reported.has(error)) return;
            reported.add(error);
        }
        console.error(`[Hospital ${context}]`, {
            code: error?.code || 'CLIENT_ERROR', status: error?.status || 0,
            message: error?.message || String(error), fields: error?.fields || {}, request_id: error?.requestId
        });
    }

    class ApiError extends Error {
        constructor(message, status, code, fields = {}) {
            super(message);
            this.name = 'ApiError'; this.status = status; this.code = code; this.fields = fields;
        }
    }

    async function token(force = false) {
        if (force) csrfToken = null;
        if (csrfToken) return csrfToken;
        if (!csrfRequest) {
            csrfRequest = request('auth/csrf.php').then(data => {
                csrfToken = data.csrf_token;
                return csrfToken;
            }).finally(() => { csrfRequest = null; });
        }
        return csrfRequest;
    }

    async function request(path, options = {}, retryCsrf = true, envelope = false) {
        await window.HospitalI18n.ready;
        const method = (options.method || 'GET').toUpperCase();
        const headers = new Headers(options.headers || {});
        headers.set('Accept', 'application/json');
        headers.set('X-Hospital-Locale', window.HospitalI18n.locale);
        const write = !['GET', 'HEAD'].includes(method);
        if (write) headers.set('X-CSRF-Token', await token());
        let response;
        try {
            response = await fetch(new URL(path, apiRoot), { ...options, method, headers, credentials: 'same-origin', cache: 'no-store' });
        } catch (_) {
            const error = new ApiError(window.HospitalI18n.t("api_client.no_se_pudo_conectar_con_el_servidor_revisa_la_conexion_e_intenta_nuevamente"), 0, 'NETWORK_ERROR');
            report(error); throw error;
        }
        let payload;
        try {
            if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error();
            payload = await response.json();
            if (typeof payload.success !== 'boolean') throw new Error();
        } catch (_) {
            const error = new ApiError(window.HospitalI18n.t("api_client.el_servidor_devolvio_una_respuesta_invalida_revisa_la_configuracion_de_php_y_la_api"), response.status, 'INVALID_RESPONSE');
            report(error); throw error;
        }
        if (!response.ok || payload.success !== true) {
            const error = new ApiError(payload.error?.message || window.HospitalI18n.t("api_client.no_se_pudo_completar_la_operacion"), response.status, payload.error?.code || 'REQUEST_FAILED', payload.error?.fields);
            error.requestId = payload.meta?.request_id;
            if (write && error.code === 'CSRF_INVALID' && retryCsrf) {
                await token(true);
                return request(path, options, false, envelope);
            }
            if (error.status === 401) window.dispatchEvent(new CustomEvent('hospital:unauthorized', { detail: error }));
            report(error);
            throw error;
        }
        if (payload.data?.csrf_token) csrfToken = payload.data.csrf_token;
        return envelope ? payload : payload.data;
    }

    window.HospitalApi = Object.freeze({
        request, token, ApiError, report,
        get: path => request(path),
        getPage: path => request(path, {}, true, true),
        post: (path, body = {}) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        page: path => new URL(path, appRoot).href,
        clearToken: () => { csrfToken = null; }
    });
    // Prevent browser validation bubbles as well as application error notices.
    document.addEventListener('invalid', event => {
        event.preventDefault();
        report(new ApiError(window.HospitalI18n.validationMessage(event.target), 422, 'VALIDATION_FAILED'), 'validation');
    }, true);
})();
