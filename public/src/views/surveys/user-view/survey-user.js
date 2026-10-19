(() => {
    'use strict';

    // Only participant fields are loaded. Answers stay in memory until an acknowledged SQL submission.
    let survey = null, submitting=false;
    const apiRoot=new URL('api/v1/surveys/public/',new URL('../../../../',document.currentScript.src));
    const accessToken=new URLSearchParams(location.hash.slice(1)).get('token');
    function report(error){console.error(window.HospitalI18n.t('survey_patient.log_context'),{code:error.code||'CLIENT_ERROR',status:error.status||0,message:error.message||window.HospitalI18n.t("survey_patient.no_se_pudo_completar_la_solicitud")});}
    async function request(path,body,csrf=false){
        const response=await fetch(new URL(path,apiRoot),{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json','X-Hospital-Locale':window.HospitalI18n.locale,...(csrf?{'X-CSRF-Token':survey.csrf_token}:{})},body:JSON.stringify(body)});
        let payload;try{payload=await response.json();}catch(_){throw new Error(window.HospitalI18n.t("survey_patient.el_servidor_no_devolvio_json_valido"));}
        if(!response.ok||payload.success!==true){const error=new Error(payload.error?.message||window.HospitalI18n.t("survey_patient.no_se_pudo_completar_la_solicitud"));error.status=response.status;error.code=payload.error?.code;throw error;}
        return payload.data;
    }
    async function submit(){
        if(submitting||state.mode!=='review'||!survey)return;
        if(questions.some(q=>!canContinue(q))){report(new Error(window.HospitalI18n.t("survey_patient.completa_las_preguntas_obligatorias")));return;}
        submitting=true;$('patient-form').inert=true;$('submit-answers').disabled=true;
        try{
            const answers=questions.filter(answered).map(q=>({question_id:q.id,value:state.answers.get(q.id),...(selectedOther(q)?{other_text:state.other.get(q.id).trim()}:{})}));
            const body={token:accessToken,version:survey.version,submit_token:survey.submit_token,answers,participant_name:survey.identity==='optional_name'?state.participantName:''};
            let result;
            try{result=await request('submit.php',body,true);}
            catch(error){if(error.code!=='CSRF_INVALID')throw error;const renewed=await request('get.php',{token:accessToken});survey.csrf_token=renewed.csrf_token;result=await request('submit.php',body,true);}
            if(!result.accepted)throw new Error(window.HospitalI18n.t("survey_patient.no_se_confirmo_el_envio"));
            state.mode='submitted';state.answers.clear();state.other.clear();state.participantName='';
            window.HospitalI18n.setHTML($('question-stage'), `<div class="survey-access-empty"><span class="large-survey-icon">${icon('survey-finished.svg')}</span><h2>${window.HospitalI18n.mark("survey_patient.respuestas_enviadas")}</h2><p>${escape(result.completion_message||window.HospitalI18n.t("survey_patient.gracias_por_responder_la_encuesta"))}</p></div>`);
            window.HospitalI18n.bindText($('question-stage').querySelector('p'),()=>result.completion_message||window.HospitalI18n.t('survey_patient.gracias_por_responder_la_encuesta'));
            $('survey-navigation').hidden=$('survey-progress').hidden=true;
        }catch(error){report(error);}
        finally{submitting=false;$('patient-form').inert=false;if(state.mode!=='submitted')updateProgress();}
    }
    const types = ['short_text', 'long_text', 'single_choice', 'multiple_choice', 'rating', 'linear_scale', 'date'];
    const state = { index: 0, mode: 'question', answers: new Map(), other: new Map(), optionPage: 1, reviewPage: 1, participantName: '', textSize: 0, contrast: false };
    const $ = id => document.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const icon = name => `<img src="../../../../assets/Icons/${name}" alt="">`;
    let questions = [], renderedOptionSize = null, renderedReviewSize = null, pointerInput = false;

    function prepareQuestions() {
        let context = null, divider = false;
        questions = [];
        for (const [index, source] of (Array.isArray(survey?.questions) ? survey.questions : []).slice(0, 20).entries()) {
            if (source.type === 'section') { context = { title: String(source.title || ''), description: String(source.description || '') }; continue; }
            if (source.type === 'divider') { divider = true; continue; }
            const type = { choice: 'single_choice', text: 'long_text' }[source.type] || source.type;
            if (!types.includes(type)) { console.error(window.HospitalI18n.t("shared.encuesta_tipo_de_pregunta_no_disponible")); continue; }
            questions.push({ id: String(source.id ?? `question-${index + 1}`), title: String(source.title || window.HospitalI18n.t("survey_view.pregunta_sin_titulo")), type, required: source.required === true, options: (Array.isArray(source.options) ? source.options.map(String) : String(source.options || '').split('\n').filter(Boolean)).slice(0, 10), other: source.other === true, placeholder: String(source.placeholder || ''), ratingMax: [3, 5, 10].includes(Number(source.rating_max)) ? Number(source.rating_max) : 5, scaleMin: Number(source.scale_min) === 0 ? 0 : 1, scaleMax: Math.max(2, Math.min(10, Number(source.scale_max) || 5)), scaleStart: String(source.scale_start || ''), scaleEnd: String(source.scale_end || ''), context, divider });
            context = null; divider = false;
        }
    }
    const current = () => questions[state.index];
    const isChoice = question => ['single_choice', 'multiple_choice'].includes(question.type);
    function selectedOther(question) {
        const value = state.answers.get(question.id);
        return question.type === 'multiple_choice' ? Array.isArray(value) && value.includes('other') : value === 'other';
    }
    function answered(question) {
        const value = state.answers.get(question.id);
        if (isChoice(question)) {
            const values = question.type === 'multiple_choice' ? Array.isArray(value) ? value : [] : value === undefined ? [] : [value];
            return values.length > 0 && values.every(option => option === 'other' ? question.other && Boolean(state.other.get(question.id)?.trim()) : /^\d+$/.test(option) && Number(option) < question.options.length);
        }
        if (['rating', 'linear_scale'].includes(question.type)) {
            const first = question.type === 'rating' ? 1 : question.scaleMin, last = question.type === 'rating' ? question.ratingMax : question.scaleMax;
            return Number.isInteger(value) && value >= first && value <= last;
        }
        return typeof value === 'string' && Boolean(value.trim());
    }
    function canContinue(question) {
        const value = state.answers.get(question.id);
        if (selectedOther(question) && !state.other.get(question.id)?.trim()) return false;
        return !question.required || answered(question) || value === undefined && !question.required;
    }
    function updateProgress() {
        const total = questions.length, done = questions.filter(answered).length;
        $('answer-progress').max = Math.max(1, total); $('answer-progress').value = done;
        window.HospitalI18n.bindAttr($('answer-progress'), "aria-valuetext", () => window.HospitalI18n.t("survey_patient.value_de_value_preguntas_respondidas", {value0: done, value1: total}));
        window.HospitalI18n.bindText($('progress-answers'), () => window.HospitalI18n.t("survey_patient.value_de_value_respondidas", {value0: done, value1: total}));
        $('next-question').disabled = !current() || !canContinue(current());
        $('submit-answers').disabled=submitting||questions.some(q=>!canContinue(q));
        const hint = $('question-instructions');
        if (hint && current() && isChoice(current())) {
            const value = state.answers.get(current().id), count = current().type === 'multiple_choice' ? (Array.isArray(value) ? value.length : 0) : value === undefined ? 0 : 1;
            window.HospitalI18n.bindText(hint, () => `${current().type === 'multiple_choice' ? window.HospitalI18n.t("survey_patient.podes_marcar_mas_de_una_opcion") : window.HospitalI18n.t("survey_patient.elegi_una_opcion")}${count ? window.HospitalI18n.t('survey_patient.selected_count',{count}) : ''}`);
        }
    }
    function renderIntroduction() {
        const accent={blue:['182,177,246','#b6b1f6'],green:['119,210,171','#a0e2c2'],cyan:['111,202,222','#a2deeb'],amber:['224,188,118','#efd49e'],rose:['224,146,175','#edb3cc'],slate:['159,179,212','#bfcfe8']}[survey?.color];
        if(accent){document.documentElement.style.setProperty('--patient-accent-rgb',accent[0]);document.documentElement.style.setProperty('--patient-accent',accent[1]);}
        window.HospitalI18n.bindText($('patient-survey-title'), () => survey?.title || window.HospitalI18n.t("survey_patient.encuestas_del_hospital"));
        window.HospitalI18n.bindText($('patient-survey-introduction'), () => survey?.description || window.HospitalI18n.t("survey_patient.tu_opinion_nos_ayuda_a_mejorar_la_atencion"));
        window.HospitalI18n.bindText($('full-public-introduction'), () => survey?.description || '');
        $('survey-public-description').hidden = !survey?.description;
        window.HospitalI18n.bindText($('survey-public-notice'), () => survey?.privacy_notice || window.HospitalI18n.t("survey_patient.consulta_con_el_personal_del_hospital_si_queres_saber_como_se_utilizaran_tus_respuestas"));
        window.HospitalI18n.bindText($('patient-privacy-caption'), () => survey?.identity === 'anonymous' ? window.HospitalI18n.t("survey_patient.esta_encuesta_no_pide_tu_nombre") : window.HospitalI18n.t("survey_patient.revisa_tus_respuestas_antes_de_finalizar"));
        const facts = questions.length ? [`<span>${icon('list-icon.svg')}${questions.length} ${questions.length === 1 ? window.HospitalI18n.t("survey.pregunta") : window.HospitalI18n.t("survey_new.preguntas")}</span>`] : [];
        if (Number.isInteger(survey?.estimated_minutes) && survey.estimated_minutes > 0) facts.unshift(`<span title="${window.HospitalI18n.html("trace_view.tiempo_estimado")}" data-i18n-title="trace_view.tiempo_estimado">${(icon('time-icon.svg') + window.HospitalI18n.mark("trace_view.value_min", {value0: survey.estimated_minutes}))}</span>`);
        if (survey?.identity === 'anonymous') facts.push(`<span>${icon('person-icon.svg')}${window.HospitalI18n.mark("survey_patient.sin_nombre")}</span>`);
        window.HospitalI18n.setHTML($('survey-facts'), facts.join('')); $('survey-facts').hidden = !facts.length;
        window.HospitalI18n.bindTitle(() => window.HospitalI18n.t("survey_view.value_hospital_de_clinicas", {value0: survey?.title || window.HospitalI18n.t("main_menu.encuestas")}));
    }
    function optionPageSize() {
        if (innerWidth <= 900) return 4;
        const stage = $('question-stage'), heading = stage.querySelector('.question-heading'), context = stage.querySelector('.question-context'), skip = stage.querySelector('.skip-question'), other = $('other-answer');
        const style = getComputedStyle(stage), gap = parseFloat(style.gap) || 0;
        const blocks = [heading, context, skip, other && !other.hidden ? other : null].filter(Boolean);
        const fixed = blocks.reduce((height, block) => height + block.offsetHeight, 0) + gap * blocks.length + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        const available = stage.clientHeight - fixed, row = parseFloat(style.getPropertyValue('--option-row-height')) || 60, optionGap = parseFloat(style.getPropertyValue('--option-row-gap')) || 7;
        const total = current().options.length + Number(current().other);
        if (total <= 5 && total * (row + optionGap) - optionGap + 6 <= available) return Math.max(1, total);
        return Math.max(1, Math.min(5, Math.floor((available - 38 - gap - 6 + optionGap) / (row + optionGap))));
    }
    function pageButtons(page, pages, attribute) {
        return pages <= 1 ? '' : `<nav class="patient-pagination" aria-label="${window.HospitalI18n.html("survey_patient.paginas_de_value", {value0: attribute === 'data-option-page' ? window.HospitalI18n.t("shared.opciones") : window.HospitalI18n.t("survey.respuestas")})}" data-i18n-aria-label="survey_patient.paginas_de_value" data-i18n-aria-label-params="${window.HospitalI18n.escape(JSON.stringify({value0: attribute === 'data-option-page' ? window.HospitalI18n.t("shared.opciones") : window.HospitalI18n.t("survey.respuestas")}))}"><button type="button" ${attribute}="${page - 1}" aria-label="${window.HospitalI18n.html("trace.pagina_anterior")}" data-i18n-aria-label="trace.pagina_anterior" ${page === 1 ? 'disabled' : ''}>‹</button><span>${page} / ${pages}</span><button type="button" ${attribute}="${page + 1}" aria-label="${window.HospitalI18n.html("trace.pagina_siguiente")}" data-i18n-aria-label="trace.pagina_siguiente" ${page === pages ? 'disabled' : ''}>›</button></nav>`;
    }
    function renderOptions() {
        const question = current(), choices = [...question.options.map((label, index) => ({ value: String(index), label })), ...(question.other ? [{ value: 'other', label: window.HospitalI18n.t("trace_new.otro") }] : [])];
        renderedOptionSize = optionPageSize();
        const pages = Math.max(1, Math.ceil(choices.length / renderedOptionSize));
        state.optionPage = Math.max(1, Math.min(state.optionPage, pages));
        const start = (state.optionPage - 1) * renderedOptionSize, value = state.answers.get(question.id), multiple = question.type === 'multiple_choice';
        const timedOptions = question.options.length > 0 && question.options.every(label => /\b(minutos?|min|horas?)\b/i.test(label));
        const optionIcon = timedOptions ? 'time-icon.svg' : multiple ? 'cages-icon.svg' : 'multiple-choice.svg';
        window.HospitalI18n.setHTML($('patient-options'), choices.slice(start, start + renderedOptionSize).map(option => `<label class="patient-option ${multiple ? 'checkbox-option' : ''}"><input type="${multiple ? 'checkbox' : 'radio'}" name="patient-choice" value="${option.value}" data-answer-choice ${multiple ? Array.isArray(value) && value.includes(option.value) ? 'checked' : '' : value === option.value ? 'checked' : ''}><i class="answer-mark" aria-hidden="true"></i><img class="option-icon" src="../../../../assets/Icons/${optionIcon}" alt=""><span class="answer-label">${escape(option.label)}</span><span class="answer-check" aria-hidden="true">✓</span></label>`).join(''));
        $('option-page-footer').hidden = pages <= 1;
        window.HospitalI18n.setHTML($('option-page-footer'), pages > 1 ? `<span>${window.HospitalI18n.mark("survey_patient.opciones_value_value_de_value", {value0: start + 1, value1: Math.min(choices.length, start + renderedOptionSize), value2: choices.length})}</span>${pageButtons(state.optionPage, pages, 'data-option-page')}` : '');
    }
    function renderQuestion(focus = false) {
        if (!questions.length) return;
        state.mode = 'question';
        const question = current(), value = state.answers.get(question.id);
        window.HospitalI18n.bindText($('progress-position'), () => window.HospitalI18n.t("survey_patient.pregunta_value_de_value", {value0: state.index + 1, value1: questions.length}));
        $('previous-question').disabled = state.index === 0;
        window.HospitalI18n.bindText($('previous-question').querySelector('span'), () => window.HospitalI18n.t("survey_view.anterior"));
        $('next-question').hidden = false; $('submit-answers').hidden = true;
        window.HospitalI18n.bindText($('next-question').querySelector('span'), () => state.index === questions.length - 1 ? window.HospitalI18n.t("survey_patient.revisar_respuestas") : window.HospitalI18n.t("survey_view.siguiente"));
        window.HospitalI18n.bindText($('navigation-note'), () => window.HospitalI18n.t("survey_patient.podes_volver_a_las_preguntas_anteriores"));
        const hints = { short_text: window.HospitalI18n.t("survey_patient.escribi_una_respuesta_breve"), long_text: window.HospitalI18n.t("survey_patient.contanos_tu_experiencia_con_tus_palabras"), rating: window.HospitalI18n.t("survey_patient.elegi_una_valoracion"), linear_scale: window.HospitalI18n.t("survey_patient.elegi_un_valor_de_la_escala"), date: window.HospitalI18n.t("survey_patient.elegi_una_fecha"), single_choice: window.HospitalI18n.t("survey_patient.elegi_una_opcion"), multiple_choice: window.HospitalI18n.t("survey_patient.podes_marcar_mas_de_una_opcion") };
        const context = question.context || question.divider ? `<div class="question-context">${question.divider ? '<hr>' : ''}${question.context ? `<h2>${escape(question.context.title)}</h2><p>${escape(question.context.description)}</p>` : ''}</div>` : '';
        let answer;
        if (isChoice(question)) answer = '<fieldset class="patient-options" id="patient-options" aria-labelledby="patient-question-title"></fieldset><div class="option-page-footer" id="option-page-footer"></div>';
        else if (['rating', 'linear_scale'].includes(question.type)) {
            const first = question.type === 'rating' ? 1 : question.scaleMin, last = question.type === 'rating' ? question.ratingMax : question.scaleMax, length = last - first + 1;
            answer = `<fieldset class="rating-options" style="--answer-columns:${length}" data-long="${length > 5}" aria-labelledby="patient-question-title">${Array.from({ length }, (_, index) => first + index).map(number => `<label class="rating-option"><input type="radio" name="patient-rating" value="${number}" data-answer-rating aria-label="${window.HospitalI18n.html("survey_view.value_de_value", {value0: number, value1: last})}" data-i18n-aria-label="survey_view.value_de_value" data-i18n-aria-label-params="${window.HospitalI18n.escape(JSON.stringify({value0: number, value1: last}))}" ${value === number ? 'checked' : ''}>${question.type === 'rating' ? icon('star-icon.svg') : ''}<span>${number}</span></label>`).join('')}</fieldset>${question.type === 'linear_scale' && (question.scaleStart || question.scaleEnd) ? `<div class="scale-captions"><span>${escape(question.scaleStart)}</span><span>${escape(question.scaleEnd)}</span></div>` : ''}`;
        } else {
            const maximum = question.type === 'long_text' ? 1000 : 250;
            answer = `<div class="patient-field"><label class="visually-hidden" for="patient-answer">${escape(question.title)}</label>${question.type === 'long_text' ? `<textarea id="patient-answer" data-answer-text maxlength="${maximum}" rows="4" placeholder="${escape(question.placeholder || window.HospitalI18n.t("survey_view.escribi_tu_respuesta"))}">${escape(value || '')}</textarea>` : `<input id="patient-answer" data-answer-text type="${question.type === 'date' ? 'date' : 'text'}" maxlength="${maximum}" placeholder="${escape(question.placeholder || window.HospitalI18n.t("survey_new.tu_respuesta"))}" value="${escape(value || '')}" autocomplete="off">`}${question.type !== 'date' ? `<small id="answer-length" aria-hidden="true">${String(value || '').length} / ${maximum}</small>` : ''}</div>`;
        }
        window.HospitalI18n.setHTML($('question-stage'), `${context}<div class="question-heading"><span class="patient-question-number" aria-hidden="true">${state.index + 1}</span><div><h2 id="patient-question-title" tabindex="-1">${escape(question.title)}${question.required ? `<em aria-label="${window.HospitalI18n.html("survey_view.obligatoria")}" data-i18n-aria-label="survey_view.obligatoria">*</em>` : ''}</h2><p id="question-instructions">${hints[question.type]}</p></div></div>${answer}${question.other && isChoice(question) ? `<div class="patient-field other-answer" id="other-answer" ${selectedOther(question) ? '' : 'hidden'}><label for="other-answer-text">${window.HospitalI18n.mark("survey_patient.cual")}</label><input type="text" id="other-answer-text" maxlength="120" placeholder="${window.HospitalI18n.html("survey_patient.escribi_otra_opcion")}" data-i18n-placeholder="survey_patient.escribi_otra_opcion" value="${escape(state.other.get(question.id) || '')}" autocomplete="off"></div>` : ''}${!question.required ? `<button type="button" class="skip-question" id="skip-question">${window.HospitalI18n.mark("survey_patient.prefiero_no_responder")}</button>` : ''}`);
        if (isChoice(question)) {
            const selectedValue = question.type === 'multiple_choice' ? value?.[0] : value;
            if (selectedValue !== undefined) state.optionPage = Math.floor((selectedValue === 'other' ? question.options.length : Number(selectedValue)) / optionPageSize()) + 1;
            renderOptions();
        }
        updateProgress(); $('question-stage').scrollTop = 0;
        if (focus) $('patient-question-title').focus();
    }
    function answerText(question) {
        const value = state.answers.get(question.id);
        if (!answered(question)) return window.HospitalI18n.t("survey_view.sin_responder");
        if (isChoice(question)) return (question.type === 'multiple_choice' ? value : [value]).map(option => option === 'other' ? window.HospitalI18n.t("survey_patient.otro_value", {value0: state.other.get(question.id).trim()}) : question.options[Number(option)]).join(' · ');
        if (['rating', 'linear_scale'].includes(question.type)) return `${value} / ${question.type === 'rating' ? question.ratingMax : question.scaleMax}`;
        if (question.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) { const [year, month, day] = value.split('-'); return `${day}/${month}/${year}`; }
        return value;
    }
    const reviewPageSize = () => innerWidth > 900 && survey?.identity === 'optional_name' ? innerHeight <= 850 ? 1 : 2 : innerWidth > 900 && innerHeight <= 850 ? 2 : 3;
    function renderReview(focus = false) {
        state.mode = 'review';
        const size = reviewPageSize(), pages = Math.max(1, Math.ceil(questions.length / size));
        renderedReviewSize = size;
        state.reviewPage = Math.max(1, Math.min(state.reviewPage, pages));
        const start = (state.reviewPage - 1) * size;
        window.HospitalI18n.bindText($('progress-position'), () => window.HospitalI18n.t("survey_patient.revision_de_tus_respuestas"));
        $('previous-question').disabled = false; window.HospitalI18n.bindText($('previous-question').querySelector('span'), () => window.HospitalI18n.t("trace_view.volver"));
        $('next-question').hidden = true; $('submit-answers').hidden = false;
        window.HospitalI18n.bindText($('navigation-note'), () => window.HospitalI18n.t("survey_patient.revisa_tus_respuestas_antes_de_enviar"));
        window.HospitalI18n.setHTML($('question-stage'), `<div class="review-heading"><h2 id="patient-review-title" tabindex="-1">${window.HospitalI18n.mark("survey_patient.revisa_tus_respuestas")}</h2><p>${window.HospitalI18n.mark("survey_patient.podes_cambiar_cualquier_respuesta_antes_de_enviarla")}</p></div>${survey?.identity === 'optional_name' ? `<div class="patient-field"><label for="participant-name">${window.HospitalI18n.mark("settings.nombre")} <span>${window.HospitalI18n.mark("destinations.opcional")}</span></label><input id="participant-name" type="text" maxlength="100" value="${escape(state.participantName)}" autocomplete="name" placeholder="${window.HospitalI18n.html("survey_patient.podes_dejar_este_campo_vacio")}" data-i18n-placeholder="survey_patient.podes_dejar_este_campo_vacio"></div>` : ''}<div class="review-list">${questions.slice(start, start + size).map((question, offset) => `<article class="review-answer"><div><h3>${start + offset + 1}. ${escape(question.title)}</h3><p>${escape(answerText(question))}</p></div><button type="button" data-edit-answer="${start + offset}" aria-label="${window.HospitalI18n.html("survey_patient.editar_respuesta_value", {value0: start + offset + 1})}" data-i18n-aria-label="survey_patient.editar_respuesta_value" data-i18n-aria-label-params="${window.HospitalI18n.escape(JSON.stringify({value0: start + offset + 1}))}">${window.HospitalI18n.mark("trace_view.editar")}</button></article>`).join('')}</div><div class="option-page-footer"><span>${window.HospitalI18n.mark("survey_patient.value_value_de_value_respuestas", {value0: start + 1, value1: Math.min(questions.length, start + size), value2: questions.length})}</span>${pageButtons(state.reviewPage, pages, 'data-review-page')}</div>`);
        updateProgress(); $('question-stage').scrollTop = 0;
        if (focus) $('patient-review-title').focus();
    }
    function advance() {
        if (!current() || state.mode !== 'question') return;
        if (!canContinue(current())) { console.error(window.HospitalI18n.t("shared.encuesta_completa_la_pregunta_antes_de_continuar")); $('question-stage').querySelector('input, textarea')?.focus(); return; }
        if (state.index < questions.length - 1) { state.index++; state.optionPage = 1; renderQuestion(true); }
        else { state.reviewPage = 1; renderReview(true); }
    }
    function applyReadingOptions() {
        document.documentElement.style.fontSize = `${16 + state.textSize * 2}px`;
        document.body.classList.toggle('high-contrast', state.contrast);
        document.querySelectorAll('[data-text-smaller]').forEach(button => { button.disabled = state.textSize === 0; });
        document.querySelectorAll('[data-text-larger]').forEach(button => { button.disabled = state.textSize === 2; });
        document.querySelectorAll('[name=text-size]').forEach(control => { control.checked = Number(control.value) === state.textSize; });
        $('high-contrast').checked = state.contrast;
        if (questions.length && state.mode!=='submitted') state.mode === 'review' ? renderReview() : renderQuestion();
    }

    document.addEventListener('DOMContentLoaded', async () => {
        await window.HospitalI18n.ready;
        window.addEventListener('hospital:localechange',()=>{renderIntroduction();if(questions.length&&state.mode!=='submitted'){state.mode==='review'?renderReview():renderQuestion();}});
        document.querySelector('[data-language-select]').addEventListener('change',event=>window.HospitalI18n.setPublicLocale(event.target.value));
        if(accessToken)try{survey=await request('get.php',{token:accessToken});}catch(error){report(error);}
        prepareQuestions(); renderIntroduction(); applyReadingOptions();
        $('survey-progress').hidden = $('survey-navigation').hidden = !questions.length;
        if (questions.length) renderQuestion();
        document.addEventListener('pointerdown', () => { pointerInput = true; });
        document.addEventListener('keydown', () => { pointerInput = false; });
        $('patient-form').addEventListener('submit', event => { event.preventDefault(); if (state.mode === 'question') advance();else if(state.mode==='review')submit(); });
        $('patient-form').addEventListener('invalid',event=>{event.preventDefault();report(new Error(window.HospitalI18n.t("survey_patient.revisa_el_formato_de_la_respuesta")));},true);
        $('submit-answers').addEventListener('click',submit);
        $('next-question').addEventListener('click', advance);
        $('previous-question').addEventListener('click', () => {
            if (state.mode === 'review') { state.index = questions.length - 1; state.optionPage = 1; renderQuestion(true); }
            else if (state.index > 0) { state.index--; state.optionPage = 1; renderQuestion(true); }
        });
        $('question-stage').addEventListener('input', event => {
            const field = event.target;
            if (field.hasAttribute('data-answer-text')) { state.answers.set(current().id, field.value); if ($('answer-length')) window.HospitalI18n.bindText($('answer-length'), () => `${field.value.length} / ${field.maxLength}`); updateProgress(); }
            else if (field.id === 'other-answer-text') { state.other.set(current().id, field.value); updateProgress(); }
            else if (field.id === 'participant-name') state.participantName = field.value;
        });
        $('question-stage').addEventListener('change', event => {
            const field = event.target, question = current();
            if (field.hasAttribute('data-answer-choice')) {
                if (question.type === 'multiple_choice') { const values = new Set(state.answers.get(question.id) || []); field.checked ? values.add(field.value) : values.delete(field.value); state.answers.set(question.id, [...values]); }
                else state.answers.set(question.id, field.value);
                if ($('other-answer')) {
                    const wasHidden = $('other-answer').hidden;
                    $('other-answer').hidden = !selectedOther(question);
                    if (wasHidden !== $('other-answer').hidden) {
                        if (field.checked) state.optionPage = Math.floor((field.value === 'other' ? question.options.length : Number(field.value)) / optionPageSize()) + 1;
                        renderOptions();
                        if (!pointerInput) $('patient-options').querySelector(`input[value="${field.value}"]`)?.focus();
                    }
                    if (pointerInput && field.value === 'other' && field.checked) $('other-answer-text').focus();
                }
                updateProgress();
            } else if (field.hasAttribute('data-answer-rating')) { state.answers.set(question.id, Number(field.value)); updateProgress(); }
        });
        $('question-stage').addEventListener('click', event => {
            if (event.target.closest('#skip-question')) { state.answers.delete(current().id); state.other.delete(current().id); advance(); }
            const options = event.target.closest('[data-option-page]');
            if (options && !options.disabled) { state.optionPage = Number(options.dataset.optionPage); renderOptions(); $('option-page-footer').querySelector('button:not(:disabled)')?.focus(); }
            const review = event.target.closest('[data-review-page]');
            if (review && !review.disabled) { state.reviewPage = Number(review.dataset.reviewPage); renderReview(); $('question-stage').querySelector('.patient-pagination button:not(:disabled)')?.focus(); }
            const edit = event.target.closest('[data-edit-answer]');
            if (edit) { state.index = Number(edit.dataset.editAnswer); state.optionPage = 1; renderQuestion(true); }
        });
        for (const [attribute, dialog] of [['data-open-help', 'help-dialog'], ['data-open-privacy', 'privacy-dialog'], ['data-open-accessibility', 'accessibility-dialog']]) document.querySelectorAll(`[${attribute}]`).forEach(button => button.addEventListener('click', () => $(dialog).showModal()));
        document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
        document.querySelectorAll('[data-text-smaller]').forEach(button => button.addEventListener('click', () => { state.textSize = Math.max(0, state.textSize - 1); applyReadingOptions(); }));
        document.querySelectorAll('[data-text-larger]').forEach(button => button.addEventListener('click', () => { state.textSize = Math.min(2, state.textSize + 1); applyReadingOptions(); }));
        document.querySelectorAll('[name=text-size]').forEach(control => control.addEventListener('change', () => { state.textSize = Number(control.value); applyReadingOptions(); }));
        $('high-contrast').addEventListener('change', event => { state.contrast = event.target.checked; applyReadingOptions(); });
        $('reset-accessibility').addEventListener('click', () => { state.textSize = 0; state.contrast = false; applyReadingOptions(); });
        const compact = matchMedia('(max-width: 900px)');
        const updateSupport = () => { $('patient-help').open = $('patient-privacy').open = !compact.matches; };
        updateSupport(); compact.addEventListener('change', updateSupport);
        new ResizeObserver(() => {
            if (!questions.length||state.mode==='submitted') return;
            if (state.mode === 'question' && isChoice(current()) && optionPageSize() !== renderedOptionSize) renderOptions();
            if (state.mode === 'review' && reviewPageSize() !== renderedReviewSize) renderReview();
        }).observe($('question-stage'));
    });
})();
