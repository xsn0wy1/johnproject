(() => {
    'use strict';

    // Authorized SQL records and aggregates supply this screen.
    // No hospital records, responses or browser draft storage are seeded here.
    let survey = null;
    const api=window.HospitalApi,surveysApi=window.HospitalSurveys;
    let loading=false,entryRevision=0,entryPage=1,answerTimer;
    const requestedId = new URLSearchParams(location.search).get('id');
    const categories = { get patient_care() { return window.HospitalI18n.t("survey.atencion_al_paciente"); }, get transfers() { return window.HospitalI18n.t("survey.traslados"); }, get emergency() { return window.HospitalI18n.t("survey.emergencias"); }, get staff() { return window.HospitalI18n.t("trace_view.personal"); }, get other() { return window.HospitalI18n.t("survey.otras"); } };
    const audiences = { get patients() { return window.HospitalI18n.t("management.pacientes"); }, get staff() { return window.HospitalI18n.t("trace_view.personal"); }, get everyone() { return window.HospitalI18n.t("survey_new.pacientes_y_personal"); } };
    const statuses = { get draft() { return window.HospitalI18n.t("shared.borrador"); }, get published() { return window.HospitalI18n.t("shared.activa"); }, get closed() { return window.HospitalI18n.t("shared.finalizada"); }, get archived() { return window.HospitalI18n.t("shared.archivada"); } };
    const types = {
        get short_text() { return { get label() { return window.HospitalI18n.t("survey_view.respuesta_corta"); }, icon: 'document-icon.svg' }; },
        get long_text() { return { get label() { return window.HospitalI18n.t("survey_view.respuesta_larga"); }, icon: 'document-icon.svg' }; },
        get single_choice() { return { get label() { return window.HospitalI18n.t("survey_view.opcion_multiple"); }, icon: 'multiple-choice.svg' }; },
        get multiple_choice() { return { get label() { return window.HospitalI18n.t("survey_view.casillas"); }, icon: 'cages-icon.svg' }; },
        get rating() { return { get label() { return window.HospitalI18n.t("survey_view.calificacion"); }, icon: 'star-icon.svg' }; },
        get linear_scale() { return { get label() { return window.HospitalI18n.t("survey_view.escala"); }, icon: 'analytics-icon.svg' }; },
        get date() { return { get label() { return window.HospitalI18n.t("documents.fecha"); }, icon: 'calendar-icon.svg' }; },
        get section() { return { get label() { return window.HospitalI18n.t("survey_view.titulo_y_texto"); }, icon: 'document-icon.svg', element: true }; },
        get divider() { return { get label() { return window.HospitalI18n.t("survey_view.separador"); }, icon: 'layers-icon.svg', element: true }; }
    };
    const state = { tab: 'summary', selectedId: null, query: '', answerQuery: '', navPage: 1, overviewPage: 1, resultPage: 1 };
    const $ = id => document.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const icon = name => `<img src="../../../assets/Icons/${name}" alt="">`;
    const numberFormat = { format: (...args) => new Intl.NumberFormat(window.HospitalI18n.locale, { maximumFractionDigits: 1 }).format(...args) };
    const dateFormat = { format: (...args) => new Intl.DateTimeFormat(window.HospitalI18n.locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Montevideo' }).format(...args) };
    const count = value => value === null || value === undefined || value === '' ? null : Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
    const displayCount = value => count(value) === null ? '—' : numberFormat.format(Number(value));
    const config = () => survey?.config || {};
    let items = [], renderedOverviewSize = null, renderedNavigationSize = null, renderedResultSize = null;

    function dateText(value) {
        if (!value) return window.HospitalI18n.t("survey_view.sin_definir");
        if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(value)) {
            const [date, time] = value.split('T'), [year, month, day] = date.split('-');
            return `${window.HospitalI18n.date(date+'T12:00:00Z',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'})}${time ? ` · ${time}` : ''}`;
        }
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? window.HospitalI18n.t("survey_view.sin_definir") : dateFormat.format(date);
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
    const questionTitle = item => item.title || (item.type === 'divider' ? window.HospitalI18n.t("survey_view.separador") : item.type === 'section' ? window.HospitalI18n.t("survey_view.seccion_sin_titulo") : window.HospitalI18n.t("survey_view.pregunta_sin_titulo"));
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
        return `<div class="insight-empty"><span class="survey-icon violet">${icon(image)}</span><h3>${escape(title)}</h3><p>${escape(description)}</p>${back ? `<a href="survey.html">${window.HospitalI18n.mark("survey_view.volver_a_encuestas_2")}</a>` : ''}</div>`;
    }
    function paging(current, pages, attribute) {
        return pages <= 1 ? '' : `<button type="button" ${attribute}="${current - 1}" aria-label="${window.HospitalI18n.html("trace.pagina_anterior")}" data-i18n-aria-label="trace.pagina_anterior" ${current <= 1 ? 'disabled' : ''}>‹</button><span>${current} / ${pages}</span><button type="button" ${attribute}="${current + 1}" aria-label="${window.HospitalI18n.html("trace.pagina_siguiente")}" data-i18n-aria-label="trace.pagina_siguiente" ${current >= pages ? 'disabled' : ''}>›</button>`;
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
        window.HospitalI18n.bindText($('survey-view-title'), () => survey?.title || window.HospitalI18n.t("survey_view.detalle_de_encuesta"));
        window.HospitalI18n.bindAttr($('survey-view-title'), "title", () => survey?.title || '');
        window.HospitalI18n.bindText($('view-category'), () => survey ? (categories)[survey.category] || window.HospitalI18n.t("survey_view.sin_categoria") : window.HospitalI18n.t("survey_view.contenido_y_respuestas"));
        $('view-status').hidden = !statuses[survey?.status];
        if (statuses[survey?.status]) { $('view-status').className = `survey-status ${survey.status}`; window.HospitalI18n.bindText($('view-status'), () => (statuses)[survey.status]); }
        window.HospitalI18n.bindText($('survey-reference'), () => survey?.id ? window.HospitalI18n.t("survey_view.id_value", {value0: survey.id}) : '');
        const edit = $('detail-edit-survey');
        if (survey?.id) { edit.href = `survey-new.html?id=${encodeURIComponent(survey.id)}`; edit.removeAttribute('aria-disabled'); edit.removeAttribute('tabindex'); }
        else { edit.removeAttribute('href'); edit.setAttribute('aria-disabled', 'true'); edit.tabIndex = -1; }
        $('view-form').disabled = !items.length;
        $('more-survey-info').disabled = !survey;
        document.querySelectorAll('[data-share-survey]').forEach(button=>button.disabled=!survey?.published_at||!!survey?.archived_at);
        const toggle=$('survey-transition');toggle.hidden=!survey||!!survey.archived_at;
        if(survey){toggle.dataset.action=survey.lifecycle==='draft'?'publish':survey.lifecycle==='closed'?'reopen':'close';window.HospitalI18n.bindText(toggle, () => survey.lifecycle==='draft'?window.HospitalI18n.t("survey_view.publicar"):survey.lifecycle==='closed'?window.HospitalI18n.t("survey_view.reabrir"):window.HospitalI18n.t("survey_view.cerrar_encuesta"));}
        window.HospitalI18n.bindText($('view-response-count'), () => displayCount(survey?.response_count));
        window.HospitalI18n.bindText($('view-response-caption'), () => survey?.updated_at ? window.HospitalI18n.t("survey_view.ultima_actividad_value", {value0: dateText(survey.updated_at)}) : window.HospitalI18n.t("survey_view.de_esta_encuesta"));
        window.HospitalI18n.bindText($('view-question-count'), () => survey ? questions().length : '—');
        window.HospitalI18n.bindText($('view-required-count'), () => survey ? window.HospitalI18n.t("survey_view.value_obligatorias_value_elementos", {value0: questions().filter(item => item.required).length, value1: items.length - questions().length}) : window.HospitalI18n.t("survey_view.contenido_del_formulario"));
        const rating = survey?.average_rating, scale = Number(survey?.rating_scale);
        const hasRating = count(survey?.response_count) > 0 && rating !== undefined && rating !== null && Number.isFinite(Number(rating)) && scale > 0 && Number(rating) >= 0 && Number(rating) <= scale;
        window.HospitalI18n.bindText($('view-rating'), () => hasRating ? numberFormat.format(Number(rating)) : '—');
        window.HospitalI18n.bindText($('view-rating-caption'), () => hasRating ? window.HospitalI18n.t("survey_view.sobre_value_puntos", {value0: scale}) : window.HospitalI18n.t("survey_view.sin_valoraciones_disponibles"));
        const maximum = config().limit_enabled ? count(config().response_limit) : null, responses = count(survey?.response_count);
        window.HospitalI18n.bindText($('view-capacity'), () => maximum > 0 && responses !== null ? `${numberFormat.format(responses / maximum * 100)}%` : '—');
        window.HospitalI18n.bindText($('view-capacity-caption'), () => maximum > 0 ? window.HospitalI18n.t("survey_view.value_de_value_respuestas", {value0: displayCount(responses), value1: displayCount(maximum)}) : survey && config().limit_enabled === false ? window.HospitalI18n.t("survey_view.sin_limite_de_respuestas") : window.HospitalI18n.t("survey_view.respuestas_cupo_maximo"));
        window.HospitalI18n.bindTitle(() => window.HospitalI18n.t("survey_view.value_hospital_de_clinicas", {value0: survey?.title || window.HospitalI18n.t("survey_view.detalle_de_encuesta")}));
    }
    function informationRows() {
        return [[window.HospitalI18n.t("survey.categoria"), categories[survey?.category] || window.HospitalI18n.t("survey_view.sin_definir")], [window.HospitalI18n.t("survey_new.dirigida_a"), audiences[config().audience || survey?.audience] || window.HospitalI18n.t("survey_view.sin_definir")], [window.HospitalI18n.t("survey.creada"), dateText(survey?.created_at)], [window.HospitalI18n.t("survey_new.responsable"), survey?.owner_name || window.HospitalI18n.t("survey_view.sin_definir")], [window.HospitalI18n.t("shared.apertura"), config().opens_enabled ? dateText(config().opens_at) : config().opens_enabled === false ? window.HospitalI18n.t("survey_view.al_publicar") : window.HospitalI18n.t("survey_view.sin_definir")], [window.HospitalI18n.t("shared.cierre"), config().closes_enabled ? dateText(config().closes_at) : config().closes_enabled === false ? window.HospitalI18n.t("survey_view.sin_fecha_de_cierre") : window.HospitalI18n.t("survey_view.sin_definir")]];
    }
    const definitionList = rows => `<dl class="information-fields">${rows.map(([name, value]) => `<div><dt>${escape(name)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`;
    function renderInformation() {
        window.HospitalI18n.setHTML($('survey-information'), `${survey?.description ? `<p class="information-description">${escape(survey.description)}</p>` : ''}${definitionList(informationRows())}`);
        window.HospitalI18n.bindText($('access-caption'), () => survey ? `${config().access === 'individual_link' ? window.HospitalI18n.t("survey_new.invitacion_individual") : config().access === 'shared_link' ? window.HospitalI18n.t("survey_new.enlace_compartido") : window.HospitalI18n.t("survey_view.acceso_sin_definir")} · ${config().identity === 'anonymous' ? window.HospitalI18n.t("survey_view.respuestas_anonimas") : config().identity === 'optional_name' ? window.HospitalI18n.t("survey_new.nombre_opcional") : window.HospitalI18n.t("survey_view.identificacion_sin_definir")}` : window.HospitalI18n.t("survey_view.enlace_y_codigo_de_acceso_de_la_encuesta"));
    }
    function renderActivity() {
        const activity = Array.isArray(survey?.activity) ? survey.activity.filter(day => day.date && count(day.count) !== null).slice(-7) : [];
        if (!activity.length) {
            window.HospitalI18n.setHTML($('survey-activity'), !survey ? empty(window.HospitalI18n.t("survey_view.selecciona_una_encuesta"), window.HospitalI18n.t("survey_view.abri_una_encuesta_desde_el_listado_para_consultar_su_contenido_y_sus_respuestas"), 'survey-answers.svg', true) : count(survey.response_count) === 0 ? empty(window.HospitalI18n.t("survey_view.aun_no_hay_respuestas"), window.HospitalI18n.t("survey_view.la_participacion_se_mostrara_cuando_lleguen_las_primeras_respuestas"), 'survey-answers.svg') : empty(window.HospitalI18n.t("survey_view.participacion_por_fecha"), window.HospitalI18n.t("survey_view.el_detalle_por_fecha_aparecera_cuando_este_disponible"), 'calendar-icon.svg'));
            window.HospitalI18n.bindText($('activity-caption'), () => window.HospitalI18n.t("survey_view.respuestas_recibidas"));
            return;
        }
        const maximum = Math.max(...activity.map(day => Number(day.count)), 1);
        window.HospitalI18n.bindText($('activity-caption'), () => window.HospitalI18n.t("survey_view.ultimas_fechas_con_datos"));
        window.HospitalI18n.setHTML($('survey-activity'), `<div class="activity-bars" style="--activity-columns:${activity.length}" role="img" aria-label="${window.HospitalI18n.html("survey_view.respuestas_por_fecha_value", {value0: activity.map(day => `${dateText(day.date)}: ${day.count}`).join('; ')})}" data-i18n-aria-label="survey_view.respuestas_por_fecha_value" data-i18n-aria-label-params="${window.HospitalI18n.escape(JSON.stringify({value0: activity.map(day => `${dateText(day.date)}: ${day.count}`).join('; ')}))}">${activity.map(day => `<div class="activity-day"><strong>${displayCount(day.count)}</strong><div class="activity-track"><span class="activity-fill" style="--bar-height:${Number(day.count) / maximum * 100}%;opacity:${Number(day.count) > 0 ? 1 : 0}"></span></div><span title="${escape(dateText(day.date))}">${escape(dateText(day.date).slice(0, 5))}</span></div>`).join('')}</div>`);
    }
    function renderOverview() {
        const list = questions();
        renderedOverviewSize = overviewPageSize();
        const pages = Math.max(1, Math.ceil(list.length / renderedOverviewSize));
        state.overviewPage = Math.max(1, Math.min(state.overviewPage, pages));
        const start = (state.overviewPage - 1) * renderedOverviewSize;
        window.HospitalI18n.bindText($('overview-question-count'), () => survey ? list.length : '');
        $('overview-question-count').hidden = !survey;
        $('question-overview-list').style.setProperty('--overview-rows', renderedOverviewSize);
        window.HospitalI18n.setHTML($('question-overview-list'), list.length ? list.slice(start, start + renderedOverviewSize).map(item => {
            const result = resultFor(item), mean = average(item, result);
            return `<button type="button" class="overview-question" data-open-question="${escape(item.id)}"><span class="overview-question-copy"><span class="question-index-number">${questionNumber(item)}</span><span><strong title="${escape(questionTitle(item))}">${escape(questionTitle(item))}</strong><small>${types[item.type].label} · ${item.required ? window.HospitalI18n.t("survey_view.obligatoria") : window.HospitalI18n.t("routes.opcional")}</small></span></span><span>${displayCount(result?.answer_count)}</span><span>${mean === null ? '—' : numberFormat.format(mean)}</span></button>`;
        }).join('') : empty(window.HospitalI18n.t("survey_view.contenido_de_la_encuesta"), window.HospitalI18n.t("survey_view.las_preguntas_y_sus_resultados_apareceran_aca"), 'list-icon.svg'));
        window.HospitalI18n.bindText($('overview-range'), () => list.length ? window.HospitalI18n.t("survey_view.value_value_de_value_preguntas", {value0: start + 1, value1: Math.min(list.length, start + renderedOverviewSize), value2: list.length}) : window.HospitalI18n.t("survey_view.sin_preguntas_disponibles"));
        window.HospitalI18n.setHTML($('overview-pagination'), paging(state.overviewPage, pages, 'data-overview-page'));
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
        window.HospitalI18n.bindText($('question-nav-title'), () => state.tab === 'form' ? window.HospitalI18n.t("shared.contenido") : window.HospitalI18n.t("survey_view.preguntas"));
        window.HospitalI18n.bindText($('question-nav-count'), () => availableItems().length);
        $('question-navigation-list').style.setProperty('--navigation-rows', renderedNavigationSize);
        window.HospitalI18n.setHTML($('question-navigation-list'), list.length ? list.slice(start, start + renderedNavigationSize).map(item => `<button type="button" class="question-nav-button" data-select-question="${escape(item.id)}" aria-pressed="${item.id === state.selectedId}"><span class="question-index-number">${questionNumber(item)}</span><span><strong title="${escape(questionTitle(item))}">${escape(questionTitle(item))}</strong><small>${types[item.type].label}</small></span></button>`).join('') : empty(state.query ? window.HospitalI18n.t("survey_view.sin_coincidencias") : window.HospitalI18n.t("survey_view.sin_preguntas"), state.query ? window.HospitalI18n.t("survey_view.proba_con_otra_busqueda") : window.HospitalI18n.t("survey_view.el_contenido_aparecera_al_seleccionar_una_encuesta"), 'list-icon.svg'));
        window.HospitalI18n.bindText($('question-nav-range'), () => list.length ? window.HospitalI18n.t("survey_view.value_value_de_value", {value0: start + 1, value1: Math.min(list.length, start + renderedNavigationSize), value2: list.length}) : window.HospitalI18n.t("survey_new.0_preguntas"));
        window.HospitalI18n.setHTML($('question-nav-pagination'), paging(state.navPage, pages, 'data-nav-page'));
        window.HospitalI18n.setHTML($('mobile-question'), availableItems().length ? availableItems().map(item => `<option value="${escape(item.id)}" ${item.id === state.selectedId ? 'selected' : ''}>${questionNumber(item)}. ${escape(questionTitle(item))}</option>`).join('') : `<option data-i18n="survey_view.sin_preguntas_disponibles">${window.HospitalI18n.html("survey_view.sin_preguntas_disponibles")}</option>`);
        $('mobile-question').disabled = !availableItems().length;
    }
    function renderQuestionFooter() {
        const list = availableItems(), index = list.findIndex(item => item.id === state.selectedId);
        document.querySelectorAll('[data-previous-question]').forEach(button => { button.disabled = index <= 0; });
        document.querySelectorAll('[data-next-question]').forEach(button => { button.disabled = index < 0 || index >= list.length - 1; });
        document.querySelectorAll('.selected-question-position').forEach(label => { window.HospitalI18n.bindText(label, () => index < 0 ? window.HospitalI18n.t("survey_view.sin_preguntas") : window.HospitalI18n.t("survey_view.value_de_value", {value0: index + 1, value1: list.length})); });
    }
    function renderChoiceResult(item, result) {
        const values = [...item.options, ...(item.other ? [window.HospitalI18n.t("trace_new.otro")] : [])], size = resultPageSize();
        renderedResultSize = size;
        const pages = Math.max(1, Math.ceil(values.length / size));
        state.resultPage = Math.max(1, Math.min(state.resultPage, pages));
        const start = (state.resultPage - 1) * size, answered = count(result?.answer_count);
        window.HospitalI18n.setHTML($('question-results-content'), `<div class="result-bar-list">${values.slice(start, start + size).map(option => {
            const total = binCount(result, option), percent = total === null || answered === null ? null : answered === 0 ? 0 : total / answered * 100;
            return `<div class="result-bar"><div class="result-bar-label"><span>${escape(option)}</span><span>${displayCount(total)} · ${percent === null ? '—' : `${numberFormat.format(percent)}%`}</span></div><div class="result-bar-track"><div class="result-bar-fill" style="--bar-width:${Math.max(0, Math.min(100, percent || 0))}%"></div></div></div>`;
        }).join('')}</div><p class="result-note">${item.type === 'multiple_choice' ? window.HospitalI18n.t("survey_view.cada_respuesta_puede_incluir_varias_opciones") : answered === 0 ? window.HospitalI18n.t("survey_view.esta_pregunta_todavia_no_tiene_respuestas") : !result ? window.HospitalI18n.t("survey_view.sin_desglose_de_respuestas_disponible") : window.HospitalI18n.t("survey_view.porcentaje_sobre_las_respuestas_a_esta_pregunta")}</p><div class="result-data-footer"><span>${window.HospitalI18n.mark("survey_view.value_opciones", {value0: values.length})}</span><nav class="survey-pagination" aria-label="${window.HospitalI18n.html("survey_view.paginas_de_opciones")}" data-i18n-aria-label="survey_view.paginas_de_opciones">${paging(state.resultPage, pages, 'data-result-page')}</nav></div>`);
    }
    function renderScaleResult(item, result) {
        const first = item.type === 'rating' ? 1 : item.scale_min, last = item.type === 'rating' ? item.rating_max : item.scale_max;
        const values = Array.from({ length: last - first + 1 }, (_, index) => first + index), bins = values.map(value => binCount(result, value)), maximum = Math.max(...bins.map(value => value || 0), 1);
        window.HospitalI18n.setHTML($('question-results-content'), `<div class="result-histogram" style="--distribution-columns:${values.length}" role="img" aria-label="${window.HospitalI18n.html("survey_view.distribucion_value", {value0: values.map((value, index) => `${value}: ${displayCount(bins[index])}`).join('; ')})}" data-i18n-aria-label="survey_view.distribucion_value" data-i18n-aria-label-params="${window.HospitalI18n.escape(JSON.stringify({value0: values.map((value, index) => `${value}: ${displayCount(bins[index])}`).join('; ')}))}">${values.map((value, index) => `<div class="histogram-column"><strong>${displayCount(bins[index])}</strong><div class="histogram-track"><span class="histogram-fill" style="--bar-height:${(bins[index] || 0) / maximum * 100}%;opacity:${bins[index] > 0 ? 1 : 0}"></span></div><span>${item.type === 'rating' ? '☆ ' : ''}${value}</span></div>`).join('')}</div>${item.type === 'linear_scale' ? `<div class="scale-result-ends"><span>${escape(item.scale_start || '')}</span><span>${escape(item.scale_end || '')}</span></div>` : ''}<p class="result-note">${count(result?.answer_count) === 0 ? window.HospitalI18n.t("survey_view.esta_pregunta_todavia_no_tiene_respuestas") : !result ? window.HospitalI18n.t("survey_view.sin_desglose_de_respuestas_disponible") : window.HospitalI18n.t("survey_view.distribucion_de_las_respuestas_en_una_escala_de_value_a_value", {value0: first, value1: last})}</p>`);
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
            window.HospitalI18n.setHTML($('written-answer-list'), result.data.length?result.data.map((entry,index)=>`<article class="written-answer"><span>${window.HospitalI18n.mark("survey_view.respuesta_valuevaluevalue", {value0: (entryPage-1)*size+index+1, value1: entry.submitted_at?' · '+escape(dateText(entry.submitted_at)):'', value2: entry.participant_name?' · '+escape(entry.participant_name):''})}</span><p>${escape(item.type==='date'?dateText(entry.value):entry.value)}</p></article>`).join(''):empty(state.answerQuery?window.HospitalI18n.t("survey_view.sin_coincidencias"):window.HospitalI18n.t("survey_view.aun_no_hay_respuestas_escritas"),state.answerQuery?window.HospitalI18n.t("survey_view.proba_con_otra_busqueda"):window.HospitalI18n.t("survey_view.las_respuestas_se_mostraran_aca")));
            window.HospitalI18n.bindText($('written-answer-range'), () => total?window.HospitalI18n.t("survey_view.value_value_de_value", {value0: (entryPage-1)*size+1, value1: Math.min(total,entryPage*size), value2: total}):window.HospitalI18n.t("survey_view.0_respuestas"));
            window.HospitalI18n.setHTML($('written-answer-pagination'), paging(entryPage,pages,'data-entry-page'));
        }catch(error){api.report(error,'survey-results');}
    }
    function writtenContainer(item) {
        return `<label class="survey-search answer-search">${icon('search-icon.svg')}<input type="search" id="answer-search" placeholder="${window.HospitalI18n.html("survey_view.buscar_en_las_respuestas")}" data-i18n-placeholder="survey_view.buscar_en_las_respuestas" aria-label="${window.HospitalI18n.html("survey_view.buscar_en_las_respuestas_2")}" data-i18n-aria-label="survey_view.buscar_en_las_respuestas_2" maxlength="150" value="${escape(state.answerQuery)}"></label><div class="written-answer-list" id="written-answer-list"></div><div class="result-data-footer"><span id="written-answer-range"></span><nav class="survey-pagination" id="written-answer-pagination" aria-label="${window.HospitalI18n.html("survey_view.paginas_de_respuestas")}" data-i18n-aria-label="survey_view.paginas_de_respuestas"></nav></div>`;
    }
    function renderQuestionResults() {
        const item = selected();
        if (!item || types[item.type].element) {
            window.HospitalI18n.setHTML($('selected-question-heading'), `<h2>${window.HospitalI18n.mark("survey_view.resultados_por_pregunta")}</h2>`);
            window.HospitalI18n.setHTML($('question-result-metrics'), '');
            window.HospitalI18n.setHTML($('question-results-content'), empty(window.HospitalI18n.t("survey_view.selecciona_una_pregunta"), window.HospitalI18n.t("survey_view.consulta_el_desglose_de_respuestas_las_valoraciones_y_los_comentarios_de_cada_pregunta"), 'analytics-icon.svg'));
            renderQuestionFooter();
            return;
        }
        const result = resultFor(item), mean = average(item, result), scale = item.type === 'rating' ? item.rating_max : item.scale_max;
        window.HospitalI18n.setHTML($('selected-question-heading'), `<div class="question-kind">${icon(types[item.type].icon)}<span>${types[item.type].label}</span><span>${item.required ? window.HospitalI18n.t("survey_view.obligatoria") : window.HospitalI18n.t("routes.opcional")}</span></div><h2>${questionNumber(item)}. ${escape(questionTitle(item))}</h2>`);
        window.HospitalI18n.setHTML($('question-result-metrics'), `<div><span>${window.HospitalI18n.mark("survey_view.respuestas")}</span><strong>${displayCount(result?.answer_count)}</strong></div><div><span>${window.HospitalI18n.mark("survey_view.sin_responder")}</span><strong>${displayCount(result?.skipped_count)}</strong></div>${['rating', 'linear_scale'].includes(item.type) ? `<div><span>${window.HospitalI18n.mark("survey_view.promedio")}</span><strong>${mean === null ? '—' : numberFormat.format(mean)}<small>/ ${scale}</small></strong></div>` : ''}`);
        if (['single_choice', 'multiple_choice'].includes(item.type)) {renderChoiceResult(item,result);if(item.other){$('question-results-content').insertAdjacentHTML('beforeend',`<details><summary>${window.HospitalI18n.mark("survey_view.respuestas_otro")}</summary>`+writtenContainer(item)+'</details>');renderAnswerEntries(item);}}
        else if (['rating', 'linear_scale'].includes(item.type)) renderScaleResult(item, result);
        else {
            window.HospitalI18n.setHTML($('question-results-content'), writtenContainer(item));
            renderAnswerEntries(item);
        }
        renderQuestionFooter();
    }
    function renderForm() {
        window.HospitalI18n.bindText($('public-form-title'), () => survey?.form_title || survey?.form?.title || survey?.title || window.HospitalI18n.t("survey_view.contenido_del_formulario"));
        // Internal descriptions and notes never become participant-facing copy.
        window.HospitalI18n.bindText($('public-form-introduction'), () => survey?.form_description || survey?.form?.introduction || '');
        const item = selected();
        if (!item) { window.HospitalI18n.setHTML($('public-form-content'), empty(window.HospitalI18n.t("survey_view.formulario_de_la_encuesta"), window.HospitalI18n.t("survey_view.selecciona_una_encuesta_desde_el_listado_para_recorrer_sus_preguntas"), 'survey-icon.svg', true)); renderQuestionFooter(); return; }
        let content;
        if (item.type === 'divider') content = `<hr class="form-divider"><p class="result-note">${window.HospitalI18n.mark("survey_view.separador_entre_secciones_del_formulario")}</p>`;
        else if (item.type === 'section') content = `<p class="form-section-text">${escape(item.description || '')}</p>`;
        else if (['short_text', 'long_text', 'date'].includes(item.type)) content = `<div class="form-answer-placeholder ${item.type === 'long_text' ? 'long' : ''}">${escape(item.type === 'date' ? window.HospitalI18n.t("survey_view.dia_mes_ano") : item.placeholder || window.HospitalI18n.t("survey_view.escribi_tu_respuesta"))}</div>`;
        else if (['single_choice', 'multiple_choice'].includes(item.type)) content = `<div class="form-choice-options">${[...item.options, ...(item.other ? [window.HospitalI18n.t("trace_new.otro")] : [])].map(option => `<div class="form-choice-option ${item.type === 'multiple_choice' ? 'multiple' : ''}"><i aria-hidden="true"></i><span>${escape(option)}</span></div>`).join('')}</div>`;
        else {
            const start = item.type === 'rating' ? 1 : item.scale_min, end = item.type === 'rating' ? item.rating_max : item.scale_max;
            content = `<div class="form-rating-options">${Array.from({ length: end - start + 1 }, (_, index) => `<span>${item.type === 'rating' ? icon('star-icon.svg') : ''}${start + index}</span>`).join('')}</div>${item.type === 'linear_scale' ? `<p class="scale-result-ends"><span>${escape(item.scale_start || '')}</span><span>${escape(item.scale_end || '')}</span></p>` : ''}`;
        }
        window.HospitalI18n.setHTML($('public-form-content'), `<article class="form-question"><div class="question-kind">${icon(types[item.type].icon)}${types[item.type].label}</div><h3>${types[item.type].element ? '' : `${questionNumber(item)}. `}${escape(questionTitle(item))}${item.required && !types[item.type].element ? ` <em aria-label="${window.HospitalI18n.html("survey_view.obligatoria")}" data-i18n-aria-label="survey_view.obligatoria">*</em>` : ''}</h3>${content}</article>`);
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
        window.HospitalI18n.bindText($('full-info-title'), () => survey.title || window.HospitalI18n.t("survey_view.informacion_de_la_encuesta"));
        window.HospitalI18n.setHTML($('full-survey-info'), `<h3>${window.HospitalI18n.mark("survey_new.descripcion_interna")}</h3><p>${escape(survey.description || window.HospitalI18n.t("survey_view.sin_descripcion"))}</p><h3>${window.HospitalI18n.mark("survey_new.notas_para_el_equipo")}</h3><p>${escape(survey.notes || survey.info?.notes || window.HospitalI18n.t("survey_view.sin_notas"))}</p>${definitionList([...informationRows(), [window.HospitalI18n.t("survey_new.servicio_o_area"), survey.area || survey.info?.area || window.HospitalI18n.t("survey_view.sin_definir")], [window.HospitalI18n.t("survey_view.cupo_maximo"), config().limit_enabled ? displayCount(config().response_limit) : config().limit_enabled === false ? window.HospitalI18n.t("survey_view.sin_limite") : window.HospitalI18n.t("survey_view.sin_definir")], [window.HospitalI18n.t("survey_new.mensaje_al_finalizar"), config().completion_message || window.HospitalI18n.t("survey_view.sin_definir")]])}`);
        $('survey-info-dialog').showModal();
    }

    document.addEventListener('DOMContentLoaded', async () => {
    await window.HospitalI18n.ready;
    await window.HospitalAuth.ready;
    window.addEventListener('hospital:localechange',()=>{renderHeader();renderInformation();renderActivity();setTab(state.tab);});

        if (requestedId && !/^[1-9]\d{0,18}$/.test(requestedId)) console.error(window.HospitalI18n.t("shared.encuestas_identificador_de_encuesta_invalido"));
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
