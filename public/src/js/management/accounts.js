document.addEventListener('DOMContentLoaded',async()=>{
  'use strict';
  const api=window.HospitalApi,$=id=>document.getElementById(id),dialog=$('account-dialog'),form=$('account-form');
  const labels={pending:'Pendiente',active:'Activa',disabled:'Desactivada'},roles={staff:'Personal',records_manager:'Registros clínicos',dispatcher:'Traslados',admin:'Administración'};
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let users=[],selected=null,base=null,action=null,busy=false,self=null,timer;
  function render(){
    const q=$('account-search').value.trim().toLocaleLowerCase(),state=$('account-state').value;
    const rows=users.filter(u=>(!state||u.status===state)&&`${u.username} ${u.email}`.toLocaleLowerCase().includes(q));
    $('account-list').innerHTML=rows.map(u=>`<button class="route-card${u.id===selected?' is-selected':''}" type="button" data-account-id="${escape(u.id)}" aria-label="Ver cuenta ${escape(u.username)}"><span class="route-card-top"><strong>${escape(u.username)}</strong><span class="status-pill">${labels[u.status]}</span></span><span class="route-card-name">${escape(u.email)}</span><span class="route-card-meta">${escape(u.roles.map(r=>roles[r]).join(' · '))}</span></button>`).join('');
    $('account-count').textContent=`${rows.length} cuentas`;
    const u=users.find(u=>u.id===selected);if(!u){$('account-detail').innerHTML='<h2>Seleccioná una cuenta</h2>';return;}
    const actions=u.status==='pending'?[['approve','Aprobar cuenta']]:u.status==='disabled'?[['reactivate','Reactivar cuenta']]:[['roles','Editar permisos'],['disable','Desactivar cuenta'],['revoke_sessions','Cerrar sesiones']];
    if(u.status!=='pending'&&u.id!==self)actions.push(['password','Restablecer contraseña']);
    $('account-detail').innerHTML=`<h2>${escape(u.username)}</h2><p>${escape(u.email)}</p><p>${labels[u.status]}</p><p>${escape(u.roles.map(r=>roles[r]).join(' · '))}</p><div class="detail-actions">${actions.map(([key,label])=>`<button type="button" class="secondary-button" data-action="${key}">${label}</button>`).join('')}</div>`;
  }
  async function load(){users=await api.get('admin/users/directory.php');render();}
  function setBusy(value){busy=value;[...form.elements].forEach(el=>el.disabled=value);}
  $('account-search').addEventListener('input',render);$('account-state').addEventListener('change',render);
  $('account-list').addEventListener('click',event=>{const button=event.target.closest('[data-account-id]');if(button&&!busy){selected=button.dataset.accountId;render();}});
  $('account-detail').addEventListener('click',event=>{
    const button=event.target.closest('[data-action]');if(!button||busy)return;
    base=users.find(u=>u.id===selected);if(!base)return;
    action=button.dataset.action;form.reset();$('account-title').textContent=button.textContent;$('account-name').textContent=base.username;
    $('account-roles').hidden=!['approve','roles'].includes(action);$('password-label').hidden=action!=='password';$('account-password').required=action==='password';
    form.querySelectorAll('[name=role]').forEach(el=>el.checked=base.roles.includes(el.value)||(action==='approve'&&el.value==='staff'));
    dialog.showModal();
  });
  $('account-cancel').addEventListener('click',()=>{if(!busy){form.reset();dialog.close();}});
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();else form.reset();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!base)return;
    if(!form.checkValidity()){api.report(new api.ApiError('Usá una contraseña de al menos 12 caracteres.',422,'VALIDATION_FAILED'),'accounts');return;}
    const chosen=[...form.querySelectorAll('[name=role]:checked')].map(el=>el.value),password=$('account-password').value;
    setBusy(true);
    try{
      if(action==='password')await api.post('admin/users/reset-password.php',{user_id:base.id,version:base.version,new_password:password});
      else await api.post('admin/users/manage.php',{user_id:base.id,version:base.version,action,roles:chosen});
      form.reset();dialog.close();
      if(base.id===self){location.assign(api.page('index.html'));return;}
      await load();$('account-status').textContent='Cambio guardado.';$('account-status').hidden=false;clearTimeout(timer);timer=setTimeout(()=>$('account-status').hidden=true,3500);
    }catch(error){api.report(error,'accounts');}
    finally{setBusy(false);}
  });
  try{const session=await window.HospitalAuth.ready;if(!session)return;self=session.user.id;await load();}catch(error){api.report(error,'accounts');}
});
