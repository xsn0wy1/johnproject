document.addEventListener('DOMContentLoaded',async()=>{
  'use strict';
  const api=window.TraceApi,$=id=>document.getElementById(id),detail=$('transfer-detail'),editForm=$('edit-form');
  const id=new URLSearchParams(location.search).get('id');
  const nextStates={scheduled:['in_progress'],in_progress:['arrived'],arrived:['completed'],completed:[],cancelled:[]};
  const crewLabel=item=>`${item.full_name} · #${item.id}`,vehicleLabel=item=>`${item.code} · ${item.plate}`,patientLabel=item=>`${item.full_name} · ${item.national_id}`;
  let transfer,editBase,statusBase,cancelBase,catalog,patientChoices=[],patientTimer,patientRevision=0,busy=false,refreshing=false,pollTimer;
  let routeMap,routeLine,routeStops,routeMarker,routeGeometry,mapFrame;
  const triggers=new Map();
  function field(name,value){detail.querySelectorAll(`[data-field="${name}"]`).forEach(el=>{el.textContent=value??'—';});}
  function render(){
    detail.dataset.transferId=transfer.id;detail.dataset.status=transfer.status.replace('_','-');detail.dataset.priority=api.priority[transfer.priority];
    $('transfer-title').textContent=`TRASLADO ${transfer.id}`;document.documentElement.dataset.documentTitle=`TRASLADO ${transfer.id} · Hospital de Clínicas`;document.title=document.documentElement.dataset.documentTitle;
    detail.querySelectorAll('[data-status-label]').forEach(el=>{el.textContent=transfer.is_delayed?'Demorado':api.labels[transfer.status];});
    detail.querySelector('.created-at').textContent=`Creado el ${api.dateTime(transfer.created_at)}`;
    $('transfer-start-time').textContent=api.dateTime(transfer.started_at??transfer.scheduled_at);$('transfer-start-time').dateTime=transfer.started_at??transfer.scheduled_at;
    const doctor=transfer.crew.companion?.responsibility==='doctor'?transfer.crew.companion.name:null;
    const values={ambulance:transfer.ambulance.code,plate:transfer.ambulance.plate,origin:transfer.origin.name,destination:transfer.destination.name,driver:transfer.crew.driver?.name,
      patient:transfer.patient?.full_name,age:transfer.patient?.age,sex:({female:'Femenino',male:'Masculino',other:'Otro',unspecified:'Prefiere no indicar'})[transfer.patient?.sex],
      document:transfer.patient?.national_id,companion:transfer.crew.companion?.name,patientNotes:transfer.critical_patient?'Paciente en estado crítico':null,
      reason:api.reason[transfer.reason],cargo:api.cargo[transfer.cargo_type],priority:api.priority[transfer.priority],withDoctor:doctor?'Sí':'No',doctor,
      equipment:transfer.special_equipment?'Requiere equipamiento especial':'No solicitado',notes:[transfer.notes,transfer.route_snapshot?.stops?.length?`Paradas: ${transfer.route_snapshot.stops.map(s=>[s.name,s.address].filter(Boolean).join(' · ')).join(' → ')}`:''].filter(Boolean).join('\n')||null,
      distance:transfer.distance_meters===null?'—':`${(transfer.distance_meters/1000).toLocaleString('es-UY',{maximumFractionDigits:1})} km`,duration:transfer.duration_seconds===null?'—':`${Math.ceil(transfer.duration_seconds/60)} min`};
    Object.entries(values).forEach(([name,value])=>field(name,value));$('elapsed-time').textContent=transfer.started_at?`${Math.floor(transfer.elapsed_seconds/60)} min`:'—';
    const terminal=['completed','cancelled'].includes(transfer.status);
    $('edit-transfer').disabled=busy||!transfer.can_manage||transfer.status!=='scheduled';$('cancel-transfer').disabled=busy||!transfer.can_manage||terminal;$('update-status').disabled=busy||!transfer.can_manage||!nextStates[transfer.status].length;
    const timeline=detail.querySelector('.transfer-timeline');
    timeline.replaceChildren(...transfer.events.map((event,index)=>{
      const li=document.createElement('li');li.className=index===0?'timeline-start':index===transfer.events.length-1?'timeline-current':'';
      const dot=document.createElement('span');dot.className='timeline-dot';dot.setAttribute('aria-hidden','true');
      const title=document.createElement('strong');title.textContent=event.event_type==='created'?'Traslado programado':event.event_type==='updated'?'Datos actualizados':event.to_status?api.labels[event.to_status]:'Actividad del traslado';
      const time=document.createElement('time');time.dateTime=event.created_at;time.textContent=api.dateTime(event.created_at);li.append(dot,title,time);return li;
    }));
    $('route-map-link').href=`trace-map.html?transfer=${encodeURIComponent(id)}`;$('route-map-link').setAttribute('aria-label',`Abrir TRASLADO ${id} en el mapa de traslados`);
    renderMap();
  }
  function renderMap(){
    if(!transfer)return;
    if(transfer.geometry.length<2){routeMap?.remove();routeMap=null;routeGeometry=null;$('map-preview-status').textContent='Ruta pendiente de definir.';$('map-preview-status').hidden=false;return;}
    if(!window.L)return;
    const space=detail.querySelector('.map-space');if(!space.clientWidth||!space.clientHeight)return;
    const route=window.TraceMapShared.adapt(transfer),key=JSON.stringify(route.coordinates);
    if(!routeMap){
      $('map-preview-status').textContent='Cargando mapa…';
      routeMap=L.map('ambulance-map',{zoomControl:false,attributionControl:true,dragging:false,touchZoom:false,scrollWheelZoom:false,doubleClickZoom:false,boxZoom:false,keyboard:false,zoomAnimation:false});routeMap.attributionControl.setPrefix(false);
      window.TraceMapShared.createBasemap(routeMap,{onLoad:()=>{$('map-preview-status').hidden=true;},onError:()=>{$('map-preview-status').hidden=true;api.report(new Error('No se pudo cargar el mapa base.'));}});
      routeLine=L.polyline(route.coordinates,{color:route.color,weight:3,opacity:1,interactive:false}).addTo(routeMap);routeStops=L.layerGroup().addTo(routeMap);
      routeMarker=L.marker(route.currentPosition,{interactive:false,keyboard:false,icon:L.divIcon({className:'route-preview-marker',iconSize:[22,22],iconAnchor:[11,11],html:`<span class="route-preview-vehicle" style="--route-color:${route.color}"></span>`})}).addTo(routeMap);
    }
    if(key!==routeGeometry){
      routeLine.setLatLngs(route.coordinates);routeStops.clearLayers();[route.coordinates[0],route.coordinates.at(-1)].forEach(point=>L.circleMarker(point,{radius:4,color:route.color,weight:2,fillColor:'#101732',fillOpacity:1,interactive:false}).addTo(routeStops));routeGeometry=key;
      routeMap.fitBounds(route.coordinates,{padding:[14,14],maxZoom:15,animate:false});
    }
    routeMarker.setLatLng(route.currentPosition);routeMarker.getElement()?.setAttribute('data-position-id',route.positionId??'');routeMap.invalidateSize({pan:false});
  }
  new ResizeObserver(()=>{cancelAnimationFrame(mapFrame);mapFrame=requestAnimationFrame(()=>{renderMap();if(routeMap&&transfer?.geometry.length>=2)routeMap.fitBounds(transfer.geometry.map(p=>[p.latitude,p.longitude]),{padding:[14,14],maxZoom:15,animate:false});});}).observe(detail.querySelector('.map-space'));
  document.querySelectorAll('.transfer-dialog').forEach(dialog=>{
    dialog.querySelectorAll('[data-close-dialog]').forEach(button=>button.addEventListener('click',()=>dialog.close()));
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    dialog.addEventListener('close',()=>{const trigger=triggers.get(dialog);if(trigger?.disabled)document.querySelector('.back-link').focus();else trigger?.focus();});
  });
  function openDialog(dialog,trigger){triggers.set(dialog,trigger);dialog.showModal();}
  function setBusy(value){busy=value;document.querySelectorAll('.transfer-dialog input,.transfer-dialog select,.transfer-dialog textarea,.transfer-dialog button').forEach(control=>{control.disabled=value;});if(transfer)render();}
  async function save(work,dialog,text){
    if(busy)return;setBusy(true);
    try{transfer=await work();render();$('view-message').textContent=text;dialog.close();}
    catch(error){api.report(error);$('edit-message').textContent='';}
    finally{setBusy(false);}
  }
  $('edit-transfer').addEventListener('click',async event=>{
    if(busy||!transfer?.can_manage)return;const trigger=event.currentTarget;setBusy(true);
    try{
      catalog=await api.catalogs();editBase=transfer;editForm.elements.refreshRoute.checked=false;patientChoices=transfer.patient?[transfer.patient]:[];
      $('edit-ambulances').replaceChildren(...catalog.ambulances.map(item=>new Option(vehicleLabel(item),vehicleLabel(item))));
      $('edit-crew').replaceChildren(...[...new Map(catalog.crew.map(item=>[item.id,item])).values()].map(item=>new Option(crewLabel(item),crewLabel(item))));
      $('edit-facilities').replaceChildren(...catalog.facilities.map(item=>new Option(api.facilityLabel(item),api.facilityLabel(item))));
      editForm.elements.routeTemplate.replaceChildren(new Option('Escribir recorrido manualmente',''),...catalog.routes.map(item=>new Option(`${item.code} · ${item.name}`,item.id)));
      if(transfer.route_template_id&&!catalog.routes.some(r=>r.id===transfer.route_template_id))editForm.elements.routeTemplate.add(new Option(transfer.route_snapshot?.name||'Ruta del traslado (archivada)',transfer.route_template_id));
      const values={routeTemplate:transfer.route_template_id??'',ambulance:vehicleLabel(transfer.ambulance),driver:crewLabel({id:transfer.crew.driver.id,full_name:transfer.crew.driver.name}),companion:transfer.crew.companion?crewLabel({id:transfer.crew.companion.id,full_name:transfer.crew.companion.name}):'',origin:api.facilityLabel(transfer.origin),destination:api.facilityLabel(transfer.destination),patient:transfer.patient?patientLabel(transfer.patient):'',reason:transfer.reason,priority:transfer.priority,notes:transfer.notes};
      editForm.elements.reason.replaceChildren(...Object.entries(api.reason).map(([value,label])=>new Option(label,value)));editForm.elements.priority.replaceChildren(...Object.entries(api.priority).map(([value,label])=>new Option(label,value)));
      Object.entries(values).forEach(([name,value])=>{editForm.elements[name].value=value;});editForm.elements.patient.required=transfer.cargo_type==='patient';$('edit-message').textContent='';applyEditRoute(false);openDialog($('edit-dialog'),trigger);
    }catch(error){api.report(error);}finally{setBusy(false);}
  });
  function applyEditRoute(fill=true){
    const selected=editForm.elements.routeTemplate.value,route=catalog?.routes.find(r=>r.id===selected);
    for(const key of ['origin','destination']){editForm.elements[key].readOnly=Boolean(selected);if(fill&&route)editForm.elements[key].value=route[`${key}_address`]||route[`${key}_name`];else if(fill&&!selected)editForm.elements[key].value=editBase[key].address||editBase[key].name;}
  }
  editForm.elements.routeTemplate.addEventListener('change',()=>applyEditRoute());
  editForm.elements.patient.addEventListener('input',()=>{
    clearTimeout(patientTimer);const r=++patientRevision,q=editForm.elements.patient.value.trim();
    if(q.length<2)return;patientTimer=setTimeout(async()=>{try{const found=await api.patients(q);if(r!==patientRevision)return;patientChoices=[...(editBase.patient?[editBase.patient]:[]),...found];$('edit-patients').replaceChildren(...found.map(item=>new Option(patientLabel(item),patientLabel(item))));}catch(error){api.report(error);}},220);
  });
  editForm.addEventListener('submit',event=>{
    event.preventDefault();if(busy||!editForm.checkValidity())return;
    const value=name=>editForm.elements[name].value.trim(),base=api.fields(editBase);
    const vehicle=catalog.ambulances.find(item=>vehicleLabel(item)===value('ambulance'));
    const crew=(name,roles)=>catalog.crew.find(item=>crewLabel(item)===value(name)&&roles.includes(item.role_code));
    const driver=crew('driver',['driver']),companion=value('companion')?crew('companion',['copilot','doctor']):null;
    const patient=patientChoices.find(item=>patientLabel(item)===value('patient'));
    if(!vehicle||!driver||(!companion&&value('companion'))||(base.cargo_type==='patient'&&!patient)){api.report(new Error('Seleccioná personal, ambulancia y paciente de sus catálogos.'));return;}
    Object.assign(base,{ambulance_id:vehicle.id,driver_id:driver.id,companion_id:companion?.id??null,patient_id:base.cargo_type==='patient'?patient.id:null,
      ...api.locationFields('origin',value('origin'),catalog.facilities,editBase.origin),...api.locationFields('destination',value('destination'),catalog.facilities,editBase.destination),
      reason:value('reason'),priority:value('priority'),notes:value('notes')});
    base.route_template_id=value('routeTemplate')||null;
    const selectedRoute=catalog.routes.find(r=>r.id===base.route_template_id);
    base.refresh_route=editForm.elements.refreshRoute.checked;
    if(selectedRoute&&(base.route_template_id!==editBase.route_template_id||base.refresh_route))base.route_version=selectedRoute.version;
    save(()=>api.update({...base,id,version:editBase.version}),$('edit-dialog'),'Cambios guardados.');
  });
  $('update-status').addEventListener('click',event=>{statusBase=transfer;$('transfer-status').replaceChildren(...nextStates[transfer.status].map(status=>new Option(api.labels[status],status)));openDialog($('status-dialog'),event.currentTarget);});
  $('status-form').addEventListener('submit',event=>{event.preventDefault();save(()=>api.status(id,statusBase.version,$('transfer-status').value),$('status-dialog'),'Estado actualizado.');});
  $('cancel-transfer').addEventListener('click',event=>{cancelBase=transfer;openDialog($('cancel-dialog'),event.currentTarget);});
  $('cancel-form').addEventListener('submit',event=>{event.preventDefault();save(()=>api.status(id,cancelBase.version,'cancelled'),$('cancel-dialog'),'Traslado cancelado.');});
  async function refresh(){
    if(refreshing||busy||document.hidden||!transfer)return;refreshing=true;
    try{const snapshot=await api.snapshot({transfer_id:id}),item=snapshot.transfers[0];if(item.version!==transfer.version){transfer=await api.get(id);}else{Object.assign(transfer,{position:item.position,elapsed_seconds:item.elapsed_seconds,is_delayed:item.is_delayed,eta:item.eta});}render();}
    catch(error){api.report(error);}finally{refreshing=false;}
  }
  // Tabs keep every section accessible when the screen is too narrow for the grid.
  const tabs = Array.from(document.querySelectorAll('.detail-tabs [role="tab"]'));
  function selectTab(tab) {
    tabs.forEach((item) => {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      document.getElementById(item.dataset.panel).classList.toggle('is-selected', selected);
    });
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (event) => {
      let nextIndex;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;
      if (nextIndex === undefined) return;
      event.preventDefault();
      selectTab(tabs[nextIndex]);
      tabs[nextIndex].focus();
    });
  });
  const hero = document.querySelector('.trace-view-hero');
  new ResizeObserver(() => {
    const tabbed = getComputedStyle(document.querySelector('.detail-tabs')).display !== 'none';
    tabs.forEach((tab) => {
      const panel = document.getElementById(tab.dataset.panel);
      panel.setAttribute('role', tabbed ? 'tabpanel' : 'region');
      panel.setAttribute('aria-labelledby', tabbed ? tab.id : panel.querySelector('h2').id);
    });
  }).observe(hero);

  // Keep the imported navigation out of the keyboard order while collapsed.
  const shell = document.querySelector('.app-shell');
  const menuButton = document.querySelector('.sidebar-action');
  const navigation = document.querySelector('.sidebar-nav');
  function syncNavigation() {
    const open = shell.classList.contains('menu-open');
    navigation.inert = !open;
    menuButton.setAttribute('aria-expanded', String(open));
  }
  menuButton.addEventListener('click', syncNavigation);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && shell.classList.contains('menu-open') && !document.querySelector('dialog[open]')) {
      menuButton.click();
      menuButton.focus();
    }
  });
  syncNavigation();
  try{
    if(!await window.HospitalAuth.ready)return;
    if(!/^[1-9][0-9]*$/.test(id??''))throw new Error('Seleccioná un traslado desde la lista.');
    try{sessionStorage.removeItem('hospitalTransfer1View');}catch(_){}
    transfer=await api.get(id);render();pollTimer=setInterval(refresh,3000);
  }catch(error){api.report(error);$('transfer-title').textContent='';$('map-preview-status').hidden=true;}
  window.addEventListener('pagehide',()=>{clearInterval(pollTimer);clearTimeout(patientTimer);});
});
