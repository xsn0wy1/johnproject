(() => {
    'use strict';
    window.HospitalSurveyTemplates = [
        { title: 'Satisfacción general del paciente', description: 'Queremos conocer tu experiencia durante la atención. Tus comentarios nos ayudan a mejorar.', category: 'patient_care', audience: 'patients',
            questions: [
                { title: '¿Cómo valorás la atención que recibiste?', type: 'rating', required: true, options: '' },
                { title: '¿La información que recibiste fue clara?', type: 'choice', required: true, options: 'Sí\nEn parte\nNo' },
                { title: '¿Qué podríamos mejorar?', type: 'text', required: false, options: '' }
            ] },
        { title: 'Evaluación del servicio de traslados', description: 'Contanos cómo fue tu traslado y la atención del equipo que te acompañó.', category: 'transfers', audience: 'patients',
            questions: [
                { title: '¿Cómo valorás el trato del equipo durante el traslado?', type: 'rating', required: true, options: '' },
                { title: '¿Cómo fue la comodidad durante el viaje?', type: 'rating', required: true, options: '' },
                { title: '¿Querés compartir algún comentario?', type: 'text', required: false, options: '' }
            ] },
        { title: 'Calidad de atención en emergencias', description: 'Tu experiencia nos ayuda a mejorar la atención en emergencias.', category: 'emergency', audience: 'patients',
            questions: [
                { title: '¿Cómo valorás la atención recibida?', type: 'rating', required: true, options: '' },
                { title: '¿Te mantuvieron informado durante la espera?', type: 'choice', required: true, options: 'Sí\nEn parte\nNo\nNo corresponde' },
                { title: '¿Qué aspecto de la atención mejorarías?', type: 'text', required: false, options: '' }
            ] },
        { title: 'Bienestar y experiencia del personal', description: 'Queremos escuchar al equipo y conocer cómo mejorar el trabajo de cada día.', category: 'staff', audience: 'staff',
            questions: [
                { title: '¿Cómo valorás tu experiencia de trabajo en el equipo?', type: 'rating', required: true, options: '' },
                { title: '¿Contás con los recursos necesarios para tus tareas?', type: 'choice', required: true, options: 'Sí\nEn parte\nNo' },
                { title: '¿Qué cambio te ayudaría en tu trabajo?', type: 'text', required: false, options: '' }
            ] }
    ];
})();
