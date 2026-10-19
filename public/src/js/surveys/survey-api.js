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
    const publicUrl=token=>`${api.page('src/views/surveys/user-view/survey-user.html')}#token=${token}`;
    let dialog;
    function accessDialog() {
        if(dialog)return dialog;
        dialog=document.createElement('dialog');dialog.className='survey-dialog survey-links-dialog';dialog.setAttribute('aria-labelledby','survey-links-title');
        dialog.innerHTML='<div class="dialog-heading"><h2 id="survey-links-title">Acceso para participantes</h2><button type="button" class="icon-button" data-close-links aria-label="Cerrar acceso">×</button></div><div class="survey-links-body"><p id="survey-links-caption"></p><div class="share-controls"><button class="survey-button primary" id="survey-new-invitation" type="button">Crear invitación</button></div><div id="survey-invitations"></div><label for="survey-public-url">Enlace seleccionado</label><input id="survey-public-url" type="text" readonly><div id="survey-public-qr" aria-label="Código QR del enlace"></div><div class="share-controls"><button type="button" class="survey-button secondary" id="survey-copy-link">Copiar enlace</button><button type="button" class="survey-button secondary" id="survey-revoke-link">Revocar enlace</button></div></div>';
        document.body.append(dialog);dialog.querySelector('[data-close-links]').addEventListener('click',()=>dialog.close());return dialog;
    }
    async function share(survey,onChange=()=>{}) {
        const modal=accessDialog(),list=modal.querySelector('#survey-invitations'),url=modal.querySelector('#survey-public-url'),qr=modal.querySelector('#survey-public-qr');
        let links=await api.get(`surveys/links.php?id=${survey.id}`),chosen=null,busy=false;
        const create=modal.querySelector('#survey-new-invitation'),copy=modal.querySelector('#survey-copy-link'),revoke=modal.querySelector('#survey-revoke-link');
        modal.querySelector('#survey-links-caption').textContent=survey.config.access==='individual_link'?'Cada invitación acepta una sola respuesta. Entregá cada enlace a una persona.':'Este enlace compartido acepta respuestas mientras la encuesta esté abierta. No identifica ni limita a una persona por dispositivo.';
        create.hidden=survey.config.access!=='individual_link';
        function select(id){
            chosen=links.find(l=>l.id===id)||null;url.value=chosen?.token?publicUrl(chosen.token):'';qr.innerHTML='';copy.disabled=!url.value;revoke.disabled=!chosen||!!chosen.revoked_at;
            if(url.value){const code=window.qrcode(0,'M');code.addData(url.value);code.make();qr.innerHTML=code.createSvgTag({cellSize:4,margin:4,scalable:true});}
        }
        function render(){
            list.replaceChildren();links.forEach((link,index)=>{const button=document.createElement('button');button.type='button';button.className='survey-button secondary';button.textContent=`${link.single_use?'Invitación '+(links.length-index):'Enlace compartido'} · ${link.revoked_at?'Revocado':link.used_at?'Respondida':'Disponible'}`;button.disabled=!!link.revoked_at;button.onclick=()=>select(link.id);list.append(button);});select(links.find(l=>!l.revoked_at&&!l.used_at)?.id);
        }
        async function change(linkId){
            if(busy)return;busy=true;create.disabled=revoke.disabled=true;
            try{const result=await api.post('surveys/link-update.php',{id:survey.id,version:survey.version,...(linkId?{link_id:linkId}:{})});survey=result.survey;links=result.links;render();onChange(survey);}
            catch(error){api.report(error,'survey-links');}finally{busy=false;create.disabled=false;revoke.disabled=!chosen||!!chosen.revoked_at;}
        }
        create.onclick=()=>change(null);revoke.onclick=()=>{if(chosen)change(chosen.id);};
        copy.onclick=async()=>{try{await navigator.clipboard.writeText(url.value);}catch(error){api.report(error,'survey-copy');}};
        render();modal.showModal();
    }
    window.HospitalSurveys=Object.freeze({get,directory,transition,share,publicUrl});
})();
