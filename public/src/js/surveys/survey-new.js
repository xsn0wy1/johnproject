(() => {
    'use strict';

    // SQL owns saved records; local designer state preserves unsaved input on failures.
    const types = {
        short_text: { label: 'Respuesta corta', symbol: 'T', class: 'text-symbol' },
        long_text: { label: 'Respuesta larga', symbol: '¶', class: 'text-symbol' },
        single_choice: { label: 'Opción múltiple', icon: 'multiple-choice.svg' },
        multiple_choice: { label: 'Casillas', icon: 'cages-icon.svg' },
        linear_scale: { label: 'Escala', icon: 'analytics-icon.svg' },
        rating: { label: 'Calificación', icon: 'star-icon.svg' },
        date: { label: 'Fecha', icon: 'calendar-icon.svg' },
        section: { label: 'Título y texto', symbol: 'A', class: 'text-symbol', element: true },
        divider: { label: 'Separador', symbol: '―', element: true }
    };
    const categoryLabels = { patient_care: 'Atención al paciente', transfers: 'Traslados', emergency: 'Emergencias', staff: 'Personal', other: 'Otras' };
    const audienceLabels = { patients: 'Pacientes', staff: 'Personal', everyone: 'Pacientes y personal' };
    const colors = { blue: ['Azul', '#5962c4'], green: ['Verde', '#368267'], cyan: ['Celeste', '#378c9f'], amber: ['Ámbar', '#ac7d34'], rose: ['Rosa', '#a2536e'], slate: ['Gris', '#52637f'] };
    const state = {
        step: 1, designed: false, nextId: 1, selectedId: null, questionPage: 1, optionPage: 1, color: 'blue', items: [],
        info: { title: '', description: '', category: 'patient_care', area: '', notes: '' },
        form: { title: '', introduction: '' },
        config: { audience: 'patients', access: 'shared_link', identity: 'anonymous', limit_enabled: false, response_limit: '100', opens_enabled: false, opens_at: '', closes_enabled: false, closes_at: '', completion_message: 'Gracias por tu tiempo. Tu opinión nos ayuda a mejorar.' }
    };
    const $ = id => document.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const icon = name => `<img src="../../../assets/Icons/${name}" alt="">`;
    const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const symbol = type => `<span class="type-symbol ${types[type].class || ''}" aria-hidden="true">${types[type].icon ? icon(types[type].icon) : (types[type].symbol || '')}</span>`;
    const selected = () => state.items.find(item => item.id === state.selectedId);
    const questions = () => state.items.filter(item => !types[item.type].element);
    const choiceType = type => ['single_choice', 'multiple_choice'].includes(type);
    let renderedPageSize = null, saved = null, loaded = false, busy = false;
    const api = window.HospitalApi, surveysApi = window.HospitalSurveys;
    function applyLock() {
        const locked = Boolean(saved?.published_at);
        document.querySelectorAll('[data-screen="2"] input, [data-screen="2"] textarea, [data-screen="2"] select, [data-add-type], [data-item-action], [data-move-item], [data-remove-option], [data-color], #add-option, #add-default-question').forEach(el => { if (locked) el.disabled = true; });
        ['answer-audience','answer-access','answer-identity'].forEach(id => { $(id).disabled = locked; });
        $('save-survey').disabled = !loaded || busy || Boolean(saved?.archived_at);
        $('save-survey').lastChild.textContent = locked ? 'Guardar cambios' : 'Guardar borrador';
        $('publish-survey').disabled = !loaded || busy || locked;
        $('publish-survey').title = locked ? 'Duplicá la encuesta para cambiar sus preguntas publicadas.' : '';
        document.querySelector('.draft-tag').textContent = saved?.archived_at ? 'Archivada' : locked ? 'Publicada' : 'Borrador';
    }
    function hydrate(record, copy = false) {
        saved = copy ? null : record;
        const owner=document.querySelector('.owner-card [data-current-user-name]');
        if(owner&&!copy){owner.removeAttribute('data-current-user-name');owner.textContent=record.owner_name;}
        state.info = {title:record.title,description:record.description,category:record.category,area:record.area,notes:record.notes};
        if (copy) state.info.title = `${record.title.slice(0,112)} · Copia`;
        state.form = {title:record.form_title,introduction:record.form_description};state.config={...record.config};state.color=record.color;
        state.items=record.questions.map(item=>({...item,options:[...item.options]}));
        state.nextId=1;while(state.items.some(item=>item.id===`question-${state.nextId}`))state.nextId++;
        state.selectedId=state.items[0]?.id||null;state.designed=true;
    }
    function syncFields() {
        document.querySelectorAll('[data-info]').forEach(field=>field.value=state.info[field.dataset.info]);
        document.querySelectorAll('[data-config]').forEach(field=>{if(field.type==='checkbox')field.checked=state.config[field.dataset.config];else field.value=state.config[field.dataset.config];});
        $('response-limit').disabled=!state.config.limit_enabled;$('opens-at').disabled=!state.config.opens_enabled;$('closes-at').disabled=!state.config.closes_enabled;
        document.querySelector('.form-canvas').dataset.formColor=state.color;
        $('form-colors').querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.color===state.color)));
    }
    async function save(publish=false) {
        if(!loaded||busy)return;busy=true;document.querySelector('.survey-builder').inert=true;applyLock();
        try {
            const body={...state.info,form_title:state.form.title,form_description:state.form.introduction,color:state.color,config:{...state.config},items:state.items};
            const record=await api.post(saved?'surveys/update.php':'surveys/create.php',saved?{...body,id:saved.id,version:saved.version}:body);
            hydrate(record);history.replaceState(null,'',`survey-new.html?id=${record.id}`);
            if(publish){const published=await surveysApi.transition(record,'publish');location.assign(`survey-view.html?id=${published.id}`);return;}
            syncFields();goStep(state.step);$('step-progress').textContent='Cambios guardados.';
        } catch(error) {api.report(error,'surveys');}
        finally{busy=false;document.querySelector('.survey-builder').inert=false;applyLock();}
    }

    function makeItem(type) {
        while(state.items.some(item=>item.id===`question-${state.nextId}`))state.nextId++;
        return { id: `question-${state.nextId++}`, type, title: '', required: !types[type].element, options: ['Opción 1', 'Opción 2'], other: false, description: '', placeholder: '', scale_min: 1, scale_max: 5, scale_start: 'Nada claro', scale_end: 'Muy claro', rating_max: 5 };
    }
    function questionPageSize() {
        if (!window.matchMedia('(min-width: 901px)').matches) return 3;
        const panel = document.querySelector('.questions-panel');
        const available = panel.clientHeight - document.querySelector('.questions-heading').offsetHeight - Math.max(44, document.querySelector('.questions-footer').offsetHeight) - 16;
        const target = innerHeight <= 850 ? 90 : 104;
        return Math.max(1, Math.min(5, Math.floor((available + 6) / (target + 6))));
    }
    function optionPageSize() { return innerHeight <= 950 ? 2 : 3; }
    function questionNumber(item) {
        if (types[item.type].element) return '—';
        return questions().findIndex(question => question.id === item.id) + 1;
    }
    function itemTitle(item) { return item.title.trim() || (item.type === 'section' ? 'Sección sin título' : item.type === 'divider' ? 'Separador' : 'Pregunta sin título'); }
    function renderPalette() {
        const search = normalize($('type-search').value.trim());
        const markup = element => Object.entries(types).filter(([key, type]) => Boolean(type.element) === element && normalize(type.label).includes(search)).map(([key, type]) => `<button type="button" class="question-type-button" data-add-type="${key}" ${state.items.length >= 20 ? 'disabled' : ''}>${symbol(key)}<span>${type.label}</span>${icon('plus-icon.svg')}</button>`).join('');
        $('question-types').innerHTML = markup(false);
        $('form-elements').innerHTML = markup(true);
        $('palette-no-match').hidden = Boolean($('question-types').children.length + $('form-elements').children.length);
        document.querySelector('.palette-section-heading').hidden = !$('form-elements').children.length;
    }
    function responseShape(item) {
        if (item.type === 'rating') return `<span class="rating-stars ${item.rating_max === 10 ? 'rating-stars-ten' : ''}">${'☆'.repeat(item.rating_max)}</span>`;
        if (choiceType(item.type)) return `<div class="response-options">${item.options.slice(0, 3).map(option => `<span class="response-option ${item.type === 'multiple_choice' ? 'multiple' : ''}"><i></i><span>${escape(option || 'Opción')}</span></span>`).join('')}${item.options.length > 3 ? `<span>+${item.options.length - 3}</span>` : ''}</div>`;
        if (item.type === 'linear_scale') {
            const range = Array.from({ length: item.scale_max - item.scale_min + 1 }, (_, index) => item.scale_min + index);
            return `<div class="scale-stub">${range.map(number => `<span>${number}</span>`).join('')}</div>`;
        }
        if (item.type === 'divider') return '<span class="element-divider"></span>';
        if (item.type === 'section') return `<span class="section-stub">${escape(item.description || 'Descripción de la sección')}</span>`;
        return `<span class="response-stub ${item.type === 'long_text' ? 'long' : ''}">${escape(item.placeholder || (item.type === 'date' ? 'Día / Mes / Año' : item.type === 'long_text' ? 'Escribí tu respuesta...' : 'Respuesta breve...'))}</span>`;
    }
    function renderQuestionPagination(pages) {
        if (pages <= 1) { $('question-pagination').innerHTML = ''; return; }
        $('question-pagination').innerHTML = `<button type="button" data-question-page="${state.questionPage - 1}" aria-label="Preguntas anteriores" ${state.questionPage === 1 ? 'disabled' : ''}>‹</button><span>${state.questionPage} / ${pages}</span><button type="button" data-question-page="${state.questionPage + 1}" aria-label="Preguntas siguientes" ${state.questionPage === pages ? 'disabled' : ''}>›</button>`;
    }
    function renderCanvas() {
        if (state.step !== 2) return;
        renderedPageSize = questionPageSize();
        const pages = Math.ceil(state.items.length / renderedPageSize) || 1;
        state.questionPage = Math.max(1, Math.min(state.questionPage, pages));
        const start = (state.questionPage - 1) * renderedPageSize;
        $('question-canvas-list').style.setProperty('--question-rows', String(renderedPageSize));
        $('question-canvas-list').hidden = !state.items.length;
        $('canvas-empty').hidden = Boolean(state.items.length);
        $('question-canvas-list').innerHTML = state.items.slice(start, start + renderedPageSize).map(item => `<article class="question-card ${item.id === state.selectedId ? 'is-selected' : ''}" data-question-id="${item.id}">
            <div class="question-card-heading"><span class="question-number">${questionNumber(item)}.</span><button type="button" class="select-question" data-select-question="${item.id}" aria-pressed="${item.id === state.selectedId}" title="${escape(itemTitle(item))}">${escape(itemTitle(item))}</button><div class="question-card-tools"><button type="button" class="icon-button" data-item-action="duplicate" aria-label="Duplicar ${types[item.type].element ? 'elemento' : 'pregunta'}" ${state.items.length >= 20 ? 'disabled' : ''}>${icon('layers-icon.svg')}</button><button type="button" class="icon-button" data-item-action="delete" aria-label="Eliminar ${types[item.type].element ? 'elemento' : 'pregunta'}">${icon('trash-icon.svg')}</button></div></div>
            <div class="question-response" aria-hidden="true">${responseShape(item)}</div><div class="question-card-footer"><span class="card-type">${symbol(item.type)}${types[item.type].label}</span><span class="card-required">${types[item.type].element ? 'Elemento' : item.required ? 'Obligatoria' : 'Opcional'}</span></div></article>`).join('');
        $('canvas-question-count').textContent = `${questions().length} ${questions().length === 1 ? 'pregunta' : 'preguntas'}`;
        const elements = state.items.length - questions().length;
        $('canvas-element-count').textContent = elements ? `${elements} ${elements === 1 ? 'elemento' : 'elementos'}` : '';
        $('add-default-question').disabled = state.items.length >= 20;
        renderQuestionPagination(pages); applyLock();
    }
    function showSelectedPage() {
        const index = state.items.findIndex(item => item.id === state.selectedId);
        if (index >= 0) state.questionPage = Math.floor(index / questionPageSize()) + 1;
    }
    function renderInspector(focusField = null) {
        const item = selected();
        $('inspector-position').innerHTML = '';
        if (!item) {
            $('inspector-fields').innerHTML = `<div class="inspector-placeholder"><span class="survey-icon violet">${icon('pencil-icon.svg')}</span><span>Seleccioná una pregunta para editar su contenido y opciones.</span></div>`;
            return;
        }
        const index = state.items.indexOf(item);
        $('inspector-position').innerHTML = `<span>${index + 1} / ${state.items.length}</span><button type="button" class="icon-button" data-move-item="-1" aria-label="Subir ${types[item.type].element ? 'elemento' : 'pregunta'}" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" class="icon-button" data-move-item="1" aria-label="Bajar ${types[item.type].element ? 'elemento' : 'pregunta'}" ${index === state.items.length - 1 ? 'disabled' : ''}>↓</button>`;
        const typeControl = `<div class="builder-field"><label for="question-type">Tipo de ${types[item.type].element ? 'elemento' : 'respuesta'}</label><div class="builder-select"><select id="question-type" data-question-field="type">${Object.entries(types).map(([key, type]) => `<option value="${key}" ${item.type === key ? 'selected' : ''}>${type.label}</option>`).join('')}</select></div></div>`;
        let fields = item.type === 'divider' ? '' : `<div class="builder-field"><label for="question-title">${item.type === 'section' ? 'Título de la sección' : 'Pregunta'}</label><input id="question-title" type="text" data-question-field="title" maxlength="250" placeholder="${item.type === 'section' ? 'Título de la sección' : 'Escribí tu pregunta...'}" value="${escape(item.title)}"></div>`;
        fields += typeControl;
        if (choiceType(item.type)) {
            const pageSize = optionPageSize();
            const pages = Math.ceil(item.options.length / pageSize);
            state.optionPage = Math.max(1, Math.min(state.optionPage, pages));
            const start = (state.optionPage - 1) * pageSize;
            fields += `<div class="options-editor"><div class="options-editor-heading">Opciones <span>${item.options.length} / 10</span></div>${item.options.slice(start, start + pageSize).map((option, offset) => `<div class="option-row"><span>${start + offset + 1}.</span><input type="text" maxlength="120" data-option="${start + offset}" value="${escape(option)}" aria-label="Opción ${start + offset + 1}"><button type="button" class="icon-button" data-remove-option="${start + offset}" aria-label="Eliminar opción ${start + offset + 1}" ${item.options.length <= 2 ? 'disabled' : ''}>${icon('trash-icon.svg')}</button></div>`).join('')}<div class="options-editor-footer"><button type="button" class="text-button" id="add-option" ${item.options.length >= 10 ? 'disabled' : ''}>${icon('plus-icon.svg')}Agregar opción</button><div class="option-paging"><button type="button" data-option-page="${state.optionPage - 1}" aria-label="Opciones anteriores" ${state.optionPage === 1 ? 'disabled' : ''}>‹</button><span>${state.optionPage} / ${pages}</span><button type="button" data-option-page="${state.optionPage + 1}" aria-label="Opciones siguientes" ${state.optionPage === pages ? 'disabled' : ''}>›</button></div></div></div>`;
        } else if (['short_text', 'long_text'].includes(item.type)) {
            fields += `<div class="builder-field"><label for="question-placeholder">Texto de ayuda</label><input id="question-placeholder" data-question-field="placeholder" type="text" maxlength="120" placeholder="Ej. Contanos tu experiencia..." value="${escape(item.placeholder)}"></div>`;
        } else if (item.type === 'linear_scale') {
            fields += `<div class="builder-field-grid"><div class="builder-field"><label for="scale-min">Desde</label><input id="scale-min" data-question-field="scale_min" type="number" min="0" max="1" value="${item.scale_min}"></div><div class="builder-field"><label for="scale-max">Hasta</label><input id="scale-max" data-question-field="scale_max" type="number" min="2" max="10" value="${item.scale_max}"></div></div><div class="builder-field-grid"><div class="builder-field"><label for="scale-start">Etiqueta inicial</label><input id="scale-start" data-question-field="scale_start" maxlength="40" value="${escape(item.scale_start)}"></div><div class="builder-field"><label for="scale-end">Etiqueta final</label><input id="scale-end" data-question-field="scale_end" maxlength="40" value="${escape(item.scale_end)}"></div></div>`;
        } else if (item.type === 'rating') {
            fields += `<div class="builder-field"><label for="rating-max">Cantidad de estrellas</label><div class="builder-select"><select id="rating-max" data-question-field="rating_max">${[3, 5, 10].map(number => `<option value="${number}" ${item.rating_max === number ? 'selected' : ''}>${number} estrellas</option>`).join('')}</select></div></div>`;
        } else if (item.type === 'section') {
            fields += `<div class="builder-field"><label for="section-description">Texto de la sección</label><textarea id="section-description" data-question-field="description" rows="3" maxlength="500" placeholder="Introducción o indicaciones...">${escape(item.description)}</textarea></div>`;
        }
        if (!types[item.type].element) fields += `<div class="inspector-toggles"><label class="builder-switch"><span>Obligatoria</span><input type="checkbox" role="switch" data-question-field="required" ${item.required ? 'checked' : ''}><i aria-hidden="true"></i></label>${choiceType(item.type) ? `<label class="builder-switch"><span>Permitir “Otro”</span><input type="checkbox" role="switch" data-question-field="other" ${item.other ? 'checked' : ''}><i aria-hidden="true"></i></label>` : ''}</div>`;
        $('inspector-fields').innerHTML = fields;
        applyLock();
        if (focusField) $('inspector-fields').querySelector(`[data-question-field="${focusField}"]`)?.focus();
    }
    function counts() {
        $('summary-questions').textContent = questions().length;
        $('summary-required').textContent = questions().filter(item => item.required).length;
        $('summary-elements').textContent = state.items.length - questions().length;
        $('read-form').disabled = $('review-form').disabled = !questions().length;
    }
    function completedSteps() {
        const formComplete = Boolean(state.form.title.trim() && questions().length && questions().every(item => item.title.trim() && (!choiceType(item.type) || item.options.every(option => option.trim()))));
        const configComplete = (!state.config.limit_enabled || Number(state.config.response_limit) >= 1) && (!state.config.opens_enabled || state.config.opens_at) && (!state.config.closes_enabled || state.config.closes_at) && !(state.config.opens_enabled && state.config.closes_enabled && state.config.opens_at > state.config.closes_at);
        return [Boolean(state.info.title.trim()), formComplete, Boolean(configComplete)];
    }
    function renderSteps() {
        const complete = completedSteps();
        document.querySelectorAll('.builder-step').forEach(button => {
            const number = Number(button.dataset.step);
            const current = number === state.step;
            button.classList.toggle('is-current', current);
            button.classList.toggle('is-complete', !current && complete[number - 1]);
            if (current) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
            button.querySelector('.step-number').textContent = !current && complete[number - 1] ? '✓' : number;
        });
        document.querySelectorAll('.step-connector').forEach((line, index) => line.classList.toggle('is-complete', state.step > index + 1));
    }
    function dateLabel(value) {
        if (!value) return 'Sin definir';
        const [date, time] = value.split('T');
        const [year, month, day] = date.split('-');
        return `${day}/${month}/${year} · ${time.slice(0, 5)}`;
    }
    function renderPublication() {
        const config = state.config;
        const data = [
            ['Preguntas', String(questions().length)], ['Participantes', audienceLabels[config.audience]], ['Respuestas', config.limit_enabled ? (config.response_limit || 'Sin definir') : 'Sin límite'],
            ['Acceso', config.access === 'shared_link' ? 'Enlace compartido' : 'Invitación individual'], ['Identificación', config.identity === 'anonymous' ? 'Anónima' : 'Nombre opcional'],
            ['Apertura', config.opens_enabled ? dateLabel(config.opens_at) : 'Al publicar'], ['Cierre', config.closes_enabled ? dateLabel(config.closes_at) : 'Sin fecha de cierre']
        ];
        $('publication-summary').innerHTML = `<h3 class="summary-form-name">${escape(state.form.title.trim() || 'Encuesta sin título')}</h3><span class="summary-category">${categoryLabels[state.info.category]}</span><dl class="summary-data">${data.map(([name, value]) => `<div><dt>${name}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`;
        const labels = ['Información interna', 'Preguntas del formulario', 'Participación y plazos'];
        const complete = completedSteps();
        $('review-checks').innerHTML = labels.map((label, index) => `<button type="button" data-step="${index + 1}" class="${complete[index] ? 'is-complete' : ''}"><span>${complete[index] ? '✓' : index + 1}</span>${label}</button>`).join('');
    }
    function goStep(step) {
        if (![1, 2, 3].includes(step)) return;
        if (step === 2 && !state.designed) { state.form.title = state.info.title; state.designed = true; }
        state.step = step;
        document.querySelectorAll('[data-screen]').forEach(screen => { screen.hidden = Number(screen.dataset.screen) !== step; });
        $('form-title').value = state.form.title;
        $('form-introduction').value = state.form.introduction;
        $('canvas-category').textContent = categoryLabels[state.info.category];
        $('step-progress').textContent = `Paso ${step} de 3`;
        $('previous-step').hidden = step === 1;
        $('next-step').hidden = step === 3;
        $('publish-survey').hidden = step !== 3;
        $('next-step').querySelector('span').textContent = step === 1 ? 'Continuar a preguntas' : 'Continuar a configuración';
        if (step === 2 && selected()) showSelectedPage();
        renderSteps(); renderCanvas(); renderInspector(); renderPublication(); counts(); applyLock();
    }
    function addItem(type) {
        if (!types[type] || state.items.length >= 20) return;
        const item = makeItem(type);
        state.items.push(item);
        state.selectedId = item.id;
        state.optionPage = 1;
        showSelectedPage();
        renderCanvas(); renderInspector(item.type === 'divider' ? 'type' : 'title'); renderPalette(); counts(); renderSteps();
    }
    function updateQuestion(field, value) {
        const item = selected();
        if (!item) return;
        if (field === 'type') {
            if (!types[value]) return;
            const wasElement = types[item.type].element;
            item.type = value;
            if(choiceType(value)&&item.options.length<2)item.options=['Opción 1','Opción 2'];
            if (types[value].element) item.required = false;
            else if (wasElement) item.required = true;
            state.optionPage = 1;
        } else if (['scale_min', 'scale_max', 'rating_max'].includes(field)) {
            const number = Number(value);
            if (!Number.isInteger(number)) return;
            if (field === 'scale_min' && ![0, 1].includes(number)) return;
            if (field === 'scale_max' && (number < 2 || number > 10)) return;
            if (field === 'rating_max' && ![3, 5, 10].includes(number)) return;
            item[field] = number;
        } else item[field] = value;
        renderCanvas(); counts(); renderSteps();
    }
    function renderForm() {
        $('reader-form-title').textContent = state.form.title.trim() || 'Encuesta sin título';
        $('reader-form-introduction').textContent = state.form.introduction;
        $('builder-form-reader').dataset.formColor = state.color;
        $('builder-form-reader').innerHTML = state.items.map(item => {
            const title = `${escape(itemTitle(item))}${item.required && !types[item.type].element ? ' <em aria-label="Obligatoria">*</em>' : ''}`;
            if (item.type === 'divider') return '<div class="reader-divider" aria-hidden="true"></div>';
            if (item.type === 'section') return `<section class="reader-item reader-section"><h3>${escape(itemTitle(item))}</h3><p>${escape(item.description)}</p></section>`;
            if (['short_text', 'long_text', 'date'].includes(item.type)) return `<section class="reader-item"><label for="answer-${item.id}">${title}</label>${item.type === 'long_text' ? `<textarea id="answer-${item.id}" rows="3" maxlength="1000" placeholder="${escape(item.placeholder || 'Escribí tu respuesta...')}"></textarea>` : `<input id="answer-${item.id}" type="${item.type === 'date' ? 'date' : 'text'}" maxlength="250" placeholder="${escape(item.placeholder || 'Tu respuesta...')}">`}</section>`;
            if (choiceType(item.type)) return `<section class="reader-item"><fieldset><legend>${title}</legend>${item.options.map((option, index) => `<label class="reader-answer"><input type="${item.type === 'multiple_choice' ? 'checkbox' : 'radio'}" name="answer-${item.id}" value="${index}"><span>${escape(option || `Opción ${index + 1}`)}</span></label>`).join('')}${item.other ? `<label class="reader-answer"><input type="${item.type === 'multiple_choice' ? 'checkbox' : 'radio'}" name="answer-${item.id}" value="other"><span>Otro</span><input type="text" maxlength="120" aria-label="Otra opción para ${escape(itemTitle(item))}"></label>` : ''}</fieldset></section>`;
            const start = item.type === 'rating' ? 1 : item.scale_min;
            const end = item.type === 'rating' ? item.rating_max : item.scale_max;
            return `<section class="reader-item"><fieldset><legend>${title}</legend><div class="reader-rating">${Array.from({ length: end - start + 1 }, (_, index) => `<label><span>${item.type === 'rating' ? '☆ ' : ''}${start + index}</span><input type="radio" name="answer-${item.id}" value="${start + index}"></label>`).join('')}</div>${item.type === 'linear_scale' ? `<p class="rating-ends"><span>${escape(item.scale_start)}</span><span>${escape(item.scale_end)}</span></p>` : ''}</fieldset></section>`;
        }).join('');
        $('builder-form-dialog').showModal();
    }
    function hydrateTemplate() {
        const key = new URLSearchParams(location.search).get('template');
        if (!key) return;
        const template = window.HospitalSurveyTemplates.find(candidate => candidate.category === key);
        if (!template) { console.error('[Encuestas] No se encontró la plantilla solicitada.'); return; }
        state.info.title = template.title;
        state.info.description = template.description;
        state.info.category = template.category;
        state.form.title = template.title;
        state.form.introduction = template.description;
        state.config.audience = template.audience;
        state.designed = true;
        state.items = template.questions.map(question => ({ ...makeItem({ choice: 'single_choice', text: 'long_text', rating: 'rating' }[question.type]), title: question.title, required: question.required, options: question.options ? question.options.split('\n') : ['Opción 1', 'Opción 2'] }));
        state.selectedId = state.items[0]?.id || null;
    }

    document.addEventListener('DOMContentLoaded', async () => {
        document.querySelector('.survey-builder').inert=true;
        try {
            if(!await window.HospitalAuth.ready)return;
            const params=new URLSearchParams(location.search),id=params.get('id')||params.get('copy_id');
            if(id)hydrate(await surveysApi.get(id),Boolean(params.get('copy_id')));else hydrateTemplate();
            loaded=true;
        } catch(error){api.report(error,'surveys');}
        finally{document.querySelector('.survey-builder').inert=!loaded;}
        $('save-survey').addEventListener('click',()=>save());$('publish-survey').addEventListener('click',()=>save(true));
        document.querySelectorAll('[data-info]').forEach(field => { field.value = state.info[field.dataset.info]; });
        document.querySelectorAll('[data-config]').forEach(field => {
            if (field.type === 'checkbox') field.checked = state.config[field.dataset.config]; else field.value = state.config[field.dataset.config];
        });
        $('form-colors').innerHTML = Object.entries(colors).map(([key, [label, color]]) => `<button type="button" class="form-color" data-color="${key}" style="--swatch: ${color}" aria-label="${label}" aria-pressed="${key === state.color}"></button>`).join('');
        const compact = window.matchMedia('(max-height: 950px)');
        $('appearance-details').open = !compact.matches;
        compact.addEventListener('change', () => { $('appearance-details').open = !compact.matches; state.optionPage = 1; renderInspector(); });
        $('survey-builder-form').addEventListener('submit', event => event.preventDefault());
        $('type-search').addEventListener('input', renderPalette);
        document.addEventListener('click', event => {
            const stepButton = event.target.closest('[data-step]');
            if (stepButton) goStep(Number(stepButton.dataset.step));
            const addButton = event.target.closest('[data-add-type]');
            if (addButton && !addButton.disabled) addItem(addButton.dataset.addType);
        });
        $('next-step').addEventListener('click', () => {goStep(state.step + 1);applyLock();});
        $('previous-step').addEventListener('click', () => {goStep(state.step - 1);applyLock();});
        $('add-default-question').addEventListener('click', () => addItem('short_text'));
        $('question-canvas-list').addEventListener('click', event => {
            const card = event.target.closest('[data-question-id]');
            if (!card) return;
            const item = state.items.find(candidate => candidate.id === card.dataset.questionId);
            const action = event.target.closest('[data-item-action]');
            if (action) {
                if (action.disabled) return;
                const index = state.items.indexOf(item);
                if (action.dataset.itemAction === 'delete') {
                    state.items.splice(index, 1);
                    if (state.selectedId === item.id) state.selectedId = state.items[Math.min(index, state.items.length - 1)]?.id || null;
                } else if (state.items.length < 20) {
                    const copy = { ...item, id: makeItem(item.type).id, options: [...item.options] };
                    state.items.splice(index + 1, 0, copy);
                    state.selectedId = copy.id;
                }
                showSelectedPage(); renderCanvas(); renderInspector(); renderPalette(); counts(); renderSteps();
            } else {
                state.selectedId = item.id;
                state.optionPage = 1;
                $('question-canvas-list').querySelectorAll('[data-question-id]').forEach(node => {
                    const active = node.dataset.questionId === item.id;
                    node.classList.toggle('is-selected', active);
                    node.querySelector('[data-select-question]').setAttribute('aria-pressed', String(active));
                });
                renderInspector();
            }
        });
        $('question-pagination').addEventListener('click', event => {
            const button = event.target.closest('[data-question-page]');
            if (!button || button.disabled) return;
            state.questionPage = Number(button.dataset.questionPage);
            renderCanvas();
            $('question-pagination').querySelector('button:not(:disabled)')?.focus();
        });
        document.querySelector('.inspector-panel').addEventListener('click', event => {
            const item = selected();
            if (!item) return;
            const remove = event.target.closest('[data-remove-option]');
            const paging = event.target.closest('[data-option-page]');
            const move = event.target.closest('[data-move-item]');
            if (remove && !remove.disabled) {
                item.options.splice(Number(remove.dataset.removeOption), 1);
                renderInspector(); renderCanvas();
            } else if (event.target.closest('#add-option') && item.options.length < 10) {
                item.options.push(`Opción ${item.options.length + 1}`);
                state.optionPage = Math.ceil(item.options.length / optionPageSize());
                renderInspector(); renderCanvas();
                $('inspector-fields').querySelector(`[data-option="${item.options.length - 1}"]`)?.focus();
            } else if (paging && !paging.disabled) {
                state.optionPage = Number(paging.dataset.optionPage);
                renderInspector();
            } else if (move && !move.disabled) {
                const index = state.items.indexOf(item), target = index + Number(move.dataset.moveItem);
                [state.items[index], state.items[target]] = [state.items[target], state.items[index]];
                showSelectedPage(); renderCanvas(); renderInspector();
                $('inspector-position').querySelector(`[data-move-item="${move.dataset.moveItem}"]:not(:disabled)`)?.focus();
            }
            renderSteps();
        });
        $('survey-builder-form').addEventListener('input', event => {
            const field = event.target;
            if (field.dataset.info) {
                state.info[field.dataset.info] = field.value;
                $('canvas-category').textContent = categoryLabels[state.info.category];
            } else if (field.dataset.form) state.form[field.dataset.form] = field.value;
            else if (field.dataset.config) {
                state.config[field.dataset.config] = field.type === 'checkbox' ? field.checked : field.value;
                $('response-limit').disabled = !state.config.limit_enabled;
                $('opens-at').disabled = !state.config.opens_enabled;
                $('closes-at').disabled = !state.config.closes_enabled;
            } else if (field.dataset.option !== undefined && selected()) {
                selected().options[Number(field.dataset.option)] = field.value;
                renderCanvas();
            } else if (field.dataset.questionField && field.dataset.questionField !== 'type') updateQuestion(field.dataset.questionField, field.type === 'checkbox' ? field.checked : field.value);
            renderSteps(); renderPublication();
        });
        const pointerSelects = new WeakSet();
        $('survey-builder-form').addEventListener('pointerdown', event => { if (event.target.matches('select')) pointerSelects.add(event.target); });
        $('survey-builder-form').addEventListener('keydown', event => { if (event.target.matches('select')) pointerSelects.delete(event.target); });
        $('survey-builder-form').addEventListener('focusout', event => { if (event.target.matches('select')) pointerSelects.delete(event.target); });
        $('survey-builder-form').addEventListener('change', event => {
            const field = event.target;
            if (field.dataset.questionField === 'type') {
                const pointer = pointerSelects.has(field);
                updateQuestion('type', field.value);
                renderInspector(pointer ? null : 'type');
            } else if (field.matches('select') && pointerSelects.has(field)) field.blur();
        });
        $('form-colors').addEventListener('click', event => {
            const button = event.target.closest('[data-color]');
            if (!button) return;
            state.color = button.dataset.color;
            document.querySelector('.form-canvas').dataset.formColor = state.color;
            $('form-colors').querySelectorAll('button').forEach(control => control.setAttribute('aria-pressed', String(control === button)));
        });
        ['read-form', 'review-form'].forEach(id => $(id).addEventListener('click', renderForm));
        document.querySelector('[data-close-form]').addEventListener('click', () => $('builder-form-dialog').close());
        $('builder-form-dialog').querySelector('.dialog-footer [data-close-form]').addEventListener('click', () => $('builder-form-dialog').close());
        syncFields();renderPalette(); goStep(1);applyLock();
        new ResizeObserver(() => {
            if (state.step === 2 && window.matchMedia('(min-width: 901px)').matches && questionPageSize() !== renderedPageSize) { showSelectedPage(); renderCanvas(); }
        }).observe(document.querySelector('.questions-panel'));
    });
})();
