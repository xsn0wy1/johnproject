(() => {
    'use strict';

    // Saved surveys and totals come from SQL; no browser records are imported.
    let surveys = [];
    const surveyApi=window.HospitalSurveys, api=window.HospitalApi;
    let pendingDeleteSurvey=null, mutating=false, loadRevision=0;
    async function load(){const revision=++loadRevision;const rows=await surveyApi.directory($('survey-status').value==='archived');if(revision!==loadRevision)return;surveys=rows;render();}
    const rating=value=>value===null||value===undefined?'—':`${Number(value).toLocaleString('es-UY',{maximumFractionDigits:1})}/5`;
    const categories = {
        patient_care: { label: 'Atención al paciente', icon: 'hrate-icon.svg', color: 'violet' },
        transfers: { label: 'Traslados', icon: 'ambulance-icon.png', color: 'cyan' },
        emergency: { label: 'Emergencias', icon: 'medkit-icon.png', color: 'rose' },
        staff: { label: 'Personal', icon: 'people-svgrepo-com.svg', color: 'amber' },
        other: { label: 'Otras', icon: 'survey-icon.svg', color: 'violet' }
    };
    const audiences = { patients: 'Pacientes', staff: 'Personal', everyone: 'Pacientes y personal' };
    const statuses = { draft: 'BORRADOR', published: 'ACTIVA', closed: 'FINALIZADA', archived: 'ARCHIVADA' };
    const templates = window.HospitalSurveyTemplates;
    const $ = id => document.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const icon = name => `<img src="../../../assets/Icons/${name}" alt="">`;
    const tile = category => `<span class="survey-icon ${categories[category].color}">${icon(categories[category].icon)}</span>`;
    const collator = new Intl.Collator('es-UY', { sensitivity: 'base', numeric: true });
    const dateFormat = new Intl.DateTimeFormat('es-UY', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Montevideo' });
    const timeFormat = new Intl.DateTimeFormat('es-UY', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Montevideo' });
    let selectedId = null;
    let pendingDeleteId = null;
    let page = 1;
    let view = 'list';
    let renderedPageSize = null;

    function activity(date) {
        const today = dateFormat.format(new Date());
        return dateFormat.format(new Date(date)) === today ? `Hoy, ${timeFormat.format(new Date(date))}` : dateFormat.format(new Date(date));
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
        page = 1;
    }
    function renderStats() {
        $('stat-total').textContent = surveys.length;
        const drafts = surveys.filter(survey => survey.status === 'draft').length;
        $('stat-drafts').textContent = `${drafts} ${drafts === 1 ? 'borrador' : 'borradores'}`;
        $('stat-active').textContent = surveys.filter(survey => survey.accepting_responses).length;
        $('stat-responses').textContent = surveys.reduce((total, survey) => total + survey.response_count, 0).toLocaleString('es-UY');
        const rated=surveys.filter(s=>s.average_rating!==null&&s.rating_count>0), n=rated.reduce((sum,s)=>sum+s.rating_count,0);
        $('stat-satisfaction').textContent=n?rating(rated.reduce((sum,s)=>sum+s.average_rating*s.rating_count,0)/n):'—';
        $('stat-satisfaction').nextElementSibling.textContent=n?'Valoraciones normalizadas sobre 5':'Sin valoraciones todavía';
    }
    function renderPagination(total) {
        const pages = Math.ceil(total / pageSize());
        if (pages <= 1) { $('survey-pagination').innerHTML = ''; return; }
        const numbers = [...new Set([1, page - 1, page, page + 1, pages])].filter(number => number > 0 && number <= pages).sort((a, b) => a - b);
        let previous = 0;
        const buttons = numbers.map(number => {
            const gap = previous && number - previous > 1 ? '<span aria-hidden="true">…</span>' : '';
            previous = number;
            return `${gap}<button type="button" data-page="${number}" aria-label="Página ${number}" ${number === page ? 'aria-current="page"' : ''}>${number}</button>`;
        }).join('');
        $('survey-pagination').innerHTML = `<button type="button" data-page="${page - 1}" aria-label="Página anterior" ${page === 1 ? 'disabled' : ''}>‹</button>${buttons}<button type="button" data-page="${page + 1}" aria-label="Página siguiente" ${page === pages ? 'disabled' : ''}>›</button>`;
    }
    function renderDetail() {
        const survey = selected();
        $('detail-actions').hidden = !survey;
        document.querySelector('.survey-detail').classList.toggle('has-selection', Boolean(survey));
        $('edit-survey').hidden=Boolean(survey?.archived_at);
        $('delete-survey').setAttribute('aria-label',survey?.archived_at?'Restaurar encuesta':'Archivar encuesta');
        if (survey) $('edit-survey').href = `survey-new.html?id=${encodeURIComponent(survey.id)}`;
        $('survey-detail-content').scrollTop = 0;
        if (!survey) {
            $('survey-detail-content').innerHTML = `<div class="detail-placeholder"><span class="survey-icon violet">${icon('survey-icon.svg')}</span><h3>Seleccioná una encuesta</h3><p>Acá encontrarás sus preguntas, información y opciones de acceso.</p></div>`;
            return;
        }
        $('survey-detail-content').innerHTML = `
            <div class="detail-identity">${tile(survey.category)}<div><h3 title="${escape(survey.title)}">${escape(survey.title)}</h3><span class="survey-status ${survey.status}">${statuses[survey.status]}</span></div></div>
            <dl class="detail-meta"><div>${icon('calendar-icon.svg')}<dt>Creada</dt><dd>${escape(dateFormat.format(new Date(survey.created_at)))}</dd></div><div>${icon('layers-icon.svg')}<dt>Categoría</dt><dd>${categories[survey.category].label}</dd></div><div>${icon('person-icon.svg')}<dt>Dirigida a</dt><dd>${audiences[survey.audience]}</dd></div></dl>
            <div class="detail-numbers"><div><strong>${survey.response_count}</strong><small>respuestas</small></div><div><strong>${survey.questions.filter(q=>!['section','divider'].includes(q.type)).length}</strong><small>${survey.questions.filter(q=>!['section','divider'].includes(q.type)).length === 1 ? 'pregunta' : 'preguntas'}</small></div><div><strong>${rating(survey.average_rating)}</strong><small>valoración</small></div></div>
            <section class="patient-access"><h4>Acceso y resultados</h4><div class="share-controls"><button type="button" class="survey-button secondary" id="read-survey">${icon('eye.svg')}Ver formulario</button><button type="button" class="survey-button secondary" data-share-survey ${!survey.published_at||survey.archived_at?'disabled':''}>${icon('share-icon.svg')}Copiar enlace</button><button type="button" class="survey-button secondary" data-share-survey ${!survey.published_at||survey.archived_at?'disabled':''}>${icon('qr-icon.svg')}Código QR</button><a class="survey-button secondary" href="survey-view.html?id=${encodeURIComponent(survey.id)}">${icon('analytics-icon.svg')}Ver resultados</a>${survey.archived_at?'':`<button type="button" class="survey-button secondary" data-transition="${survey.lifecycle==='draft'?'publish':survey.lifecycle==='closed'?'reopen':'close'}">${survey.lifecycle==='draft'?'Publicar':survey.lifecycle==='closed'?'Reabrir':'Cerrar encuesta'}</button>`}</div></section>`;
        $('survey-detail-content').scrollTop = 0;
    }
    function render() {
        const filtered = filteredSurveys();
        page = Math.max(1, Math.min(page, Math.ceil(filtered.length / pageSize()) || 1));
        renderedPageSize = pageSize();
        const start = (page - 1) * renderedPageSize;
        const visible = filtered.slice(start, start + renderedPageSize);
        if (!visible.some(survey => survey.id === selectedId)) selectedId = visible[0]?.id ?? null;
        $('survey-count').textContent = filtered.length;
        $('survey-list').classList.toggle('is-grid', view === 'grid');
        $('survey-list').style.setProperty('--survey-page-rows', String(renderedPageSize));
        $('survey-list').style.setProperty('--survey-grid-rows', renderedPageSize === 2 ? '1' : '2');
        $('survey-list').hidden = !visible.length;
        $('survey-list-head').hidden = view === 'grid';
        $('survey-list').innerHTML = visible.map(survey => `<article class="survey-row ${survey.id === selectedId ? 'is-selected' : ''}" data-id="${survey.id}">
            <div class="survey-identity">${tile(survey.category)}<div><button type="button" class="survey-title-button" data-select="${survey.id}" aria-pressed="${survey.id === selectedId}" title="${escape(survey.title)}">${escape(survey.title)}</button><span class="survey-subtitle">${categories[survey.category].label} · ${survey.questions.filter(q=>!['section','divider'].includes(q.type)).length} ${survey.questions.filter(q=>!['section','divider'].includes(q.type)).length === 1 ? 'pregunta' : 'preguntas'}</span></div></div>
            <span class="survey-status ${survey.status}" aria-label="Estado: ${statuses[survey.status].toLowerCase()}">${statuses[survey.status]}</span>
            <span class="row-responses"><span class="visually-hidden">Respuestas: </span>${survey.response_count}<small>respuestas</small></span><span class="row-satisfaction"><span class="visually-hidden">Valoración: </span>${rating(survey.average_rating)}</span><time class="row-updated" datetime="${survey.updated_at}">${escape(activity(survey.updated_at))}</time>
            <details class="row-menu"><summary aria-label="Acciones de ${escape(survey.title)}">⋮</summary><div class="row-menu-content"><button type="button" data-edit="${survey.id}">Editar encuesta</button><button type="button" data-duplicate="${survey.id}">Duplicar borrador</button><button type="button" data-delete="${survey.id}">${survey.archived_at?'Restaurar encuesta':'Archivar encuesta'}</button></div></details></article>`).join('');
        $('survey-empty').hidden = !!visible.length;
        const hasFilter = $('survey-search').value.trim() || $('survey-status').value !== 'all' || $('survey-category').value !== 'all';
        $('empty-title').textContent = hasFilter ? 'No encontramos encuestas' : 'Creá tu primera encuesta';
        $('empty-description').textContent = hasFilter ? 'Probá con otra búsqueda o cambiá los filtros para encontrar tu encuesta.' : 'Conocé cómo viven la atención tus pacientes y cómo se siente tu equipo. Empezá desde cero o elegí una plantilla.';
        $('empty-actions').hidden = !!hasFilter;
        $('clear-filters').hidden = !hasFilter;
        $('results-summary').textContent = visible.length ? `Mostrando ${start + 1}–${start + visible.length} de ${filtered.length} ${filtered.length === 1 ? 'encuesta' : 'encuestas'}` : '0 encuestas';
        renderPagination(filtered.length);
        renderStats();
        renderDetail();
    }
    function openDelete(id) {
        const survey = surveys.find(item => item.id === id);
        if (!survey) return;
        pendingDeleteId = id;pendingDeleteSurvey={...survey};
        $('delete-title').textContent=survey.archived_at?'¿Restaurar esta encuesta?':'¿Archivar esta encuesta?';
        $('confirm-delete').textContent=survey.archived_at?'Restaurar':'Archivar';
        $('delete-description').textContent = survey.title;
        $('delete-dialog').showModal();
    }
    function readSurvey() {if(selected())location.assign(`survey-view.html?id=${selected().id}&tab=form`);}

    document.addEventListener('DOMContentLoaded', async () => {
        $('template-grid').innerHTML = templates.map(template => `<a class="template-card" href="survey-new.html?template=${encodeURIComponent(template.category)}">${tile(template.category)}<strong>${escape(template.title)}</strong><p>${escape(template.description)}</p><small>${template.questions.length} preguntas · ${audiences[template.audience]} <span aria-hidden="true">↗</span></small></a>`).join('');
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
        const filterControls = ['survey-status', 'survey-category', 'survey-sort'].map($);
        document.addEventListener('pointerdown', event => {
            const control = document.activeElement;
            if (filterControls.includes(control) && !control.closest('.survey-select').contains(event.target)) control.blur();
        }, true);
        filterControls.forEach(control => {
            let pointerSelection = false;
            control.addEventListener('pointerdown', () => {
                pointerSelection = true;
                control.dataset.pointerFocus = '';
            });
            control.addEventListener('keydown', event => {
                // Escape dismisses a pointer-opened menu without switching to keyboard focus.
                if (event.key === 'Escape') return;
                pointerSelection = false;
                delete control.dataset.pointerFocus;
            });
            control.addEventListener('blur', () => {
                pointerSelection = false;
                delete control.dataset.pointerFocus;
            });
            control.addEventListener('change', () => {
                page = 1;
                if(control.id==='survey-status')load().catch(error=>api.report(error,'surveys'));else render();
                // Pointer selections finish here; keyboard navigation keeps its focus.
                if (pointerSelection) control.blur();
            });
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
