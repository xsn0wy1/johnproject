(() => {
    'use strict';
    const api=window.HospitalApi;
    const get=id=>api.get(`surveys/get.php?id=${encodeURIComponent(id)}`);
    const transition=(survey,action)=>api.post('surveys/transition.php',{id:survey.id,version:survey.version,action});
    async function directory(archived=false) {
        const records=[];
        for (let page=1;;page++) {
            const result=await api.getPage(`surveys/list.php?page=${page}&page_size=100&archived=${archived?1:0}`);
            records.push(...result.data);if(records.length>=result.meta.total||!result.data.length)return records;
        }
    }
    const publicUrl=token=>{const url=new URL(api.page('src/views/surveys/user-view/survey-user.html'));if(window.HospitalI18n.locale==='en')url.searchParams.set('lang','en');url.hash=new URLSearchParams({token}).toString();return url.href;};
    let dialog;
    function accessDialog() {
        if(dialog)return dialog;
        dialog=document.createElement('dialog');dialog.className=`survey-dialog survey-links-dialog`;dialog.setAttribute('aria-labelledby','survey-links-title');
        window.HospitalI18n.setHTML(dialog, `<div class="dialog-heading"><h2 id="survey-links-title">${window.HospitalI18n.mark("survey_view.acceso_para_participantes")}</h2><button type="button" class="icon-button" data-close-links aria-label="${window.HospitalI18n.html("survey_api.cerrar_acceso")}" data-i18n-aria-label="survey_api.cerrar_acceso">${window.HospitalI18n.mark("destinations.text")}</button></div><div class="survey-links-body"><p id="survey-links-caption"></p><div class="share-controls"><button class="survey-button primary" id="survey-new-invitation" type="button">${window.HospitalI18n.mark("survey_api.crear_invitacion")}</button></div><div id="survey-invitations"></div><label for="survey-public-url">${window.HospitalI18n.mark("survey_api.enlace_seleccionado")}</label><input id="survey-public-url" type="text" readonly><div id="survey-public-qr" aria-label="${window.HospitalI18n.html("survey_api.codigo_qr_del_enlace")}" data-i18n-aria-label="survey_api.codigo_qr_del_enlace"></div><div class="share-controls"><button type="button" class="survey-button secondary" id="survey-copy-link">${window.HospitalI18n.mark("survey_view.copiar_enlace")}</button><button type="button" class="survey-button secondary" id="survey-revoke-link">${window.HospitalI18n.mark("survey_api.revocar_enlace")}</button></div></div>`);
        document.body.append(dialog);dialog.querySelector('[data-close-links]').addEventListener('click',()=>dialog.close());return dialog;
    }
    async function share(survey,onChange=()=>{}) {
        const modal=accessDialog(),list=modal.querySelector('#survey-invitations'),url=modal.querySelector('#survey-public-url'),qr=modal.querySelector('#survey-public-qr');
        let links=await api.get(`surveys/links.php?id=${survey.id}`),chosen=null,busy=false;
        const create=modal.querySelector('#survey-new-invitation'),copy=modal.querySelector('#survey-copy-link'),revoke=modal.querySelector('#survey-revoke-link');
        window.HospitalI18n.bindText(modal.querySelector('#survey-links-caption'), () => survey.config.access==='individual_link'?window.HospitalI18n.t("survey_api.cada_invitacion_acepta_una_sola_respuesta_entrega_cada_enlace_a_una_persona"):window.HospitalI18n.t("survey_api.este_enlace_compartido_acepta_respuestas_mientras_la_encuesta_este_abierta_no_identifica_n"));
        create.hidden=survey.config.access!=='individual_link';
        function select(id){
            chosen=links.find(l=>l.id===id)||null;url.value=chosen?.token?publicUrl(chosen.token):'';window.HospitalI18n.setHTML(qr, '');copy.disabled=!url.value;revoke.disabled=!chosen||!!chosen.revoked_at;
            if(url.value){const code=window.qrcode(0,'M');code.addData(url.value);code.make();window.HospitalI18n.setHTML(qr, code.createSvgTag({cellSize:4,margin:4,scalable:true}));}
        }
        function render(){
            list.replaceChildren();links.forEach((link,index)=>{const button=document.createElement('button');button.type='button';button.className=`survey-button secondary`;window.HospitalI18n.bindText(button, () => `${link.single_use?window.HospitalI18n.t("survey_api.invitacion")+(links.length-index):window.HospitalI18n.t("survey_new.enlace_compartido")} · ${link.revoked_at?window.HospitalI18n.t("survey_api.revocado"):link.used_at?window.HospitalI18n.t("survey_api.respondida"):window.HospitalI18n.t("doctors.disponible")}`);button.disabled=!!link.revoked_at;button.onclick=()=>select(link.id);list.append(button);});select(links.find(l=>!l.revoked_at&&!l.used_at)?.id);
        }
        async function change(linkId){
            if(busy)return;busy=true;create.disabled=revoke.disabled=true;
            try{const result=await api.post('surveys/link-update.php',{id:survey.id,version:survey.version,...(linkId?{link_id:linkId}:{})});survey=result.survey;links=result.links;render();onChange(survey);}
            catch(error){api.report(error,'survey-links');}finally{busy=false;create.disabled=false;revoke.disabled=!chosen||!!chosen.revoked_at;}
        }
        create.onclick=()=>change(null);revoke.onclick=()=>{if(chosen)change(chosen.id);};
        copy.onclick=async()=>{try{await navigator.clipboard.writeText(url.value);}catch(error){api.report(error,'survey-copy');}};
        render();const localizeAccess=()=>select(chosen?.id);window.addEventListener('hospital:localechange',localizeAccess);modal.addEventListener('close',()=>window.removeEventListener('hospital:localechange',localizeAccess),{once:true});modal.showModal();
    }
    window.HospitalSurveys=Object.freeze({get,directory,transition,share,publicUrl});
})();
