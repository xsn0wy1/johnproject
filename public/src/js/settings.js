document.addEventListener('DOMContentLoaded', () => {
    'use strict';
    const api = window.HospitalApi;
    const auth = window.HospitalAuth;
    const byId = id => document.getElementById(id);
    const tabs = [...document.querySelectorAll('.settings-tab')];
    const panels = [...document.querySelectorAll('.settings-panel')];
    const dirty = new Map();
    let state = null;
    let saveQueue = Promise.resolve();
    let facilities = [];
    let specialtiesBusy = false;

    function openTab(selected) {
        tabs.forEach(tab => {
            const active = tab === selected;
            tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
        });
        panels.forEach(panel => { panel.hidden = panel.id !== selected.dataset.tab; });
    }
    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => openTab(tab));
        tab.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
            openTab(tabs[next]); tabs[next].focus();
        });
    });

    function render(payload) {
        state = payload;
        const {user, settings} = payload;
        const values = {full_name:user.full_name, email:user.email, default_facility_id:settings.default_facility_id || '', locale:settings.locale};
        const controls = {full_name:'settings-name', email:'settings-email', default_facility_id:'settings-center', locale:'settings-language'};
        const select = byId('settings-center');
        const previous = select.value;
        select.replaceChildren(new Option('', ''));
        facilities.forEach(facility => select.add(new Option(facility.name, facility.id)));
        if (settings.default_facility_id && !facilities.some(item => item.id === settings.default_facility_id)) {
            const old = new Option(settings.default_facility_name, settings.default_facility_id); old.disabled = true; select.add(old);
        }
        select.value = dirty.has('default_facility_id') ? previous : values.default_facility_id;
        Object.entries(controls).forEach(([field, id]) => { if (!dirty.has(field)) byId(id).value = values[field]; });
        document.querySelectorAll('[data-preference]').forEach(button => {
            if (dirty.has(button.dataset.preference)) return;
            const on = settings[button.dataset.preference]; button.classList.toggle('is-on', on); button.setAttribute('aria-checked', String(on));
        });
        document.querySelectorAll('[data-theme-option]').forEach(button => {
            const active = button.dataset.themeOption === settings.theme;
            button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
        });
        document.querySelector('.theme-switch').dataset.theme = settings.theme;
        document.querySelectorAll('.specialty-chip[data-specialty-id]').forEach(chip => chip.remove());
        const add = document.querySelector('.specialty-add');
        settings.specialties.forEach(specialty => {
            const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'specialty-chip';
            chip.dataset.specialtyId = specialty.id; chip.textContent = `${specialty.name} ×`;
            chip.title = settings.locale === 'en' ? 'Remove specialty' : 'Quitar especialización'; chip.disabled = specialtiesBusy;
            chip.addEventListener('click', () => changeSpecialties(settings.specialties.filter(item => item.id !== specialty.id).map(item => item.name)));
            add.before(chip);
        });
        add.disabled = specialtiesBusy || settings.specialties.length >= 10;
        const upload = document.querySelector('.upload-box');
        if (settings.avatar_url) {
            const url = api.page(settings.avatar_url); upload.style.backgroundImage = `url("${url}")`; upload.dataset.hasPhoto = '';
        } else { upload.style.backgroundImage = ''; delete upload.dataset.hasPhoto; }
        document.querySelector('[data-photo-delete]').hidden = !settings.avatar_url;
    }

    function save(endpoint, fields, formData = null) {
        const job = saveQueue.then(async () => {
            if (!state) return false;
            try {
                let payload;
                if (formData) {
                    formData.set('version', String(state.settings.version));
                    payload = await api.request(endpoint, {method:'POST', body:formData});
                } else payload = await api.post(endpoint, {version:state.settings.version, ...fields});
                Object.entries(fields).forEach(([key, value]) => { if (dirty.get(key) === value) dirty.delete(key); });
                auth.settingsChanged(payload); return true;
            } catch (error) {
                api.report(error, 'settings');
                if (error.code === 'VERSION_CONFLICT') await auth.refresh();
                return false;
            }
        });
        saveQueue = job.catch(error => { api.report(error, 'settings'); return false; });
        return saveQueue;
    }

    for (const [id, field] of [['settings-name','full_name'], ['settings-email','email']]) {
        const input = byId(id);
        input.addEventListener('input', () => dirty.set(field, input.value));
        input.addEventListener('change', () => {
            if (!input.checkValidity()) return;
            save('settings/profile-update.php', {[field]:input.value});
        });
    }
    byId('settings-center').addEventListener('change', async event => {
        const value = event.target.value || null; dirty.set('default_facility_id', value);
        if (!await save('settings/profile-update.php', {default_facility_id:value})) { dirty.delete('default_facility_id'); render(state); }
    });
    byId('settings-language').addEventListener('change', async event => {
        const locale = event.target.value; dirty.set('locale', locale);
        if (!await save('settings/preferences-update.php', {locale})) { dirty.delete('locale'); render(state); }
    });
    document.querySelectorAll('[data-preference]').forEach(button => button.addEventListener('click', async () => {
        if (!state || button.disabled) return;
        const field = button.dataset.preference; const value = button.getAttribute('aria-checked') !== 'true';
        dirty.set(field, value); button.disabled = true;
        const success = await save('settings/preferences-update.php', {[field]:value});
        dirty.delete(field);
        if (success || state) render(state);
        button.disabled = false;
    }));
    document.querySelector('[data-theme-option="light"]').disabled = true;

    const passwordDialog=byId('password-dialog'),passwordForm=byId('password-form');
    document.querySelector('.reset-password').addEventListener('click',()=>{passwordForm.reset();passwordDialog.showModal();});
    passwordForm.addEventListener('submit',async event=>{
        event.preventDefault();if(passwordForm.dataset.busy)return;
        if(!passwordForm.checkValidity()){api.report(new api.ApiError('Completá la contraseña actual y una nueva de al menos 12 caracteres.',422,'VALIDATION_FAILED'),'password');return;}
        passwordForm.dataset.busy='true';[...passwordForm.elements].forEach(el=>el.disabled=true);
        try{const values=Object.fromEntries([...passwordForm.querySelectorAll('input')].map(el=>[el.name,el.value]));await api.post('auth/change-password.php',values);passwordForm.reset();location.assign(api.page('index.html'));}
        catch(error){api.report(error,'password');}
        finally{delete passwordForm.dataset.busy;[...passwordForm.elements].forEach(el=>el.disabled=false);}
    });
    passwordDialog.addEventListener('cancel',event=>{if(passwordForm.dataset.busy)event.preventDefault();});
    const specialtyDialog = byId('specialty-dialog');
    document.querySelector('.specialty-add').addEventListener('click', () => { specialtyDialog.showModal(); byId('specialty-name').focus(); });
    async function changeSpecialties(names) {
        if (specialtiesBusy) return false;
        specialtiesBusy = true; render(state);
        const success = await save('settings/profile-update.php', {specialties:names});
        specialtiesBusy = false; render(state); return success;
    }
    byId('specialty-form').addEventListener('submit', async event => {
        event.preventDefault(); if (!event.target.checkValidity() || specialtiesBusy || !state) return;
        const name = byId('specialty-name').value.trim();
        if (await changeSpecialties([...state.settings.specialties.map(item => item.name), name])) {
            byId('specialty-name').value = ''; specialtyDialog.close();
        }
    });

    const photoInput = byId('settings-photo');
    const upload = document.querySelector('.upload-box');
    upload.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', async () => {
        const photo = photoInput.files?.[0]; if (!photo || !state) return;
        if (photo.size > 5 * 1024 * 1024) { api.report(new Error('La foto supera 5 MiB.'), 'settings'); return; }
        upload.disabled = true;
        const data = new FormData(); data.set('photo', photo);
        if (await save('settings/photo.php', {}, data)) photoInput.value = '';
        upload.disabled = false;
    });
    document.querySelector('[data-photo-delete]').addEventListener('click', async event => {
        event.currentTarget.disabled = true;
        await save('settings/photo-delete.php', {});
        document.querySelector('[data-photo-delete]').disabled = false;
    });

    document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => {if(!button.closest('form')?.dataset.busy)button.closest('dialog').close();}));
    document.querySelector('.user-control').addEventListener('click', async () => {
        const dialog = byId('account-dialog'); dialog.showModal();
        const list = byId('security-notifications'); list.replaceChildren();
        try {
            const notifications = await api.get('settings/notifications.php');
            notifications.forEach(notification => {
                const item = document.createElement('li');
                const date = new Intl.DateTimeFormat(state.settings.locale, {dateStyle:'short',timeStyle:'short',timeZone:'America/Montevideo'}).format(new Date(notification.created_at));
                item.textContent = `${state.settings.locale === 'en' ? 'New sign-in' : 'Nuevo inicio de sesión'} · ${date}`; list.append(item);
            });
            if (notifications.length) await api.post('settings/notifications-read.php', {through_id:notifications[0].id});
        } catch (error) { api.report(error, 'notifications'); }
    });

    const inputs = document.querySelectorAll('#settings-name, #settings-email, #settings-center, #settings-language, [data-preference], .upload-box, .specialty-add, .user-control');
    inputs.forEach(input => { input.disabled = true; });
    window.addEventListener('hospital:session', event => render(event.detail));
    auth.ready.then(async payload => {
        if (!payload) return;
        inputs.forEach(input => { input.disabled = false; }); render(payload);
        const results = await Promise.allSettled([api.get('catalogs/facilities.php'), api.get('catalogs/specialties.php')]);
        if (results[0].status === 'fulfilled') { facilities = results[0].value; render(state); }
        else api.report(results[0].reason, 'catalogs');
        if (results[1].status === 'fulfilled') results[1].value.forEach(item => byId('specialty-options').append(new Option(item.name, item.name)));
        else api.report(results[1].reason, 'catalogs');
    }).catch(error => api.report(error, 'settings'));
});
