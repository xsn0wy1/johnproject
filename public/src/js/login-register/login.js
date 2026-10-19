document.addEventListener('DOMContentLoaded', () => {
    'use strict';
    const form = document.getElementById('loginForm');
    const message = document.getElementById('loginMessage');
    const password = document.getElementById('loginContraseña');
    const eye = document.getElementById('loginEyeIcon');
    document.getElementById('toggleLoginPasswordBtn')?.addEventListener('click', () => {
        password.type = password.type === 'password' ? 'text' : 'password';
        eye.src = window.HospitalApi.page(`assets/Icons/${password.type === 'password' ? 'eye.svg' : 'eye-closed.svg'}`);
    });
    if (new URLSearchParams(location.search).get('reason') === 'session_expired') console.info('[Hospital auth] Session ended.');
    form?.addEventListener('submit', async event => {
        event.preventDefault();
        if (!form.checkValidity()) return;
        const button = form.querySelector('[type="submit"]');
        if (button.disabled) return;
        button.disabled = true; message.style.color = ''; message.textContent = 'Iniciando sesión...';
        try {
            await window.HospitalApi.post('auth/login.php', Object.fromEntries(new FormData(form)));
            password.value = '';
            location.assign(window.HospitalApi.page('src/views/main-menu.html'));
        } catch (error) {
            window.HospitalApi.report(error, 'login'); message.textContent = ''; button.disabled = false;
        }
    });
});
