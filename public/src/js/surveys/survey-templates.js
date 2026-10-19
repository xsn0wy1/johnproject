(() => {
    'use strict';
    Object.defineProperty(window, 'HospitalSurveyTemplates', {get: () => [
        { title: window.HospitalI18n.t("survey_templates.satisfaccion_general_del_paciente"), description: window.HospitalI18n.t("survey_templates.queremos_conocer_tu_experiencia_durante_la_atencion_tus_comentarios_nos_ayudan_a_mejorar"), category: 'patient_care', audience: 'patients',
            questions: [
                { title: window.HospitalI18n.t("survey_templates.como_valoras_la_atencion_que_recibiste"), type: 'rating', required: true, options: '' },
                { title: window.HospitalI18n.t("survey_templates.la_informacion_que_recibiste_fue_clara"), type: 'choice', required: true, options: window.HospitalI18n.t("survey_templates.si_en_parte_no") },
                { title: window.HospitalI18n.t("survey_templates.que_podriamos_mejorar"), type: 'text', required: false, options: '' }
            ] },
        { title: window.HospitalI18n.t("survey_templates.evaluacion_del_servicio_de_traslados"), description: window.HospitalI18n.t("survey_templates.contanos_como_fue_tu_traslado_y_la_atencion_del_equipo_que_te_acompano"), category: 'transfers', audience: 'patients',
            questions: [
                { title: window.HospitalI18n.t("survey_templates.como_valoras_el_trato_del_equipo_durante_el_traslado"), type: 'rating', required: true, options: '' },
                { title: window.HospitalI18n.t("survey_templates.como_fue_la_comodidad_durante_el_viaje"), type: 'rating', required: true, options: '' },
                { title: window.HospitalI18n.t("survey_templates.queres_compartir_algun_comentario"), type: 'text', required: false, options: '' }
            ] },
        { title: window.HospitalI18n.t("survey_templates.calidad_de_atencion_en_emergencias"), description: window.HospitalI18n.t("survey_templates.tu_experiencia_nos_ayuda_a_mejorar_la_atencion_en_emergencias"), category: 'emergency', audience: 'patients',
            questions: [
                { title: window.HospitalI18n.t("survey_templates.como_valoras_la_atencion_recibida"), type: 'rating', required: true, options: '' },
                { title: window.HospitalI18n.t("survey_templates.te_mantuvieron_informado_durante_la_espera"), type: 'choice', required: true, options: window.HospitalI18n.t("survey_templates.si_en_parte_no_no_corresponde") },
                { title: window.HospitalI18n.t("survey_templates.que_aspecto_de_la_atencion_mejorarias"), type: 'text', required: false, options: '' }
            ] },
        { title: window.HospitalI18n.t("survey_templates.bienestar_y_experiencia_del_personal"), description: window.HospitalI18n.t("survey_templates.queremos_escuchar_al_equipo_y_conocer_como_mejorar_el_trabajo_de_cada_dia"), category: 'staff', audience: 'staff',
            questions: [
                { title: window.HospitalI18n.t("survey_templates.como_valoras_tu_experiencia_de_trabajo_en_el_equipo"), type: 'rating', required: true, options: '' },
                { title: window.HospitalI18n.t("survey_templates.contas_con_los_recursos_necesarios_para_tus_tareas"), type: 'choice', required: true, options: window.HospitalI18n.t("survey_templates.si_en_parte_no") },
                { title: window.HospitalI18n.t("survey_templates.que_cambio_te_ayudaria_en_tu_trabajo"), type: 'text', required: false, options: '' }
            ] }
    ]});
})();
