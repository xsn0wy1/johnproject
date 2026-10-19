(() => {
  'use strict';
  const api=window.HospitalApi, path=name=>`transfers/${name}.php`;
  const labels={scheduled:'Programado',in_progress:'En curso',arrived:'En destino',completed:'Finalizado',cancelled:'Cancelado'};
  const cargo={patient:'Paciente',biological:'Biológico',equipment:'Equipo'};
  const priority={low:'Baja',normal:'Normal',high:'Alta',critical:'Crítica'};
  const reason={consulta:'Consulta médica',estudio:'Estudio o tratamiento',alta:'Alta médica',emergencia:'Emergencia',insumos:'Traslado de insumos'};
  const dateTime=value=>value?new Intl.DateTimeFormat('es-UY',{timeZone:'America/Montevideo',dateStyle:'short',timeStyle:'short',hour12:false}).format(new Date(value)):'—';
  const time=value=>value?new Intl.DateTimeFormat('es-UY',{timeZone:'America/Montevideo',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value)):'—';
  function localParts(value){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Montevideo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));
    const p=Object.fromEntries(parts.map(part=>[part.type,part.value]));return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};
  }
  const facilityLabel=item=>[item.name,item.address,item.locality].filter(Boolean).join(' · ');
  function findFacility(text,facilities){
    const exact=facilities.find(f=>facilityLabel(f)===text);if(exact)return exact;
    const names=facilities.filter(f=>f.name===text);return names.length===1?names[0]:null;
  }
  function locationFields(prefix,text,facilities,previous=null){
    text=text.trim();
    const keep=previous && (text===facilityLabel(previous)||text===previous.name);
    const item=keep?previous:findFacility(text,facilities);
    return {[`${prefix}_facility_id`]:item?.id??null,[`${prefix}_name`]:item?.name??text,[`${prefix}_address`]:item?.address??''};
  }
  function fields(item){
    const p=localParts(item.scheduled_at);
    return {route_template_id:item.route_template_id,ambulance_id:item.ambulance.id,driver_id:item.crew.driver.id,companion_id:item.crew.companion?.id??null,patient_id:item.patient?.id??null,origin_facility_id:item.origin.id,destination_facility_id:item.destination.id,origin_name:item.origin.name,origin_address:item.origin.address,destination_name:item.destination.name,destination_address:item.destination.address,scheduled_at:`${p.date}T${p.time}:00-03:00`,cargo_type:item.cargo_type,priority:item.priority,reason:item.reason,notes:item.notes,special_equipment:item.special_equipment,with_family:item.with_family,interdepartmental:item.interdepartmental,critical_patient:item.critical_patient};
  }
  window.TraceApi=Object.freeze({labels,cargo,priority,reason,dateTime,time,localParts,fields,facilityLabel,locationFields,
    report:error=>api.report(error,'transfers'),
    get:id=>api.get(`${path('get')}?${new URLSearchParams({id})}`),
    list:query=>api.request(path('list'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(query)},true,true),
    catalogs:()=>api.get(path('catalogs')),patients:q=>api.post(path('patients'),{q}),
    token:()=>api.get(path('create-token')),create:body=>api.post(path('create'),body),update:body=>api.post(path('update'),body),
    status:(id,version,status)=>api.post(path('status'),{id,version,status}),
    draft:()=>api.get(path('draft')),saveDraft:body=>api.post(path('draft'),body),
    snapshot:query=>api.get(`tracking/snapshot.php?${new URLSearchParams(query||{})}`),
    async fleet(){let cursor=null,items=[],result;do{result=await this.snapshot(cursor?{after_id:cursor}:{});items.push(...result.transfers);cursor=result.next_cursor;}while(cursor);return {...result,transfers:items};}
  });
})();
