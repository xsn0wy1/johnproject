document.addEventListener('DOMContentLoaded',async ()=>{
    'use strict';
    await window.HospitalI18n.ready;
    await window.HospitalAuth.ready;

  const api=window.TraceApi,$=id=>document.getElementById(id);
  if($('transferGrid')){
    window.addEventListener('hospital:localechange',()=>render());
    const grid=$('transferGrid'),list=$('transferList'),template=$('transferCardTemplate'),pagination=document.querySelector('.pagination');
    let filter='active',page=1,total=0,items=[],loading=false,loaded=false,revision=0,type='all',sort='recent',timer;
    const isList=()=>filter==='all';
    function makeCard(item){
      const card=template.content.firstElementChild.cloneNode(true);
      card.className='transfer-card '+['blue-card','green-card','purple-card'][Number(item.id)%3];
      card.dataset.transferId=item.id;card.dataset.status=item.status;
      window.HospitalI18n.bindText(card.querySelector('.card-title h2'), () => window.HospitalI18n.t("trace.traslado_value", {value0: item.id}));
      window.HospitalI18n.bindText(card.querySelector('.card-title p'), () => window.HospitalI18n.t("trace.ambulancia_value", {value0: item.ambulance.code}));
      const status=card.querySelector('.status-label');window.HospitalI18n.bindText(status, () => (item.is_delayed?window.HospitalI18n.t("trace_map.demorado_2"):api.labels[item.status]).toUpperCase());
      status.className='status-label '+(item.status==='scheduled'?'assigned-label':['completed','cancelled'].includes(item.status)?'completed-label':'progress-label');
      const values=card.querySelectorAll('.info-value p');[item.crew.driver?.name??'—',item.crew.companion?.name??'—',api.cargo[item.cargo_type]].forEach((text,i)=>{window.HospitalI18n.bindText(values[i], () => text);});
      const stops=card.querySelectorAll('.route-text > div');
      window.HospitalI18n.bindText(stops[0].querySelector('strong'), () => item.origin.name);window.HospitalI18n.bindText(stops[0].querySelector('p'), () => api.dateTime(item.started_at??item.scheduled_at));
      window.HospitalI18n.bindText(stops[1].querySelector('strong'), () => item.destination.name);window.HospitalI18n.bindText(stops[1].querySelector('p'), () => api.dateTime(item.arrived_at??item.eta));
      card.querySelector('.details-button').dataset.openTransfer=item.id;return card;
    }
    function makeListRow(item){
      const card=makeCard(item),row=document.createElement('article');row.className='transfer-list-row '+['blue-card','green-card','purple-card'][Number(item.id)%3];
      const identity=document.createElement('div');identity.className='list-row-identity';identity.append(card.querySelector('.ambulance-icon'));
      const copy=document.createElement('div');copy.className='list-row-identity-copy';copy.append(card.querySelector('.card-title'));
      const badges=document.createElement('div');badges.className='list-row-badges';badges.append(card.querySelector('.status-label'));
      const typeBadge=document.createElement('span');typeBadge.className='list-type-badge';window.HospitalI18n.bindText(typeBadge, () => window.HospitalI18n.t('trace.cargo_prefix')+api.cargo[item.cargo_type]);badges.append(typeBadge);copy.append(badges);identity.append(copy);
      const route=document.createElement('div');route.className='list-row-route';route.append(card.querySelector('.route-box'));
      const crew=document.createElement('div');crew.className='list-row-crew';const info=card.querySelector('.transfer-information');info.querySelector('.info-group:last-child').remove();crew.append(info);
      const action=document.createElement('div');action.className='list-row-action';action.append(card.querySelector('.details-button'));row.append(identity,route,crew,action);return row;
    }
    function render(){
      const all=isList(),scroll=list.scrollTop;grid.hidden=all;$('allTransfers').hidden=!all;document.querySelector('.content-card').classList.toggle('all-view-active',all);
      grid.replaceChildren(...(all?[]:items.map(makeCard)));list.replaceChildren(...(all?items.map(makeListRow):[]));list.scrollTop=scroll;
      $('emptyMessage').hidden=all||!loaded||items.length>0;$('listEmptyMessage').hidden=!all||!loaded||items.length>0;
      pagination.hidden=all;pagination.style.display=all?'none':'';grid.setAttribute('aria-busy',String(loading));list.setAttribute('aria-busy',String(loading));
      window.HospitalI18n.bindText($('resultsText'), () => loaded?(all?window.HospitalI18n.t('trace.transfer_count',{count:total}):window.HospitalI18n.t("trace.mostrando_value_de_value_traslados", {value0: items.length, value1: total})):loading?window.HospitalI18n.t("trace.cargando_traslados"):'');
      const pages=Math.ceil(total/3);$('previousPage').disabled=loading||page<=1;$('nextPage').disabled=loading||page>=pages;$('pageNumbers').replaceChildren();
      if(!all)for(let n=Math.max(1,Math.min(page-1,pages-2));n<=Math.min(pages,Math.max(3,page+1));n++){
        const b=document.createElement('button');b.type='button';b.className='page-button'+(n===page?' active':'');window.HospitalI18n.bindText(b, () => n);b.dataset.page=n;window.HospitalI18n.bindAttr(b, "aria-label", () => window.HospitalI18n.t("trace.ir_a_la_pagina_value", {value0: n}));b.disabled=loading;if(n===page)b.setAttribute('aria-current','page');$('pageNumbers').append(b);
      }
    }
    async function load(append=false,quiet=false){
      if(append&&(loading||items.length>=total))return;
      const r=++revision,requested=append?page+1:page;let success=false;loading=true;if(!append&&!quiet){items=[];loaded=false;list.scrollTop=0;}render();
      try{
        const result=await api.list({state:filter,page:requested,page_size:isList()?30:3,q:isList()?$('listTransferSearch').value.trim():'',type:isList()?type:'all',sort});
        if(r!==revision)return;total=result.meta.total;page=requested;
        items=append?[...new Map([...items,...result.data].map(item=>[item.id,item])).values()]:result.data;loaded=true;success=true;
        window.HospitalI18n.bindText($('activeCount'), () => result.meta.counts.active_count);window.HospitalI18n.bindText($('completedCount'), () => result.meta.counts.completed_count);window.HospitalI18n.bindText($('allCount'), () => result.meta.counts.all_count);
        document.querySelector('.primary-action').disabled=!result.meta.can_manage;
        if(!isList()&&page>1&&!items.length&&total){page=Math.ceil(total/3);return load();}
      }catch(error){api.report(error);}finally{if(r===revision){loading=false;render();if(success&&isList()&&items.length<total&&list.scrollHeight<=list.clientHeight+100)requestAnimationFrame(()=>load(true));}}
    }
    document.querySelectorAll('.filter-button').forEach(button=>button.addEventListener('click',()=>{
      document.querySelectorAll('.filter-button').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-selected',String(b===button));});filter=button.dataset.filter;page=1;load();
    }));
    $('listTransferSearch').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{page=1;load();},220);});
    document.querySelectorAll('[data-type]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-type]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});type=({all:'all',paciente:'patient',equipo:'equipment',biologico:'biological'})[button.dataset.type];page=1;load();}));
    document.querySelectorAll('[data-sort]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-sort]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});sort=button.dataset.sort==='oldest'?'oldest':'recent';page=1;load();}));
    $('previousPage').addEventListener('click',()=>{if(page>1&&!loading){page--;load();}});$('nextPage').addEventListener('click',()=>{if(page*3<total&&!loading){page++;load();}});
    $('pageNumbers').addEventListener('click',event=>{const b=event.target.closest('[data-page]');if(b&&!loading){page=Number(b.dataset.page);load();}});
    document.querySelector('.transfer-views').addEventListener('click',event=>{const b=event.target.closest('[data-open-transfer]');if(b)location.assign(`trace-view.html?id=${encodeURIComponent(b.dataset.openTransfer)}`);});
    list.addEventListener('scroll',()=>{if(isList()&&list.scrollTop+list.clientHeight>=list.scrollHeight-180)load(true);});
    document.querySelector('.primary-action').addEventListener('click',()=>location.assign('trace-new.html'));
    if(await window.HospitalAuth.ready)await load();
    const refresh=setInterval(()=>{if(!document.hidden&&!isList()&&!loading)load(false,true);},15000);window.addEventListener('pagehide',()=>clearInterval(refresh));
  }
  const form=$('newTransferForm');if(!form)return;
  const dropdowns=[...form.querySelectorAll('select')].map(control=>{
    const root=document.createElement('div');root.className='document-filter trace-select';
    control.before(root);root.append(control);control.hidden=true;
    const button=document.createElement('button');button.type='button';button.id=control.id+'-button';button.className='filter-trigger trace-select-trigger';
    const label=document.createElement('span');label.id=control.id+'-label';label.className='trace-select-label';
    const arrow=document.createElement('span');arrow.className='trace-select-chevron';arrow.setAttribute('aria-hidden','true');
    const menu=document.createElement('div');menu.id=control.id+'-menu';menu.className='filter-menu';menu.hidden=true;menu.setAttribute('role','group');
    const fieldLabel=control.labels[0];fieldLabel.id ||= control.id+'-field-label';fieldLabel.htmlFor=button.id;
    button.setAttribute('aria-labelledby',fieldLabel.id+' '+label.id);button.setAttribute('aria-controls',menu.id);button.setAttribute('aria-expanded','false');menu.setAttribute('aria-labelledby',fieldLabel.id);
    button.append(label,arrow);root.append(button,menu);
    const dropdown={control,root,button,label,menu,source:[],choices:[]};
    button.addEventListener('click',()=>{if(menu.hidden)openDropdown(dropdown);else closeDropdown(dropdown);});
    button.addEventListener('keydown',event=>{
      if(['ArrowDown','ArrowUp'].includes(event.key)){
        event.preventDefault();if(!openDropdown(dropdown))return;
        const available=dropdown.choices.filter(choice=>!choice.disabled);
        (available.find(choice=>choice.dataset.value===control.value)||(event.key==='ArrowUp'?available.at(-1):available[0]))?.focus();
      }else if(event.key==='Escape'){event.preventDefault();closeDropdown(dropdown);}
    });
    menu.addEventListener('click',event=>{
      const choice=event.target.closest('button');if(!choice||choice.disabled||control.disabled)return;
      const changed=control.value!==choice.dataset.value;control.value=choice.dataset.value;
      closeDropdown(dropdown);if(changed)control.dispatchEvent(new Event('change',{bubbles:true}));syncDropdowns();button.focus();
    });
    menu.addEventListener('keydown',event=>{
      const choices=dropdown.choices.filter(choice=>!choice.disabled);
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();const index=choices.indexOf(document.activeElement);
        const next=event.key==='Home'?0:event.key==='End'?choices.length-1:(index+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length;choices[next]?.focus();
      }else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeDropdown(dropdown);button.focus();}
    });
    control.addEventListener('change',syncDropdowns);return dropdown;
  });
  function closeDropdown(dropdown){dropdown.menu.hidden=true;dropdown.button.setAttribute('aria-expanded','false');}
  function closeDropdowns(){dropdowns.forEach(closeDropdown);}
  function openDropdown(dropdown){
    if(dropdown.control.disabled)return false;closeDropdowns();
    dropdown.menu.hidden=false;
    const rect=dropdown.root.getBoundingClientRect(),below=innerHeight-rect.bottom-19,above=rect.top-19,upwards=below<Math.min(260,dropdown.menu.scrollHeight)&&above>below;
    dropdown.menu.style.left=`${Math.max(12-rect.left,Math.min(0,innerWidth-12-rect.left-dropdown.menu.offsetWidth))}px`;
    dropdown.root.classList.toggle('opens-up',upwards);dropdown.root.style.setProperty('--trace-menu-height',`${Math.max(0,upwards?above:below)}px`);
    dropdown.button.setAttribute('aria-expanded','true');return true;
  }
  function syncDropdowns(){
    dropdowns.forEach(dropdown=>{
      const {control,button,label,menu}=dropdown,source=[...control.options];
      if(source.length!==dropdown.source.length||source.some((option,index)=>option!==dropdown.source[index])){
        dropdown.source=source;dropdown.choices=source.map(option=>{
          const choice=document.createElement('button');choice.type='button';choice.dataset.value=option.value;
          window.HospitalI18n.bindText(choice,()=>option.textContent);return choice;
        });menu.replaceChildren(...dropdown.choices);
      }
      window.HospitalI18n.bindText(label,()=>control.selectedOptions[0]?.textContent||'');button.disabled=control.disabled;
      dropdown.choices.forEach((choice,index)=>{choice.disabled=control.disabled||source[index].disabled;choice.setAttribute('aria-pressed',String(choice.dataset.value===control.value));});
      if(control.disabled)closeDropdown(dropdown);
    });
  }
  document.addEventListener('click',event=>dropdowns.forEach(dropdown=>{if(!dropdown.root.contains(event.target))closeDropdown(dropdown);}));
  document.addEventListener('focusin',event=>dropdowns.forEach(dropdown=>{if(!dropdown.root.contains(event.target))closeDropdown(dropdown);}));
  window.addEventListener('resize',closeDropdowns);
  window.addEventListener('hospital:localechange',()=>queueMicrotask(syncDropdowns));
  let catalog,patient=null,patientChoices=[],patientRevision=0,patientTimer,draftVersion=0,token,busy=true;
  const crewLabel=item=>`${item.full_name} · #${item.id}`,facilityLabel=api.facilityLabel,patientLabel=item=>`${item.full_name} · ${item.national_id}`;
  function applyRoute(fill=true){
    const route=catalog?.routes.find(item=>item.id===$('routeTemplate').value);
    for(const key of ['origin','destination']){ $(key).readOnly=Boolean(route);if(route&&fill)$(key).value=route[`${key}_address`]||route[`${key}_name`]; }
    if(fill)$('routeVersion').value=route?String(route.version):'';
    window.HospitalI18n.bindText($('route-itinerary'), () => route?[route.origin_name,...route.stops.map(s=>s.name),route.destination_name].join(' → '):'');
    $('route-itinerary').hidden=!route;
    if(!$('routeTemplate').value)$('routeVersion').value='';
  }
  $('routeTemplate').addEventListener('change',()=>applyRoute());
  const findCrew=(value,duty)=>catalog.crew.find(item=>crewLabel(item)===value&&(duty==='driver'?item.role_code==='driver':['copilot','doctor'].includes(item.role_code)));
  const validation=text=>api.report(new window.HospitalApi.ApiError(text,422,'VALIDATION_FAILED'));
  function setBusy(value){busy=value;if(value)closeDropdowns();form.querySelectorAll('input,select,textarea,button').forEach(control=>{control.disabled=value;});$('patientSex').disabled=true;form.setAttribute('aria-busy',String(value));syncDropdowns();}
  function showPatient(item){patient=item;$('patientCedula').value=item?.national_id??'';$('patientAge').value=item?.age??'';window.HospitalI18n.bindAttr($('patientAge'), "title", () => item?.age_is_estimate?window.HospitalI18n.t("trace.edad_estimada_registrada_el_value", {value0: item.age_recorded_on}):'');$('patientSex').value=({female:'femenino',male:'masculino',other:'otro',unspecified:'no-indica'})[item?.sex]??'';syncDropdowns();}
  function patientRequirement(){const needed=$('transferType').value==='patient';$('patientName').required=needed;for(const name of ['patientName','patientCedula','patientAge','patientSex'])$(name).disabled=!needed||busy||name==='patientSex';if(!needed){$('patientName').value='';showPatient(null);form.elements.withFamily.checked=false;form.elements.criticalPatient.checked=false;}syncDropdowns();}
  $('transferType').addEventListener('change',patientRequirement);
  $('patientName').addEventListener('input',()=>{
    clearTimeout(patientTimer);const r=++patientRevision;showPatient(patientChoices.find(item=>patientLabel(item)===$('patientName').value)??null);
    if(patient||$('patientName').value.trim().length<2){$('patient-options').replaceChildren();return;}
    patientTimer=setTimeout(async()=>{try{const found=await api.patients($('patientName').value.trim());if(r!==patientRevision)return;patientChoices=found;$('patient-options').replaceChildren(...found.map(item=>window.HospitalI18n.option(() => patientLabel(item), patientLabel(item))));showPatient(found.find(item=>patientLabel(item)===$('patientName').value)??null);}catch(error){api.report(error);}},220);
  });
  $('patientName').addEventListener('change',()=>showPatient(patientChoices.find(item=>patientLabel(item)===$('patientName').value)??patient));
  async function saveDraft(clear=false){
    if(busy)return false;const payload={};for(const control of form.querySelectorAll('input,select,textarea'))if(control.name)payload[control.name]=control.type==='checkbox'?control.checked:control.value;
    payload.patientId=patient?.id??'';payload.createToken=token;
    setBusy(true);try{const result=await api.saveDraft(clear?{version:draftVersion,clear:true}:{version:draftVersion,payload});draftVersion=result.version;window.HospitalI18n.bindText($('formMessage'), () => clear?'':window.HospitalI18n.t("trace.borrador_guardado"));return true;}catch(error){api.report(error);window.HospitalI18n.bindText($('formMessage'), () => '');return false;}finally{setBusy(false);patientRequirement();}
  }
  $('saveDraft').addEventListener('click',()=>saveDraft());$('cancelTransfer').addEventListener('click',async()=>{if(await saveDraft(true))location.assign('trace.html');});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!form.checkValidity())return;
    const driver=findCrew($('driver').value,'driver'),companion=$('companion').value?findCrew($('companion').value,'companion'):null;
    if(!driver||($('companion').value&&!companion)||($('transferType').value==='patient'&&(!patient||patientLabel(patient)!==$('patientName').value))){validation(window.HospitalI18n.t("trace.selecciona_personal_y_paciente_desde_sus_catalogos"));return;}
    const body={route_template_id:$('routeTemplate').value||null,ambulance_id:$('ambulance').value,driver_id:driver.id,companion_id:companion?.id??null,patient_id:patient?.id??null,...api.locationFields('origin',$('origin').value,catalog.facilities),...api.locationFields('destination',$('destination').value,catalog.facilities),scheduled_at:`${$('startDate').value}T${$('startTime').value}:00-03:00`,cargo_type:$('transferType').value,priority:$('priority').value,reason:$('reason').value,notes:$('notes').value,create_token:token};
    for(const [field,name]of Object.entries({special_equipment:'specialEquipment',with_family:'withFamily',interdepartmental:'interdepartmental',critical_patient:'criticalPatient'}))body[field]=form.elements[name].checked;
    if($('routeTemplate').value&&$('routeVersion').value)body.route_version=Number($('routeVersion').value);
    if(draftVersion)body.draft_version=draftVersion;
    setBusy(true);window.HospitalI18n.bindText($('formMessage'), () => window.HospitalI18n.t("trace.guardando_traslado"));
    try{const item=await api.create(body);location.assign(`trace-view.html?id=${encodeURIComponent(item.id)}`);}catch(error){api.report(error);window.HospitalI18n.bindText($('formMessage'), () => '');setBusy(false);patientRequirement();}
  });
  setBusy(true);
  try{
    if(!await window.HospitalAuth.ready)return;
    try{localStorage.removeItem('hospitalNewTransferDraft');}catch(_){}
    const result=await Promise.all([api.catalogs(),api.draft(),api.token()]);catalog=result[0];draftVersion=result[1].version;token=result[2].create_token;
    $('ambulance').replaceChildren(window.HospitalI18n.option(() => window.HospitalI18n.t("trace_new.buscar_ambulancia"), ''),...catalog.ambulances.map(item=>window.HospitalI18n.option(() => window.HospitalI18n.t("trace.ambulancia_value_value", {value0: item.code, value1: item.plate}), item.id)));
    $('crew-options').replaceChildren(...[...new Map(catalog.crew.map(item=>[item.id,item])).values()].map(item=>window.HospitalI18n.option(() => crewLabel(item), crewLabel(item))));
    $('facility-options').replaceChildren(...catalog.facilities.map(item=>window.HospitalI18n.option(() => facilityLabel(item), facilityLabel(item))));
    $('routeTemplate').replaceChildren(window.HospitalI18n.option(() => window.HospitalI18n.t("trace_view.escribir_recorrido_manualmente"), ''),...catalog.routes.map(item=>window.HospitalI18n.option(() => `${item.code} · ${item.name}`, item.id)));
    const now=api.localParts(Date.now());$('startDate').min=now.date;$('startDate').value=now.date;$('startTime').value=now.time;
    const savedRoute=result[1].payload?.routeTemplate;
    if(savedRoute&&!catalog.routes.some(r=>r.id===savedRoute))$('routeTemplate').add(window.HospitalI18n.option(() => window.HospitalI18n.t("trace.ruta_del_borrador_no_disponible"), savedRoute));
    for(const [name,value]of Object.entries(result[1].payload||{})){const control=form.elements.namedItem(name);if(!control)continue;if(control.type==='checkbox')control.checked=value===true;else control.value=value;}
    applyRoute(false);
    if(/^[a-f0-9]{64}$/.test(result[1].payload?.createToken??''))token=result[1].payload.createToken;
    if(result[1].payload?.patientId&&$('patientCedula').value){patientChoices=await api.patients($('patientCedula').value);showPatient(patientChoices.find(item=>item.id===result[1].payload.patientId)??null);}
    setBusy(false);patientRequirement();
  }catch(error){api.report(error);}

});
