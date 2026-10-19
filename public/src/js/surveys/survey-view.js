(() => {
    'use strict';

    // Authorized SQL records and aggregates supply this screen.
    // No hospital records, responses or browser draft storage are seeded here.
    let survey = null;
    const api=window.HospitalApi,surveysApi=window.HospitalSurveys;
    let loading=false,entryRevision=0,entryPage=1,answerTimer;
    const requestedId = new URLSearchParams(location.search).get('id');
    const categories = { patient_care: 'Atención al paciente', transfers: 'Traslados', emergency: 'Emergencias', staff: 'Personal', other: 'Otras' };
    const audiences = { patients: 'Pacientes', staff: 'Personal', everyone: 'Pacientes y personal' };
    const statuses = { draft: 'BORRADOR', published: 'ACTIVA', closed: 'FINALIZADA', archived: 'ARCHIVADA' };
    const types = {
        short_text: { label: 'Respuesta corta', icon: 'document-icon.svg' },
        long_text: { label: 'Respuesta larga', icon: 'document-icon.svg' },
        single_choice: { label: 'Opción múltiple', icon: 'multiple-choice.svg' },
        multiple_choice: { label: 'Casillas', icon: 'cages-icon.svg' },
        rating: { label: 'Calificación', icon: 'star-icon.svg' },
        linear_scale: { label: 'Escala', icon: 'analytics-icon.svg' },
        date: { label: 'Fecha', icon: 'calendar-icon.svg' },
        section: { label: 'Título y texto', icon: 'document-icon.svg', element: true },
        divider: { label: 'Separador', icon: 'layers-icon.svg', element: true }
    };
    const state = { tab: 'summary', selectedId: null, query: '', answerQuery: '', navPage: 1, overviewPage: 1, resultPage: 1 };
    const $ = id => document.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const icon = name => `<img src="../../../assets/Icons/${name}" alt="">`;
    const numberFormat = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 1 });
    const dateFormat = new Intl.DateTimeFormat('es-UY', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Montevideo' });
    const count = value => value === null || value === undefined || value === '' ? null : Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
    const displayCount = value => count(value) === null ? '—' : numberFormat.format(Number(value));
    const config = () => survey?.config || {};
    let items = [], renderedOverviewSize = null, renderedNavigationSize = null, renderedResultSize = null;

    function dateText(value) {
        if (!value) return 'Sin definir';
        if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(value)) {
            const [date, time] = value.split('T'), [year, month, day] = date.split('-');
            return `${day}/${month}/${year}${time ? ` · ${time}` : ''}`;
        }
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? 'Sin definir' : dateFormat.format(date);
    }
    function prepareItems() {
        items = (survey?.questions || survey?.items || []).map((question, index) => {
            const type = { choice: 'single_choice', text: 'long_text' }[question.type] || question.type;
            return { ...question, id: String(question.id ?? `question-${index + 1}`), type: types[type] ? type : 'long_text', title: String(question.title || ''), options: Array.isArray(question.options) ? question.options.map(String) : String(question.options || '').split('\n').filter(Boolean), rating_max: [3, 5, 10].includes(Number(question.rating_max)) ? Number(question.rating_max) : 5, scale_min: Number(question.scale_min) === 0 ? 0 : 1, scale_max: Math.max(2, Math.min(10, Number(question.scale_max) || 5)) };
        });
        state.selectedId = items.find(item => !types[item.type].element)?.id || items[0]?.id || null;
    }
    const questions = () => items.filter(item => !types[item.type].element);
    const selected = () => items.find(item => item.id === state.selectedId);
    const questionTitle = item => item.title || (item.type === 'divider' ? 'Separador' : item.type === 'section' ? 'Sección sin título' : 'Pregunta sin título');
    const questionNumber = item => types[item.type].element ? '—' : questions().findIndex(question => question.id === item.id) + 1;
    const availableItems = () => state.tab === 'form' ? items : questions();
    function resultFor(item) {
        const result = Array.isArray(survey?.results) ? survey.results.find(row => String(row.question_id) === item.id) : survey?.results?.[item.id];
        if (result) return result;
        return survey && count(survey.response_count) === 0 ? { answer_count: 0, skipped_count: 0, distribution: [], entries: [] } : null;
    }
    function binCount(result, value) {
        if (!result) return null;
        const row = (result.distribution || []).find(bin => String(bin.value) === String(value));
        return row ? count(row.count) : count(result.answer_count) === 0 ? 0 : null;
    }
    function average(item, result) {
        if (!['rating', 'linear_scale'].includes(item.type) || !(count(result?.answer_count) > 0)) return null;
        const bins = result.distribution || [], total = bins.reduce((sum, bin) => sum + (count(bin.count) || 0), 0);
        if (!total || bins.some(bin => !Number.isFinite(Number(bin.value)) || count(bin.count) === null)) return null;
        return bins.reduce((sum, bin) => sum + Number(bin.value) * Number(bin.count), 0) / total;
    }
    function empty(title, description, image = 'survey-icon.svg', back = false) {
        return `<div class="insight-empty"><span class="survey-icon violet">${icon(image)}</span><h3>${escape(title)}</h3><p>${escape(description)}</p>${back ? '<a href="survey.html">Volver a encuestas ↗</a>' : ''}</div>`;
    }
    function paging(current, pages, attribute) {
        return pages <= 1 ? '' : `<button type="button" ${attribute}="${current - 1}" aria-label="Página anterior" ${current <= 1 ? 'disabled' : ''}>‹</button><span>${current} / ${pages}</span><button type="button" ${attribute}="${current + 1}" aria-label="Página siguiente" ${current >= pages ? 'disabled' : ''}>›</button>`;
    }
    function overviewPageSize() {
        if (innerWidth <= 900) return 4;
        const panel = document.querySelector('.question-overview');
        const available = panel.clientHeight - panel.querySelector('.insight-panel-heading').offsetHeight - panel.querySelector('.overview-column-head').offsetHeight - 40 - 6;
        return Math.max(1, Math.min(5, Math.floor(available / 46)));
    }
    function navigationPageSize() {
        if (innerWidth <= 900) return 6;
        const panel = document.querySelector('.question-navigation');
        const available = panel.clientHeight - panel.querySelector('.insight-panel-heading').offsetHeight - 54 - 40 - 16;
        return Math.max(1, Math.min(8, Math.floor(available / 62)));
    }
    const resultPageSize = () => innerWidth > 770 && innerHeight <= 850 ? 3 : 4;
    const textPageSize = () => innerWidth > 770 && innerHeight <= 760 ? 1 : innerWidth > 770 && innerHeight <= 850 ? 2 : 3;

    function renderHeader() {
        $('survey-view-title').textContent = survey?.title || 'Detalle de encuesta';
        $('survey-view-title').title = survey?.title || '';
        $('view-category').textContent = survey ? categories[survey.category] || 'Sin categoría' : 'Contenido y respuestas';
        $('view-status').hidden = !statuses[survey?.status];
        if (statuses[survey?.status]) { $('view-status').className = `survey-status ${survey.status}`; $('view-status').textContent = statuses[survey.status]; }
        $('survey-reference').textContent = survey?.id ? `ID ${survey.id}` : '';
        const edit = $('detail-edit-survey');
        if (survey?.id) { edit.href = `survey-new.html?id=${encodeURIComponent(survey.id)}`; edit.removeAttribute('aria-disabled'); edit.removeAttribute('tabindex'); }
        else { edit.removeAttribute('href'); edit.setAttribute('aria-disabled', 'true'); edit.tabIndex = -1; }
        $('view-form').disabled = !items.length;
        $('more-survey-info').disabled = !survey;
        document.querySelectorAll('[data-share-survey]').forEach(button=>button.disabled=!survey?.published_at||!!survey?.archived_at);
        const toggle=$('survey-transition');toggle.hidden=!survey||!!survey.archived_at;
        if(survey){toggle.dataset.action=survey.lifecycle==='draft'?'publish':survey.lifecycle==='closed'?'reopen':'close';toggle.textContent=survey.lifecycle==='draft'?'Publicar':survey.lifecycle==='closed'?'Reabrir':'Cerrar encuesta';}
        $('view-response-count').textContent = displayCount(survey?.response_count);
        $('view-response-caption').textContent = survey?.updated_at ? `Última actividad · ${dateText(survey.updated_at)}` : 'De esta encuesta';
        $('view-question-count').textContent = survey ? questions().length : '—';
        $('view-required-count').textContent = survey ? `${questions().filter(item => item.required).length} obligatorias · ${items.length - questions().length} elementos` : 'Contenido del formulario';
        const rating = survey?.average_rating, scale = Number(survey?.rating_scale);
        const hasRating = count(survey?.response_count) > 0 && rating !== undefined && rating !== null && Number.isFinite(Number(rating)) && scale > 0 && Number(rating) >= 0 && Number(rating) <= scale;
        $('view-rating').textContent = hasRating ? numberFormat.format(Number(rating)) : '—';
        $('view-rating-caption').textContent = hasRating ? `Sobre ${scale} puntos` : 'Sin valoraciones disponibles';
        const maximum = config().limit_enabled ? count(config().response_limit) : null, responses = count(survey?.response_count);
        $('view-capacity').textContent = maximum > 0 && responses !== null ? `${numberFormat.format(responses / maximum * 100)}%` : '—';
        $('view-capacity-caption').textContent = maximum > 0 ? `${displayCount(responses)} de ${displayCount(maximum)} respuestas` : survey && config().limit_enabled === false ? 'Sin límite de respuestas' : 'Respuestas / cupo máximo';
        document.title = `${survey?.title || 'Detalle de encuesta'} | Hospital de Clínicas`;
    }
    function informationRows() {
        return [['Categoría', categories[survey?.category] || 'Sin definir'], ['Dirigida a', audiences[config().audience || survey?.audience] || 'Sin definir'], ['Creada', dateText(survey?.created_at)], ['Responsable', survey?.owner_name || 'Sin definir'], ['Apertura', config().opens_enabled ? dateText(config().opens_at) : config().opens_enabled === false ? 'Al publicar' : 'Sin definir'], ['Cierre', config().closes_enabled ? dateText(config().closes_at) : config().closes_enabled === false ? 'Sin fecha de cierre' : 'Sin definir']];
    }
    const definitionList = rows => `<dl class="information-fields">${rows.map(([name, value]) => `<div><dt>${escape(name)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`;
    function renderInformation() {
        $('survey-information').innerHTML = `${survey?.description ? `<p class="information-description">${escape(survey.description)}</p>` : ''}${definitionList(informationRows())}`;
        $('access-caption').textContent = survey ? `${config().access === 'individual_link' ? 'Invitación individual' : config().access === 'shared_link' ? 'Enlace compartido' : 'Acceso sin definir'} · ${config().identity === 'anonymous' ? 'Respuestas anónimas' : config().identity === 'optional_name' ? 'Nombre opcional' : 'Identificación sin definir'}` : 'Enlace y código de acceso de la encuesta';
    }
    function renderActivity() {
        const activity = Array.isArray(survey?.activity) ? survey.activity.filter(day => day.date && count(day.count) !== null).slice(-7) : [];
        if (!activity.length) {
            $('survey-activity').innerHTML = !survey ? empty('Seleccioná una encuesta', 'Abrí una encuesta desde el listado para consultar su contenido y sus respuestas.', 'survey-answers.svg', true) : count(survey.response_count) === 0 ? empty('Aún no hay respuestas', 'La participación se mostrará cuando lleguen las primeras respuestas.', 'survey-answers.svg') : empty('Participación por fecha', 'El detalle por fecha aparecerá cuando esté disponible.', 'calendar-icon.svg');
            $('activity-caption').textContent = 'Respuestas recibidas';
            return;
        }
        const maximum = Math.max(...activity.map(day => Number(day.count)), 1);
        $('activity-caption').textContent = 'Últimas fechas con datos';
        $('survey-activity').innerHTML = `<div class="activity-bars" style="--activity-columns:${activity.length}" role="img" aria-label="Respuestas por fecha: ${escape(activity.map(day => `${dateText(day.date)}: ${day.count}`).join('; '))}">${activity.map(day => `<div class="activity-day"><strong>${displayCount(day.count)}</strong><div class="activity-track"><span class="activity-fill" style="--bar-height:${Number(day.count) / maximum * 100}%;opacity:${Number(day.count) > 0 ? 1 : 0}"></span></div><span title="${escape(dateText(day.date))}">${escape(dateText(day.date).slice(0, 5))}</span></div>`).join('')}</div>`;
    }
    function renderOverview() {
        const list = questions();
        renderedOverviewSize = overviewPageSize();
        const pages = Math.max(1, Math.ceil(list.length / renderedOverviewSize));
        state.overviewPage = Math.max(1, Math.min(state.overviewPage, pages));
        const start = (state.overviewPage - 1) * renderedOverviewSize;
        $('overview-question-count').textContent = survey ? list.length : '';
        $('overview-question-count').hidden = !survey;
        $('question-overview-list').style.setProperty('--overview-rows', renderedOverviewSize);
        $('question-overview-list').innerHTML = list.length ? list.slice(start, start + renderedOverviewSize).map(item => {
            const result = resultFor(item), mean = average(item, result);
            return `<button type="button" class="overview-question" data-open-question="${escape(item.id)}"><span class="overview-question-copy"><span class="question-index-number">${questionNumber(item)}</span><span><strong title="${escape(questionTitle(item))}">${escape(questionTitle(item))}</strong><small>${types[item.type].label} · ${item.required ? 'Obligatoria' : 'Opcional'}</small></span></span><span>${displayCount(result?.answer_count)}</span><span>${mean === null ? '—' : numberFormat.format(mean)}</span></button>`;
        }).join('') : empty('Contenido de la encuesta', 'Las preguntas y sus resultados aparecerán acá.', 'list-icon.svg');
        $('overview-range').textContent = list.length ? `${start + 1}–${Math.min(list.length, start + renderedOverviewSize)} de ${list.length} preguntas` : 'Sin preguntas disponibles';
        $('overview-pagination').innerHTML = paging(state.overviewPage, pages, 'data-overview-page');
    }
    function navigationItems() { return availableItems().filter(item => normalize(questionTitle(item)).includes(normalize(state.query))); }
    function showSelectedPage() {
        const index = navigationItems().findIndex(item => item.id === state.selectedId);
        if (index >= 0) state.navPage = Math.floor(index / navigationPageSize()) + 1;
    }
    function renderNavigation() {
        const list = navigationItems();
        renderedNavigationSize = navigationPageSize();
        const pages = Math.max(1, Math.ceil(list.length / renderedNavigationSize));
        state.navPage = Math.max(1, Math.min(state.navPage, pages));
        const start = (state.navPage - 1) * renderedNavigationSize;
        $('question-nav-title').textContent = state.tab === 'form' ? 'Contenido' : 'Preguntas';
        $('question-nav-count').textContent = availableItems().length;
        $('question-navigation-list').style.setProperty('--navigation-rows', renderedNavigationSize);
        $('question-navigation-list').innerHTML = list.length ? list.slice(start, start + renderedNavigationSize).map(item => `<button type="button" class="question-nav-button" data-select-question="${escape(item.id)}" aria-pressed="${item.id === state.selectedId}"><span class="question-index-number">${questionNumber(item)}</span><span><strong title="${escape(questionTitle(item))}">${escape(questionTitle(item))}</strong><small>${types[item.type].label}</small></span></button>`).join('') : empty(state.query ? 'Sin coincidencias' : 'Sin preguntas', state.query ? 'Probá con otra búsqueda.' : 'El contenido aparecerá al seleccionar una encuesta.', 'list-icon.svg');
        $('question-nav-range').textContent = list.length ? `${start + 1}–${Math.min(list.length, start + renderedNavigationSize)} de ${list.length}` : '0 preguntas';
        $('question-nav-pagination').innerHTML = paging(state.navPage, pages, 'data-nav-page');
        $('mobile-question').innerHTML = availableItems().length ? availableItems().map(item => `<option value="${escape(item.id)}" ${item.id === state.selectedId ? 'selected' : ''}>${questionNumber(item)}. ${escape(questionTitle(item))}</option>`).join('') : '<option>Sin preguntas disponibles</option>';
        $('mobile-question').disabled = !availableItems().length;
    }
    function renderQuestionFooter() {
        const list = availableItems(), index = list.findIndex(item => item.id === state.selectedId);
        document.querySelectorAll('[data-previous-question]').forEach(button => { button.disabled = index <= 0; });
        document.querySelectorAll('[data-next-question]').forEach(button => { button.disabled = index < 0 || index >= list.length - 1; });
        document.querySelectorAll('.selected-question-position').forEach(label => { label.textContent = index < 0 ? 'Sin preguntas' : `${index + 1} de ${list.length}`; });
    }
    function renderChoiceResult(item, result) {
        const values = [...item.options, ...(item.other ? ['Otro'] : [])], size = resultPageSize();
        renderedResultSize = size;
        const pages = Math.max(1, Math.ceil(values.length / size));
        state.resultPage = Math.max(1, Math.min(state.resultPage, pages));
        const start = (state.resultPage - 1) * size, answered = count(result?.answer_count);
        $('question-results-content').innerHTML = `<div class="result-bar-list">${values.slice(start, start + size).map(option => {
            const total = binCount(result, option), percent = total === null || answered === null ? null : answered === 0 ? 0 : total / answered * 100;
            return `<div class="result-bar"><div class="result-bar-label"><span>${escape(option)}</span><span>${displayCount(total)} · ${percent === null ? '—' : `${numberFormat.format(percent)}%`}</span></div><div class="result-bar-track"><div class="result-bar-fill" style="--bar-width:${Math.max(0, Math.min(100, percent || 0))}%"></div></div></div>`;
        }).join('')}</div><p class="result-note">${item.type === 'multiple_choice' ? 'Cada respuesta puede incluir varias opciones.' : answered === 0 ? 'Esta pregunta todavía no tiene respuestas.' : !result ? 'Sin desglose de respuestas disponible.' : 'Porcentaje sobre las respuestas a esta pregunta.'}</p><div class="result-data-footer"><span>${values.length} opciones</span><nav class="survey-pagination" aria-label="Páginas de opciones">${paging(state.resultPage, pages, 'data-result-page')}</nav></div>`;
    }
    function renderScaleResult(item, result) {
        const first = item.type === 'rating' ? 1 : item.scale_min, last = item.type === 'rating' ? item.rating_max : item.scale_max;
        const values = Array.from({ length: last - first + 1 }, (_, index) => first + index), bins = values.map(value => binCount(result, value)), maximum = Math.max(...bins.map(value => value || 0), 1);
        $('question-results-content').innerHTML = `<div class="result-histogram" style="--distribution-columns:${values.length}" role="img" aria-label="Distribución: ${escape(values.map((value, index) => `${value}: ${displayCount(bins[index])}`).join('; '))}">${values.map((value, index) => `<div class="histogram-column"><strong>${displayCount(bins[index])}</strong><div class="histogram-track"><span class="histogram-fill" style="--bar-height:${(bins[index] || 0) / maximum * 100}%;opacity:${bins[index] > 0 ? 1 : 0}"></span></div><span>${item.type === 'rating' ? '☆ ' : ''}${value}</span></div>`).join('')}</div>${item.type === 'linear_scale' ? `<div class="scale-result-ends"><span>${escape(item.scale_start || '')}</span><span>${escape(item.scale_end || '')}</span></div>` : ''}<p class="result-note">${count(result?.answer_count) === 0 ? 'Esta pregunta todavía no tiene respuestas.' : !result ? 'Sin desglose de respuestas disponible.' : `Distribución de las respuestas en una escala de ${first} a ${last}.`}</p>`;
    }
    function entriesFor(item, result) {
        return (Array.isArray(result?.entries) ? result.entries : []).map((entry, index) => ({ value: String(typeof entry === 'object' ? entry.value ?? '' : entry), date: typeof entry === 'object' ? entry.submitted_at : null, index })).filter(entry => normalize(entry.value).includes(normalize(state.answerQuery)));
    }
    async function renderAnswerEntries(item) {
        if(!survey||!item)return;
        const revision=++entryRevision, size=textPageSize();renderedResultSize=size;
        try{
            const result=await api.getPage(`surveys/answers.php?id=${survey.id}&question_id=${encodeURIComponent(item.id)}&q=${encodeURIComponent(state.answerQuery)}&page=${entryPage}&page_size=${size}`);
            if(revision!==entryRevision||item.id!==selected()?.id||!$('written-answer-list'))return;
            const total=result.meta.total,pages=Math.max(1,Math.ceil(total/size));
            if(entryPage>pages){entryPage=pages;return renderAnswerEntries(item);}
            $('written-answer-list').innerHTML=result.data.length?result.data.map((entry,index)=>`<article class="written-answer"><span>Respuesta ${(entryPage-1)*size+index+1}${entry.submitted_at?' · '+escape(dateText(entry.submitted_at)):''}${entry.participant_name?' · '+escape(entry.participant_name):''}</span><p>${escape(item.type==='date'?dateText(entry.value):entry.value)}</p></article>`).join(''):empty(state.answerQuery?'Sin coincidencias':'Aún no hay respuestas escritas',state.answerQuery?'Probá con otra búsqueda.':'Las respuestas se mostrarán acá.');
            $('written-answer-range').textContent=total?`${(entryPage-1)*size+1}–${Math.min(total,entryPage*size)} de ${total}`:'0 respuestas';
            $('written-answer-pagination').innerHTML=paging(entryPage,pages,'data-entry-page');
        }catch(error){api.report(error,'survey-results');}
    }
    function writtenContainer(item) {
        return `<label class="survey-search answer-search">${icon('search-icon.svg')}<input type="search" id="answer-search" placeholder="Buscar en las respuestas..." aria-label="Buscar en las respuestas" maxlength="150" value="${escape(state.answerQuery)}"></label><div class="written-answer-list" id="written-answer-list"></div><div class="result-data-footer"><span id="written-answer-range"></span><nav class="survey-pagination" id="written-answer-pagination" aria-label="Páginas de respuestas"></nav></div>`;
    }
    function renderQuestionResults() {
        const item = selected();
        if (!item || types[item.type].element) {
            $('selected-question-heading').innerHTML = '<h2>Resultados por pregunta</h2>';
            $('question-result-metrics').innerHTML = '';
            $('question-results-content').innerHTML = empty('Seleccioná una pregunta', 'Consultá el desglose de respuestas, las valoraciones y los comentarios de cada pregunta.', 'analytics-icon.svg');
            renderQuestionFooter();
            return;
        }
        const result = resultFor(item), mean = average(item, result), scale = item.type === 'rating' ? item.rating_max : item.scale_max;
        $('selected-question-heading').innerHTML = `<div class="question-kind">${icon(types[item.type].icon)}<span>${types[item.type].label}</span><span>${item.required ? 'Obligatoria' : 'Opcional'}</span></div><h2>${questionNumber(item)}. ${escape(questionTitle(item))}</h2>`;
        $('question-result-metrics').innerHTML = `<div><span>Respuestas</span><strong>${displayCount(result?.answer_count)}</strong></div><div><span>Sin responder</span><strong>${displayCount(result?.skipped_count)}</strong></div>${['rating', 'linear_scale'].includes(item.type) ? `<div><span>Promedio</span><strong>${mean === null ? '—' : numberFormat.format(mean)}<small>/ ${scale}</small></strong></div>` : ''}`;
        if (['single_choice', 'multiple_choice'].includes(item.type)) {renderChoiceResult(item,result);if(item.other){$('question-results-content').insertAdjacentHTML('beforeend','<details><summary>Respuestas “Otro”</summary>'+writtenContainer(item)+'</details>');renderAnswerEntries(item);}}
        else if (['rating', 'linear_scale'].includes(item.type)) renderScaleResult(item, result);
        else {
            $('question-results-content').innerHTML=writtenContainer(item);
            renderAnswerEntries(item);
        }
        renderQuestionFooter();
    }
    function renderForm() {
        $('public-form-title').textContent = survey?.form_title || survey?.form?.title || survey?.title || 'Contenido del formulario';
        // Internal descriptions and notes never become participant-facing copy.
        $('public-form-introduction').textContent = survey?.form_description || survey?.form?.introduction || '';
        const item = selected();
        if (!item) { $('public-form-content').innerHTML = empty('Formulario de la encuesta', 'Seleccioná una encuesta desde el listado para recorrer sus preguntas.', 'survey-icon.svg', true); renderQuestionFooter(); return; }
        let content;
        if (item.type === 'divider') content = '<hr class="form-divider"><p class="result-note">Separador entre secciones del formulario.</p>';
        else if (item.type === 'section') content = `<p class="form-section-text">${escape(item.description || '')}</p>`;
        else if (['short_text', 'long_text', 'date'].includes(item.type)) content = `<div class="form-answer-placeholder ${item.type === 'long_text' ? 'long' : ''}">${escape(item.type === 'date' ? 'Día / Mes / Año' : item.placeholder || 'Escribí tu respuesta...')}</div>`;
        else if (['single_choice', 'multiple_choice'].includes(item.type)) content = `<div class="form-choice-options">${[...item.options, ...(item.other ? ['Otro'] : [])].map(option => `<div class="form-choice-option ${item.type === 'multiple_choice' ? 'multiple' : ''}"><i aria-hidden="true"></i><span>${escape(option)}</span></div>`).join('')}</div>`;
        else {
            const start = item.type === 'rating' ? 1 : item.scale_min, end = item.type === 'rating' ? item.rating_max : item.scale_max;
            content = `<div class="form-rating-options">${Array.from({ length: end - start + 1 }, (_, index) => `<span>${item.type === 'rating' ? icon('star-icon.svg') : ''}${start + index}</span>`).join('')}</div>${item.type === 'linear_scale' ? `<p class="scale-result-ends"><span>${escape(item.scale_start || '')}</span><span>${escape(item.scale_end || '')}</span></p>` : ''}`;
        }
        $('public-form-content').innerHTML = `<article class="form-question"><div class="question-kind">${icon(types[item.type].icon)}${types[item.type].label}</div><h3>${types[item.type].element ? '' : `${questionNumber(item)}. `}${escape(questionTitle(item))}${item.required && !types[item.type].element ? ' <em aria-label="Obligatoria">*</em>' : ''}</h3>${content}</article>`;
        renderQuestionFooter();
    }
    function setTab(tab, focus = false) {
        if (!['summary', 'questions', 'form'].includes(tab)) return;
        state.tab = tab;
        document.querySelectorAll('[data-insight-tab]').forEach(button => { const active = button.dataset.insightTab === tab; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; if (active && focus) button.focus(); });
        $('summary-panel').hidden = tab !== 'summary';
        $('question-workspace').hidden = tab === 'summary';
        $('question-results-panel').hidden = tab !== 'questions';
        $('survey-form-panel').hidden = tab !== 'form';
        if (!availableItems().some(item => item.id === state.selectedId)) state.selectedId = availableItems()[0]?.id || null;
        if (tab === 'summary') renderOverview();
        else { showSelectedPage(); renderNavigation(); tab === 'form' ? renderForm() : renderQuestionResults(); }
    }
    function selectQuestion(id) {
        if (!availableItems().some(item => item.id === id)) return;
        state.selectedId = id; state.resultPage = 1; entryPage=1;state.answerQuery = '';entryRevision++;
        showSelectedPage(); renderNavigation(); state.tab === 'form' ? renderForm() : renderQuestionResults();
    }
    function openInformation() {
        if (!survey) return;
        $('full-info-title').textContent = survey.title || 'Información de la encuesta';
        $('full-survey-info').innerHTML = `<h3>Descripción interna</h3><p>${escape(survey.description || 'Sin descripción')}</p><h3>Notas para el equipo</h3><p>${escape(survey.notes || survey.info?.notes || 'Sin notas')}</p>${definitionList([...informationRows(), ['Servicio o área', survey.area || survey.info?.area || 'Sin definir'], ['Cupo máximo', config().limit_enabled ? displayCount(config().response_limit) : config().limit_enabled === false ? 'Sin límite' : 'Sin definir'], ['Mensaje al finalizar', config().completion_message || 'Sin definir']])}`;
        $('survey-info-dialog').showModal();
    }

    document.addEventListener('DOMContentLoaded', async () => {
        if (requestedId && !/^[1-9]\d{0,18}$/.test(requestedId)) console.error('[Encuestas] Identificador de encuesta inválido.');
        async function reload(){
            if(loading||document.querySelector('dialog[open]')||document.activeElement?.matches('input,textarea,select'))return;
            loading=true;try{
                if(!requestedId)return;
                const previous=state.selectedId;survey=await surveysApi.get(requestedId);prepareItems();
                if(items.some(item=>item.id===previous))state.selectedId=previous;
                renderHeader();renderInformation();renderActivity();setTab(state.tab);
            }catch(error){api.report(error,'surveys');}finally{loading=false;}
        }
        try{if(await window.HospitalAuth.ready)await reload();}catch(error){api.report(error,'surveys');}
        prepareItems();renderHeader();renderInformation();renderActivity();setTab(new URLSearchParams(location.search).get('tab')==='form'?'form':'summary');
        document.querySelectorAll('[data-share-survey]').forEach(button=>button.addEventListener('click',async()=>{if(survey)try{await surveysApi.share(survey,record=>{survey=record;renderHeader();});}catch(error){api.report(error,'surveys');}}));
        $('survey-transition').addEventListener('click',async()=>{if(!survey||loading)return;loading=true;try{survey=await surveysApi.transition(survey,$('survey-transition').dataset.action);renderHeader();renderInformation();}catch(error){api.report(error,'surveys');}finally{loading=false;}});
        setInterval(()=>{if(!document.hidden)reload();},15000);window.addEventListener('focus',reload);
        document.querySelector('.insight-tabs').addEventListener('click', event => { const button = event.target.closest('[data-insight-tab]'); if (button) setTab(button.dataset.insightTab); });
        document.querySelector('.insight-tabs').addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const tabs = ['summary', 'questions', 'form'], index = tabs.indexOf(state.tab);
            setTab(event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[2] : tabs[(index + (event.key === 'ArrowRight' ? 1 : 2)) % 3], true);
        });
        $('view-form').addEventListener('click', () => setTab('form', true));
        $('more-survey-info').addEventListener('click', openInformation);
        document.querySelectorAll('[data-close-info]').forEach(button => button.addEventListener('click', () => $('survey-info-dialog').close()));
        $('view-question-search').addEventListener('input', event => { state.query = event.target.value; state.navPage = 1; renderNavigation(); });
        document.querySelector('.survey-insights').addEventListener('click', event => {
            const go = event.target.closest('[data-go-tab]'); if (go) setTab(go.dataset.goTab, true);
            const open = event.target.closest('[data-open-question]'); if (open) { state.selectedId = open.dataset.openQuestion; state.resultPage = 1; state.answerQuery = ''; state.query = ''; $('view-question-search').value = ''; setTab('questions', true); }
            const select = event.target.closest('[data-select-question]'); if (select) { selectQuestion(select.dataset.selectQuestion); $('question-navigation-list').querySelector('[aria-pressed=true]')?.focus(); }
            for (const [attribute, key, render] of [['overviewPage', 'overviewPage', renderOverview], ['navPage', 'navPage', renderNavigation], ['resultPage', 'resultPage', renderQuestionResults]]) {
                const button = event.target.closest(`[data-${attribute.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}]`);
                if (button && !button.disabled) {
                    const selector = `[data-${attribute.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}]:not(:disabled)`;
                    state[key] = Number(button.dataset[attribute]); render();
                    document.querySelector(selector)?.focus();
                }
            }
            const entryButton=event.target.closest('[data-entry-page]');if(entryButton&&!entryButton.disabled){entryPage=Number(entryButton.dataset.entryPage);renderAnswerEntries(selected());}
            const movement = event.target.closest('[data-previous-question],[data-next-question]');
            if (movement && !movement.disabled) { const list = availableItems(), index = list.findIndex(item => item.id === state.selectedId); selectQuestion(list[index + (movement.hasAttribute('data-next-question') ? 1 : -1)].id); }
        });
        $('question-results-content').addEventListener('input', event => { if (event.target.id === 'answer-search') { state.answerQuery = event.target.value; entryPage=1;clearTimeout(answerTimer);answerTimer=setTimeout(()=>renderAnswerEntries(selected()),200); } });
        let pointerSelect = false;
        $('mobile-question').addEventListener('pointerdown', () => { pointerSelect = true; });
        $('mobile-question').addEventListener('keydown', () => { pointerSelect = false; });
        $('mobile-question').addEventListener('blur', () => { pointerSelect = false; });
        $('mobile-question').addEventListener('change', event => { const pointer = pointerSelect; selectQuestion(event.target.value); if (pointer) event.target.blur(); });
        new ResizeObserver(() => {
            if (innerWidth <= 900) return;
            if (state.tab === 'summary' && overviewPageSize() !== renderedOverviewSize) renderOverview();
            if (state.tab !== 'summary') {
                if (navigationPageSize() !== renderedNavigationSize) { showSelectedPage(); renderNavigation(); }
                const item = selected();
                if (state.tab === 'questions' && item && ['single_choice', 'multiple_choice', 'short_text', 'long_text', 'date'].includes(item.type) && (['single_choice', 'multiple_choice'].includes(item.type) ? resultPageSize() : textPageSize()) !== renderedResultSize) renderQuestionResults();
            }
        }).observe(document.querySelector('.insight-body'));
    });
})();
