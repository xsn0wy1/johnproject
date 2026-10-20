(() => {
    'use strict';

    // Saved surveys and totals come from SQL; no browser records are imported.
    let surveys = [];
    const surveyApi=window.HospitalSurveys, api=window.HospitalApi;
    let pendingDeleteSurvey=null, mutating=false, loadRevision=0;
    async function load(){const revision=++loadRevision;const rows=await surveyApi.directory($('survey-status').value==='archived');if(revision!==loadRevision)return;surveys=rows;render();}
    const rating=value=>value===null||value===undefined?'—':`${Number(value).toLocaleString(window.HospitalI18n.locale,{maximumFractionDigits:1})}/5`;
    const categories = {
        get patient_care() { return { get label() { return window.HospitalI18n.t("survey.atencion_al_paciente"); }, icon: 'hrate-icon.svg', color: 'violet' }; },
        get transfers() { return { get label() { return window.HospitalI18n.t("survey.traslados"); }, icon: 'ambulance-icon.png', color: 'cyan' }; },
        get emergency() { return { get label() { return window.HospitalI18n.t("survey.emergencias"); }, icon: 'medkit-icon.png', color: 'rose' }; },
        get staff() { return { get label() { return window.HospitalI18n.t("trace_view.personal"); }, icon: 'people-svgrepo-com.svg', color: 'amber' }; },
        get other() { return { get label() { return window.HospitalI18n.t("survey.otras"); }, icon: 'survey-icon.svg', color: 'violet' }; }
    };
    const audiences = { get patients() { return window.HospitalI18n.t("management.pacientes"); }, get staff() { return window.HospitalI18n.t("trace_view.personal"); }, get everyone() { return window.HospitalI18n.t("survey_new.pacientes_y_personal"); } };
    const statuses = { get draft() { return window.HospitalI18n.t("shared.borrador"); }, get published() { return window.HospitalI18n.t("shared.activa"); }, get closed() { return window.HospitalI18n.t("shared.finalizada"); }, get archived() { return window.HospitalI18n.t("shared.archivada"); } };
    let templates = [];
    const $ = id => document.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const icon = name => `<img src="../../../assets/Icons/${name}" alt="">`;
    const tile = category => `<span class="survey-icon ${categories[category].color}">${icon(categories[category].icon)}</span>`;
    const collator = { compare: (...args) => new Intl.Collator(window.HospitalI18n.locale, { sensitivity: 'base', numeric: true }).compare(...args) };
    const dateFormat = { format: (...args) => new Intl.DateTimeFormat(window.HospitalI18n.locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Montevideo' }).format(...args) };
    const timeFormat = { format: (...args) => new Intl.DateTimeFormat(window.HospitalI18n.locale, { hour: '2-digit', minute: '2-digit', timeZone: 'America/Montevideo' }).format(...args) };
    let selectedId = null;
    let pendingDeleteId = null;
    let page = 1;
    let view = 'list';
    let renderedPageSize = null;
    const filterDropdowns = [];

    function syncFilterDropdowns() {
        filterDropdowns.forEach(({control,button,label,options}) => {
            window.HospitalI18n.bindText(label, () => window.HospitalI18n.t(control.selectedOptions[0].dataset.i18n));
            button.classList.toggle('is-filtered', control.value !== control.options[0].value);
            options.forEach(option => option.setAttribute('aria-pressed', String(option.dataset.filterValue === control.value)));
        });
    }
    function closeFilterDropdown(dropdown) {
        dropdown.menu.hidden = true;
        dropdown.button.setAttribute('aria-expanded', 'false');
    }
    function setupFilterDropdown(control) {
        const button = $(control.id + '-button'), menu = $(control.id + '-menu'), label = $(control.id + '-label');
        // Keep existing option codes/labels as the source for filtering and sorting.
        const options = [...control.options].map(option => {
            const choice = document.createElement('button');
            choice.type = 'button'; choice.dataset.filterValue = option.value;
            choice.dataset.i18n = option.dataset.i18n; choice.textContent = option.textContent;
            menu.append(choice); return choice;
        });
        const dropdown = {control,button,menu,label,options,root:button.parentElement};
        filterDropdowns.push(dropdown);
        function open() {
            filterDropdowns.forEach(closeFilterDropdown);
            menu.hidden = false; button.setAttribute('aria-expanded', 'true');
        }
        button.addEventListener('click', () => { if (menu.hidden) open(); else closeFilterDropdown(dropdown); });
        button.addEventListener('keydown', event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault(); open();
                (event.key === 'ArrowUp' ? options[options.length - 1] : options.find(option => option.dataset.filterValue === control.value)).focus();
            } else if (event.key === 'Escape') { event.preventDefault(); closeFilterDropdown(dropdown); }
        });
        menu.addEventListener('click', event => {
            const choice = event.target.closest('[data-filter-value]'); if (!choice) return;
            const changed = control.value !== choice.dataset.filterValue;
            control.value = choice.dataset.filterValue; closeFilterDropdown(dropdown);
            if (changed) control.dispatchEvent(new Event('change', {bubbles:true})); button.focus();
        });
        menu.addEventListener('keydown', event => {
            if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
                event.preventDefault(); const index = options.indexOf(document.activeElement);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
                options[next].focus();
            } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeFilterDropdown(dropdown); button.focus(); }
        });
        control.addEventListener('change', () => {
            syncFilterDropdowns(); page = 1;
            if (control.id === 'survey-status') load().catch(error => api.report(error,'surveys')); else render();
        });
    }

    function activity(date) {
        const today = dateFormat.format(new Date());
        return dateFormat.format(new Date(date)) === today ? window.HospitalI18n.t("survey.hoy_value", {value0: timeFormat.format(new Date(date))}) : dateFormat.format(new Date(date));
    }
    function selected() { return surveys.find(survey => survey.id === selectedId); }
    function questionOptions(question) { return Array.isArray(question.options)?question.options:String(question.options||'').split('\n').filter(Boolean); }
    function pageSize() {
        if (!window.matchMedia('(min-width: 771px)').matches) return view === 'grid' ? 4 : 6;
        const directory = document.querySelector('.survey-directory');
        const heading = directory.querySelector('.directory-heading').getBoundingClientRect().height;
        const footer = Math.max(46, directory.querySelector('.survey-footer').getBoundingClientRect().height);
        const columns = view === 'list' ? ($('survey-list-head').getBoundingClientRect().height || 32) : 0;
        const available = directory.clientHeight - heading - footer - columns - 10;
        return view === 'grid' ? (available < 300 ? 2 : 4) : Math.max(1, Math.min(6, Math.floor((available + 4) / 48)));
    }
    function filteredSurveys() {
        const search = normalize($('survey-search').value.trim());
        const status = $('survey-status').value;
        const category = $('survey-category').value;
        return surveys.filter(survey => (status === 'all' || survey.status === status) &&
            (category === 'all' || survey.category === category) &&
            normalize(`${survey.title} ${survey.description} ${categories[survey.category].label}`).includes(search))
            .sort((a, b) => {
                if ($('survey-sort').value === 'name') return collator.compare(a.title, b.title) || b.id - a.id;
                if ($('survey-sort').value === 'responses') return b.response_count - a.response_count || b.id - a.id;
                const difference = a.updated_at.localeCompare(b.updated_at) || a.id - b.id;
                return $('survey-sort').value === 'oldest' ? difference : -difference;
            });
    }
    function resetFilters() {
        $('survey-search').value = '';
        $('survey-status').value = 'all';
        $('survey-category').value = 'all';
        filterDropdowns.forEach(closeFilterDropdown); syncFilterDropdowns();
        page = 1;
    }
    function renderStats() {
        window.HospitalI18n.bindText($('stat-total'), () => surveys.length);
        const drafts = surveys.filter(survey => survey.status === 'draft').length;
        window.HospitalI18n.bindText($('stat-drafts'), () => `${drafts} ${drafts === 1 ? window.HospitalI18n.t("shared.borrador_2") : window.HospitalI18n.t("shared.borradores")}`);
        window.HospitalI18n.bindText($('stat-active'), () => surveys.filter(survey => survey.accepting_responses).length);
        window.HospitalI18n.bindText($('stat-responses'), () => surveys.reduce((total, survey) => total + survey.response_count, 0).toLocaleString(window.HospitalI18n.locale));
        const rated=surveys.filter(s=>s.average_rating!==null&&s.rating_count>0), n=rated.reduce((sum,s)=>sum+s.rating_count,0);
        window.HospitalI18n.bindText($('stat-satisfaction'), () => n?rating(rated.reduce((sum,s)=>sum+s.average_rating*s.rating_count,0)/n):'—');
        window.HospitalI18n.bindText($('stat-satisfaction').nextElementSibling, () => n?window.HospitalI18n.t("survey.valoraciones_normalizadas_sobre_5"):window.HospitalI18n.t("survey.sin_valoraciones_todavia"));
    }
    function renderPagination(total) {
        const pages = Math.ceil(total / pageSize());
        if (pages <= 1) { window.HospitalI18n.setHTML($('survey-pagination'), ''); return; }
        const numbers = [...new Set([1, page - 1, page, page + 1, pages])].filter(number => number > 0 && number <= pages).sort((a, b) => a - b);
        let previous = 0;
        const buttons = numbers.map(number => {
            const gap = previous && number - previous > 1 ? '<span aria-hidden="true">…</span>' : '';
            previous = number;
            return `${gap}<button type="button" data-page="${number}" aria-label="${window.HospitalI18n.html("ambulances.pagina_value", {value0: number})}" data-i18n-aria-label="ambulances.pagina_value" data-i18n-aria-label-params="${window.HospitalI18n.escape(JSON.stringify({value0: number}))}" ${number === page ? 'aria-current="page"' : ''}>${number}</button>`;
        }).join('');
        window.HospitalI18n.setHTML($('survey-pagination'), `<button type="button" data-page="${page - 1}" aria-label="${window.HospitalI18n.html("trace.pagina_anterior")}" data-i18n-aria-label="trace.pagina_anterior" ${page === 1 ? 'disabled' : ''}>‹</button>${buttons}<button type="button" data-page="${page + 1}" aria-label="${window.HospitalI18n.html("trace.pagina_siguiente")}" data-i18n-aria-label="trace.pagina_siguiente" ${page === pages ? 'disabled' : ''}>›</button>`);
    }
    function renderDetail() {
        const survey = selected();
        $('detail-actions').hidden = !survey;
        document.querySelector('.survey-detail').classList.toggle('has-selection', Boolean(survey));
        $('edit-survey').hidden=Boolean(survey?.archived_at);
        window.HospitalI18n.bindAttr($('delete-survey'), "aria-label", () => survey?.archived_at?window.HospitalI18n.t("survey.restaurar_encuesta"):window.HospitalI18n.t("survey.archivar_encuesta"));
        if (survey) $('edit-survey').href = `survey-new.html?id=${encodeURIComponent(survey.id)}`;
        $('survey-detail-content').scrollTop = 0;
        if (!survey) {
            window.HospitalI18n.setHTML($('survey-detail-content'), `<div class="detail-placeholder"><span class="survey-icon violet">${icon('survey-icon.svg')}</span><h3>${window.HospitalI18n.mark("survey_view.selecciona_una_encuesta")}</h3><p>${window.HospitalI18n.mark("survey.aca_encontraras_sus_preguntas_informacion_y_opciones_de_acceso")}</p></div>`);
            return;
        }
        window.HospitalI18n.setHTML($('survey-detail-content'), `
            <div class="detail-identity">${tile(survey.category)}<div><h3 title="${escape(survey.title)}">${escape(survey.title)}</h3><span class="survey-status ${survey.status}">${statuses[survey.status]}</span></div></div>
            <dl class="detail-meta"><div>${icon('calendar-icon.svg')}<dt>${window.HospitalI18n.mark("survey.creada")}</dt><dd>${escape(dateFormat.format(new Date(survey.created_at)))}</dd></div><div>${icon('layers-icon.svg')}<dt>${window.HospitalI18n.mark("survey.categoria")}</dt><dd>${categories[survey.category].label}</dd></div><div>${icon('person-icon.svg')}<dt>${window.HospitalI18n.mark("survey_new.dirigida_a")}</dt><dd>${audiences[survey.audience]}</dd></div></dl>
            <div class="detail-numbers"><div><strong>${survey.response_count}</strong><small>${window.HospitalI18n.mark("survey.respuestas")}</small></div><div><strong>${survey.questions.filter(q=>!['section','divider'].includes(q.type)).length}</strong><small>${survey.questions.filter(q=>!['section','divider'].includes(q.type)).length === 1 ? window.HospitalI18n.t("survey.pregunta") : window.HospitalI18n.t("survey_new.preguntas")}</small></div><div><strong>${rating(survey.average_rating)}</strong><small>${window.HospitalI18n.mark("survey.valoracion_2")}</small></div></div>
            <section class="patient-access"><h4>${window.HospitalI18n.mark("survey.acceso_y_resultados")}</h4><div class="share-controls"><button type="button" class="survey-button secondary" id="read-survey">${icon('eye.svg')}${window.HospitalI18n.mark("survey_view.ver_formulario")}</button><button type="button" class="survey-button secondary" data-share-survey ${!survey.published_at||survey.archived_at?'disabled':''}>${icon('share-icon.svg')}${window.HospitalI18n.mark("survey_view.copiar_enlace")}</button><button type="button" class="survey-button secondary" data-share-survey ${!survey.published_at||survey.archived_at?'disabled':''}>${icon('qr-icon.svg')}${window.HospitalI18n.mark("survey_view.codigo_qr")}</button><a class="survey-button secondary" href="survey-view.html?id=${encodeURIComponent(survey.id)}">${icon('analytics-icon.svg')}${window.HospitalI18n.mark("survey.ver_resultados")}</a>${survey.archived_at?'':`<button type="button" class="survey-button secondary" data-transition="${survey.lifecycle==='draft'?'publish':survey.lifecycle==='closed'?'reopen':'close'}">${survey.lifecycle==='draft'?window.HospitalI18n.t("survey_view.publicar"):survey.lifecycle==='closed'?window.HospitalI18n.t("survey_view.reabrir"):window.HospitalI18n.t("survey_view.cerrar_encuesta")}</button>`}</div></section>`);
        $('survey-detail-content').scrollTop = 0;
    }
    function render() {
        syncFilterDropdowns();
        const filtered = filteredSurveys();
        page = Math.max(1, Math.min(page, Math.ceil(filtered.length / pageSize()) || 1));
        renderedPageSize = pageSize();
        const start = (page - 1) * renderedPageSize;
        const visible = filtered.slice(start, start + renderedPageSize);
        if (!visible.some(survey => survey.id === selectedId)) selectedId = visible[0]?.id ?? null;
        window.HospitalI18n.bindText($('survey-count'), () => filtered.length);
        $('survey-list').classList.toggle('is-grid', view === 'grid');
        $('survey-list').style.setProperty('--survey-page-rows', String(renderedPageSize));
        $('survey-list').style.setProperty('--survey-grid-rows', renderedPageSize === 2 ? '1' : '2');
        $('survey-list').hidden = !visible.length;
        $('survey-list-head').hidden = view === 'grid';
        window.HospitalI18n.setHTML($('survey-list'), visible.map(survey => `<article class="survey-row ${survey.id === selectedId ? 'is-selected' : ''}" data-id="${survey.id}">
            <div class="survey-identity">${tile(survey.category)}<div><button type="button" class="survey-title-button" data-select="${survey.id}" aria-pressed="${survey.id === selectedId}" title="${escape(survey.title)}">${escape(survey.title)}</button><span class="survey-subtitle">${categories[survey.category].label} · ${survey.questions.filter(q=>!['section','divider'].includes(q.type)).length} ${survey.questions.filter(q=>!['section','divider'].includes(q.type)).length === 1 ? window.HospitalI18n.t("survey.pregunta") : window.HospitalI18n.t("survey_new.preguntas")}</span></div></div>
            <span class="survey-status ${survey.status}" aria-label="${window.HospitalI18n.html("survey.estado_value", {value0: statuses[survey.status].toLowerCase()})}" data-i18n-aria-label="survey.estado_value" data-i18n-aria-label-params="${window.HospitalI18n.escape(JSON.stringify({value0: statuses[survey.status].toLowerCase()}))}">${statuses[survey.status]}</span>
            <span class="row-responses"><span class="visually-hidden">${window.HospitalI18n.mark("survey.respuestas_2")} </span>${survey.response_count}<small>${window.HospitalI18n.mark("survey.respuestas")}</small></span><span class="row-satisfaction" data-i18n-caption="survey.satisfaction_caption"><span class="visually-hidden">${window.HospitalI18n.mark("survey.valoracion_3")} </span>${rating(survey.average_rating)}</span><time class="row-updated" datetime="${survey.updated_at}">${escape(activity(survey.updated_at))}</time>
            <details class="row-menu"><summary aria-label="${window.HospitalI18n.html("survey.acciones_de_value", {value0: survey.title})}" data-i18n-aria-label="survey.acciones_de_value" data-i18n-aria-label-params="${window.HospitalI18n.escape(JSON.stringify({value0: survey.title}))}">⋮</summary><div class="row-menu-content"><button type="button" data-edit="${survey.id}">${window.HospitalI18n.mark("survey_view.editar_encuesta")}</button><button type="button" data-duplicate="${survey.id}">${window.HospitalI18n.mark("survey.duplicar_borrador")}</button><button type="button" data-delete="${survey.id}">${survey.archived_at?window.HospitalI18n.t("survey.restaurar_encuesta"):window.HospitalI18n.t("survey.archivar_encuesta")}</button></div></details></article>`).join(''));
        $('survey-empty').hidden = !!visible.length;
        const hasFilter = $('survey-search').value.trim() || $('survey-status').value !== 'all' || $('survey-category').value !== 'all';
        window.HospitalI18n.bindText($('empty-title'), () => hasFilter ? window.HospitalI18n.t("survey.no_encontramos_encuestas") : window.HospitalI18n.t("survey.crea_tu_primera_encuesta"));
        window.HospitalI18n.bindText($('empty-description'), () => hasFilter ? window.HospitalI18n.t("survey.proba_con_otra_busqueda_o_cambia_los_filtros_para_encontrar_tu_encuesta") : window.HospitalI18n.t("survey.conoce_como_viven_la_atencion_tus_pacientes_y_como_se_siente_tu_equipo_empeza_desde_cero_o"));
        $('empty-actions').hidden = !!hasFilter;
        $('clear-filters').hidden = !hasFilter;
        window.HospitalI18n.bindText($('results-summary'), () => visible.length ? window.HospitalI18n.t("survey.mostrando_value_value_de_value_value", {value0: start + 1, value1: start + visible.length, value2: filtered.length, value3: filtered.length === 1 ? window.HospitalI18n.t("survey.encuesta_2") : window.HospitalI18n.t("survey.encuestas")}) : window.HospitalI18n.t("survey.0_encuestas"));
        renderPagination(filtered.length);
        renderStats();
        renderDetail();
    }
    function openDelete(id) {
        const survey = surveys.find(item => item.id === id);
        if (!survey) return;
        pendingDeleteId = id;pendingDeleteSurvey={...survey};
        window.HospitalI18n.bindText($('delete-title'), () => survey.archived_at?window.HospitalI18n.t("survey.restaurar_esta_encuesta"):window.HospitalI18n.t("survey.archivar_esta_encuesta"));
        window.HospitalI18n.bindText($('confirm-delete'), () => survey.archived_at?window.HospitalI18n.t("personnel.restaurar"):window.HospitalI18n.t("patients.archivar"));
        window.HospitalI18n.bindText($('delete-description'), () => survey.title);
        $('delete-dialog').showModal();
    }
    function readSurvey() {if(selected())location.assign(`survey-view.html?id=${selected().id}&tab=form`);}

    function renderTemplates(){window.HospitalI18n.setHTML($('template-grid'), templates.map(template => `<a class="template-card" href="survey-new.html?template=${encodeURIComponent(template.category)}">${tile(template.category)}<strong>${escape(template.title)}</strong><p>${escape(template.description)}</p><small>${window.HospitalI18n.mark("survey.value_preguntas_value", {value0: template.questions.length, value1: audiences[template.audience]})} <span aria-hidden="true">↗</span></small></a>`).join(''));}

    document.addEventListener('DOMContentLoaded', async () => {
    await window.HospitalI18n.ready;
    await window.HospitalAuth.ready;
    window.addEventListener('hospital:localechange',()=>{templates=window.HospitalSurveyTemplates;renderTemplates();render();});

        templates=window.HospitalSurveyTemplates;renderTemplates();
        document.querySelectorAll('[data-open-templates]').forEach(button => button.addEventListener('click', () => $('templates-dialog').showModal()));
        document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
        $('survey-list').addEventListener('click', event => {
            const row = event.target.closest('[data-id]');
            if (!row) return;
            const id = row.dataset.id;
            if (event.target.closest('[data-edit]')) location.href = `survey-new.html?id=${encodeURIComponent(id)}`;
            else if (event.target.closest('[data-delete]')) openDelete(id);
            else if (event.target.closest('[data-duplicate]')) {
                location.href = `survey-new.html?copy_id=${encodeURIComponent(id)}`;
            } else if (!event.target.closest('.row-menu')) {
                selectedId = id;
                // Keep the clicked control in the DOM so keyboard focus is preserved.
                $('survey-list').querySelectorAll('[data-id]').forEach(item => {
                    const active = item.dataset.id === id;
                    item.classList.toggle('is-selected', active);
                    item.querySelector('[data-select]').setAttribute('aria-pressed', String(active));
                });
                renderDetail();
            }
            if (event.target.closest('.row-menu-content')) row.querySelector('details').open = false;
        });
        document.addEventListener('click', event => {
            document.querySelectorAll('.row-menu[open]').forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') document.querySelectorAll('.row-menu[open]').forEach(menu => { menu.open = false; menu.querySelector('summary').focus(); });
        });
        $('survey-detail-content').addEventListener('click', async event => {
            if(event.target.closest('#read-survey'))readSurvey();
            const current=selected();if(!current||mutating)return;
            try{
                if(event.target.closest('[data-share-survey]'))await surveyApi.share(current,()=>load().catch(error=>api.report(error,'surveys')));
                const button=event.target.closest('[data-transition]');
                if(button){mutating=true;button.disabled=true;await surveyApi.transition(current,button.dataset.transition);await load();}
            }catch(error){api.report(error,'surveys');}finally{mutating=false;}
        });
        $('delete-survey').addEventListener('click', () => { if (selected()) openDelete(selectedId); });
        $('confirm-delete').addEventListener('click', async () => {
            if(mutating||!pendingDeleteSurvey)return;mutating=true;const record=pendingDeleteSurvey;$('delete-dialog').inert=true;
            try{await surveyApi.transition(record,record.archived_at?'restore':'archive');$('delete-dialog').close();await load();}
            catch(error){api.report(error,'surveys');}finally{mutating=false;$('delete-dialog').inert=false;}
        });
        $('delete-dialog').addEventListener('close', () => { pendingDeleteId = null; });
        $('survey-search').addEventListener('input', () => { page = 1; render(); });
        ['survey-status', 'survey-category', 'survey-sort'].map($).forEach(setupFilterDropdown);
        syncFilterDropdowns();
        for (const eventName of ['click','focusin']) document.addEventListener(eventName, event => {
            filterDropdowns.forEach(dropdown => { if (!dropdown.root.contains(event.target)) closeFilterDropdown(dropdown); });
        });
        $('clear-filters').addEventListener('click', () => { resetFilters(); load().catch(error=>api.report(error,'surveys')); $('survey-search').focus(); });
        document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
            view = button.dataset.view;
            page = 1;
            document.querySelectorAll('[data-view]').forEach(control => { control.classList.toggle('is-active', control === button); control.setAttribute('aria-pressed', String(control === button)); });
            render();
        }));
        $('survey-pagination').addEventListener('click', event => {
            const button = event.target.closest('[data-page]');
            if (!button || button.disabled) return;
            page = Number(button.dataset.page);
            render();
            $('survey-list').scrollTop = 0;
            $('survey-pagination').querySelector('[aria-current]')?.focus();
        });
        try{if(await window.HospitalAuth.ready)await load();}catch(error){api.report(error,'surveys');}
        new ResizeObserver(() => {
            if (window.matchMedia('(min-width: 771px)').matches && pageSize() !== renderedPageSize) render();
        }).observe(document.querySelector('.survey-directory'));
    });
})();
