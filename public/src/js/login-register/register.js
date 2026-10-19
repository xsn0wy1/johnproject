document.addEventListener('DOMContentLoaded', async () => {
    'use strict';
    await window.HospitalI18n.ready;
    await window.HospitalAuth.ready;

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
        const levels = [[window.HospitalI18n.t("registration.muy_corta"), '#ff4d4d'], [window.HospitalI18n.t("registration.aceptable"), '#ffd633'], [window.HospitalI18n.t("registration.buena"), '#9acd32'], [window.HospitalI18n.t("registration.fuerte"), '#2ecc71']];
        bar.style.width = value ? `${(score + 1) * 25}%` : '0%'; bar.style.backgroundColor = levels[score][1];
        window.HospitalI18n.bindText(strength, () => value ? window.HospitalI18n.t("registration.longitud_value_minimo_12_caracteres", {value0: (levels)[score][0]}) : '');
    });
    form?.addEventListener('submit', async event => {
        event.preventDefault();
        if (!form.checkValidity()) return;
        const button = form.querySelector('[type="submit"]');
        if (button.disabled) return;
        button.disabled = true; message.style.color = ''; window.HospitalI18n.bindText(message, () => window.HospitalI18n.t("registration.registrando_solicitud"));
        try {
            const data = await window.HospitalApi.post('auth/register.php', Object.fromEntries(new FormData(form)));
            message.style.color = '#2ecc71'; window.HospitalI18n.bindText(message, () => data.message);
            form.reset(); bar.style.width = '0%'; window.HospitalI18n.bindText(strength, () => '');
        } catch (error) {
            window.HospitalApi.report(error, 'register'); window.HospitalI18n.bindText(message, () => '');
        } finally { button.disabled = false; }
    });
});
