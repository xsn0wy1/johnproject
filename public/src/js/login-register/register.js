document.addEventListener('DOMContentLoaded', () => {
    'use strict';
    const form = document.getElementById('registerForm');
    const password = document.getElementById('contraseña');
    const eye = document.getElementById('eyeIcon');
    const bar = document.getElementById('strengthBar');
    const strength = document.getElementById('strengthText');
    const message = document.getElementById('registerMessage');
    document.getElementById('togglePasswordBtn')?.addEventListener('click', () => {
        password.type = password.type === 'password' ? 'text' : 'password';
        eye.src = window.HospitalApi.page(`assets/Icons/${password.type === 'password' ? 'eye.svg' : 'eye-closed.svg'}`);
    });
    password?.addEventListener('input', () => {
        const value = password.value;
        const score = value.length >= 20 ? 3 : value.length >= 16 ? 2 : value.length >= 12 ? 1 : 0;
        const levels = [['Muy corta', '#ff4d4d'], ['Aceptable', '#ffd633'], ['Buena', '#9acd32'], ['Fuerte', '#2ecc71']];
        bar.style.width = value ? `${(score + 1) * 25}%` : '0%'; bar.style.backgroundColor = levels[score][1];
        strength.textContent = value ? `Longitud: ${levels[score][0]} · mínimo 12 caracteres` : '';
    });
    form?.addEventListener('submit', async event => {
        event.preventDefault();
        if (!form.checkValidity()) return;
        const button = form.querySelector('[type="submit"]');
        if (button.disabled) return;
        button.disabled = true; message.style.color = ''; message.textContent = 'Registrando solicitud...';
        try {
            const data = await window.HospitalApi.post('auth/register.php', Object.fromEntries(new FormData(form)));
            message.style.color = '#2ecc71'; message.textContent = data.message;
            form.reset(); bar.style.width = '0%'; strength.textContent = '';
        } catch (error) {
            window.HospitalApi.report(error, 'register'); message.textContent = '';
        } finally { button.disabled = false; }
    });
});
