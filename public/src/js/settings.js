document.addEventListener('DOMContentLoaded', async () => {
    'use strict';
    await window.HospitalI18n.ready;
    await window.HospitalAuth.ready;

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
    const centerNames = ['Hospital de Clinicas de Montevideo', 'Facultad de Medicina'];
    const centerSelect = byId('settings-center'), centerButton = byId('settings-center-button');
    const centerMenu = byId('settings-center-menu'), centerRoot = centerButton.parentElement;

    function closeCenter() {
        centerMenu.hidden = true; centerButton.setAttribute('aria-expanded', 'false');
    }
    function syncCenter() {
        window.HospitalI18n.bindText(byId('settings-center-label'), () => centerSelect.value ? centerSelect.selectedOptions[0]?.textContent : window.HospitalI18n.t('settings.selecciona_un_centro'));
        centerMenu.querySelectorAll('button').forEach(choice => choice.setAttribute('aria-pressed', String(choice.dataset.facilityId === centerSelect.value)));
        centerButton.disabled = !state || !facilities.length;
    }
    function openCenter() {
        if (centerButton.disabled) return;
        const trigger = centerButton.getBoundingClientRect(), panel = document.querySelector('.bg-panel').getBoundingClientRect();
        const below = Math.min(innerHeight - 12, panel.bottom - 12) - trigger.bottom - 7;
        const above = trigger.top - Math.max(12, panel.top + 12) - 7;
        const upwards = below < 100 && above > below;
        centerRoot.classList.toggle('opens-up', upwards);
        centerRoot.style.setProperty('--center-menu-height', `${Math.max(0, upwards ? above : below)}px`);
        centerMenu.hidden = false; centerButton.setAttribute('aria-expanded', 'true');
    }
    centerButton.addEventListener('click', () => { if (centerMenu.hidden) openCenter(); else closeCenter(); });
    centerButton.addEventListener('keydown', event => {
        if (['ArrowDown','ArrowUp'].includes(event.key)) {
            event.preventDefault(); openCenter();
            (centerMenu.querySelector('[aria-pressed="true"]') || (event.key === 'ArrowUp' ? centerMenu.lastElementChild : centerMenu.firstElementChild))?.focus();
        } else if (event.key === 'Escape') { event.preventDefault(); closeCenter(); }
    });
    centerMenu.addEventListener('click', event => {
        const choice = event.target.closest('button'); if (!choice) return;
        const changed = centerSelect.value !== choice.dataset.facilityId;
        centerSelect.value = choice.dataset.facilityId; syncCenter(); closeCenter(); centerButton.focus();
        if (changed) centerSelect.dispatchEvent(new Event('change', {bubbles:true}));
    });
    centerMenu.addEventListener('keydown', event => {
        if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
            event.preventDefault(); const choices = [...centerMenu.children], index = choices.indexOf(document.activeElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
            choices[next]?.focus();
        } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeCenter(); centerButton.focus(); }
    });
    document.addEventListener('click', event => { if (!centerRoot.contains(event.target)) closeCenter(); });
    document.addEventListener('focusin', event => { if (!centerRoot.contains(event.target)) closeCenter(); });
    window.addEventListener('resize', closeCenter);

    function openTab(selected) {
        closeCenter();
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
        const values = {full_name:user.full_name, email:user.email, default_facility_id:settings.default_facility_id || '', locale:window.HospitalI18n.locale};
        const controls = {full_name:'settings-name', email:'settings-email', default_facility_id:'settings-center', locale:'settings-language'};
        const select = byId('settings-center');
        const previous = select.value;
        select.replaceChildren(window.HospitalI18n.option(() => '', ''));
        facilities.forEach(facility => select.add(window.HospitalI18n.option(() => facility.name, facility.id)));
        if (settings.default_facility_id && !facilities.some(item => item.id === settings.default_facility_id)) {
            const old = window.HospitalI18n.option(() => settings.default_facility_name, settings.default_facility_id); old.disabled = true; select.add(old);
        }
        select.value = dirty.has('default_facility_id') ? previous : values.default_facility_id;
        Object.entries(controls).forEach(([field, id]) => { if (!dirty.has(field)) byId(id).value = values[field]; });
        syncCenter();
        document.querySelectorAll('[data-preference]').forEach(button => {
            if (dirty.has(button.dataset.preference)) return;
            const on = settings[button.dataset.preference]; button.classList.toggle('is-on', on); button.setAttribute('aria-checked', String(on));
        });
        document.querySelectorAll('[data-theme-option]').forEach(button => {
            const active = button.dataset.themeOption === window.HospitalTheme.current;
            button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
        });
        document.querySelector('.theme-switch').dataset.theme = window.HospitalTheme.current;
        document.querySelectorAll('.specialty-chip[data-specialty-id]').forEach(chip => chip.remove());
        const add = document.querySelector('.specialty-add');
        settings.specialties.forEach(specialty => {
            const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'specialty-chip';
            chip.dataset.specialtyId = specialty.id; window.HospitalI18n.bindText(chip, () => window.HospitalI18n.t("settings.value", {value0: specialty.name}));
            window.HospitalI18n.bindAttr(chip, "title", () => window.HospitalI18n.t("settings.quitar_especializacion")); chip.disabled = specialtiesBusy;
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
        const value = event.target.value || null; dirty.set('default_facility_id', value); syncCenter();
        if (!await save('settings/profile-update.php', {default_facility_id:value}) && dirty.get('default_facility_id') === value) { dirty.delete('default_facility_id'); render(state); }
    });
    byId('settings-language').addEventListener('change', async event => {
        const locale = event.target.value; const choice=window.HospitalI18n.preview(locale); dirty.set('locale', locale);
        if (!await save('settings/preferences-update.php', {locale})) { dirty.delete('locale'); render(state); }
        window.HospitalI18n.settle(choice);
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
    document.querySelectorAll('[data-theme-option]').forEach(button => button.addEventListener('click', async () => {
        if (!state || button.disabled || button.dataset.themeOption === window.HospitalTheme.current) return;
        const theme = button.dataset.themeOption;
        const choice = window.HospitalTheme.preview(theme);
        dirty.set('theme', theme); render(state);
        await save('settings/preferences-update.php', {theme});
        if (dirty.get('theme') === theme) dirty.delete('theme');
        window.HospitalTheme.settle(choice); render(state);
    }));

    document.querySelector('.reset-password').addEventListener('click', () => {
        const url = new URL(api.page('src/views/register-restore/restore-password.html'));
        if (window.HospitalI18n.locale === 'en') url.searchParams.set('lang', 'en');
        location.assign(url.href);
    });
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
        if (photo.size > 5 * 1024 * 1024) { api.report(new Error(window.HospitalI18n.t("settings.la_foto_supera_5_mib")), 'settings'); return; }
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
                const date = () => new Intl.DateTimeFormat(window.HospitalI18n.locale, {dateStyle:'short',timeStyle:'short',timeZone:'America/Montevideo'}).format(new Date(notification.created_at));
                window.HospitalI18n.bindText(item, () => `${window.HospitalI18n.t("settings.nuevo_inicio_de_sesion")} · ${date()}`); list.append(item);
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
        if (results[0].status === 'fulfilled') {
            // Restrict this preference to the two requested institutions; save real catalog IDs.
            const nameKey = name => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
            facilities = centerNames.flatMap(name => {
                const facility = results[0].value.find(item => nameKey(item.name.split(' · ')[0]) === nameKey(name));
                return facility ? [{...facility, name}] : [];
            });
            centerMenu.replaceChildren(...facilities.map(facility => {
                const choice = document.createElement('button'); choice.type = 'button'; choice.dataset.facilityId = facility.id;
                choice.textContent = facility.name; return choice;
            }));
            render(state);
        }
        else api.report(results[0].reason, 'catalogs');
        if (results[1].status === 'fulfilled') results[1].value.forEach(item => byId('specialty-options').append(window.HospitalI18n.option(() => item.name, item.name)));
        else api.report(results[1].reason, 'catalogs');
    }).catch(error => api.report(error, 'settings'));
});
