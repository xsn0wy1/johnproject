/* Shared authorized transfer adapter and existing basemap configuration. */
(() => {
  'use strict';
  function createBasemap(map, { onLoad = () => {}, onFallback = () => {}, onError = () => {} } = {}) {
    const config = window.TRACE_MAP_CONFIG || {};
    const key = config.cartoApiKey || document.querySelector('meta[name="carto-basemap-key"]')?.content.trim();
    const osmAttribution = `${window.HospitalI18n.mark("trace_map_shared.copy")} <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">${window.HospitalI18n.mark("trace_map_shared.openstreetmap")}</a> ${window.HospitalI18n.mark("trace_map_shared.contributors")}`;
    const osm = () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: osmAttribution, className: 'osm-dark-tiles', keepBuffer: 2
    });
    const useCarto = Boolean(key) && !config.tileUrl;
    let layer = config.tileUrl ? L.tileLayer(config.tileUrl, {
      maxZoom: 19, attribution: config.attribution || osmAttribution,
      className: config.tileClassName || ''
    }) : useCarto ? L.tileLayer(`https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(key)}`, {
      maxZoom: 20, attribution: `${window.HospitalI18n.mark("trace_map_shared.value_copy", {value0: osmAttribution})} <a href="https://carto.com/attribution/" target="_blank" rel="noopener">${window.HospitalI18n.mark("trace_map_shared.carto")}</a>`
    }) : osm();
    let failures = 0;
    let loadedTiles = 0;
    function monitor(currentLayer, canFallback) {
      currentLayer.on('tileload', () => {
        loadedTiles += 1;
        onLoad();
      });
      currentLayer.on('tileerror', () => {
        failures += 1;
        if (canFallback && failures >= 3 && map.hasLayer(currentLayer)) {
          map.removeLayer(currentLayer);
          layer = osm();
          failures = 0;
          monitor(layer, false);
          layer.addTo(map);
          onFallback();
        } else if (!canFallback && failures >= 4 && loadedTiles === 0) {
          onError();
        }
      });
    }
    monitor(layer, Boolean(key || config.tileUrl));
    layer.addTo(map);
    return layer;
  }


  function adapt(item) {
    const status=item.status==='scheduled'?'scheduled':item.status==='arrived'?'arrived':item.status==='completed'?'completed':item.status==='cancelled'?'cancelled':item.is_delayed?'delayed':'in_progress';
    const coordinates=item.geometry.map(p=>[p.latitude,p.longitude]);
    return {id:item.id,get name(){return window.HospitalI18n.t("trace.traslado_value", {value0: item.id});},ambulance:item.ambulance.code,origin:item.origin.name,destination:item.destination.name,
      eta:window.TraceApi.time(item.eta).slice(0,5),status,color:['#8b5cf6','#3b82f6','#06b6d4','#10b981','#f97316'][Number(item.id)%5],coordinates,
      currentPosition:item.position?[item.position.latitude,item.position.longitude]:coordinates[0],sampledAt:item.position?.recorded_at,positionId:item.position?.id??null,
      lifecycle:item.status,distanceMeters:item.distance_meters};
  }
  window.TraceMapShared=Object.freeze({createBasemap,adapt});
})();
