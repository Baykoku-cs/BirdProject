/* Spatial preparation: QGIS. Observations: iNaturalist, see individual credits. */
(async function () {
  'use strict';
  // A file:// document cannot identify itself to OSM with an HTTP Referer.
  // Stop before creating the map or requesting any tiles in that context.
  if (location.protocol === 'file:') {
    document.body.className='file-launch-page';
    document.body.innerHTML='<main class="launch-notice"><p class="eyebrow">Птичья Дубна</p><h1>Откройте карту через запускатель</h1><p>Для подложки OpenStreetMap карта должна открываться по HTTP. При открытии обычного HTML-файла браузер не передаёт адрес страницы, и OSM может заблокировать подложку.</p><ol><li>В папке карты запустите <strong>ОткрытьКарту.sh</strong> в терминале.</li><li>Карта откроется в браузере автоматически. Окно терминала оставьте открытым на время работы.</li></ol><p>Также можно выполнить в папке карты:</p><pre>python3 start_atlas.py</pre><a class="button primary" href="http://127.0.0.1:8765/">Открыть уже запущенную карту</a></main>';
    return;
  }
  const $ = id => document.getElementById(id);
  const {filterObservations, clusterKind, countCells} = AtlasLogic;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const iconPath = speciesId => data?.species_icons?.[speciesId] || 'assets/other-bird-placeholder.svg';
  const previewIconPath = speciesId => data?.species_preview_icons?.[speciesId] || iconPath(speciesId);
  const safeUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
  const state = {query:'',species:[],season:'all',cell:null,tab:'species',limit:30,markersVisible:true};
  const dateLabel = value => new Intl.DateTimeFormat('ru', {day:'numeric',month:'long',year:'numeric'}).format(new Date(String(value).replaceAll('/','-') + 'T12:00:00'));
  let data, filtered = [], grid, homeBounds, clusters, cellCounts = new Map();
  let dataReady=false;
  const tileFailures=new Set();
  const map = L.map('map', {zoomControl:false, preferCanvas:true, minZoom:10, maxZoom:19, keyboard:true});
  L.control.zoom({position:'bottomright'}).addTo(map);
  L.control.scale({position:'bottomright',imperial:false,maxWidth:130}).addTo(map);
  const basemap=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom:19, referrerPolicy:'strict-origin-when-cross-origin',
    attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
  });
  function updateMapStatus() {
    if(!dataReady)return;
    const failed=tileFailures.size>0;
    $('map-status').hidden=!failed;
    $('map-status').classList.toggle('error',failed);
    if(failed)$('map-status').textContent='Подложка OpenStreetMap временно недоступна. Наблюдения и фильтры работают; проверьте подключение и обновите страницу.';
  }
  basemap.on('loading',()=>tileFailures.clear());
  basemap.on('tileerror',event=>{tileFailures.add(event.tile.src);updateMapStatus();});
  basemap.on('tileload',event=>tileFailures.delete(event.tile.src));
  basemap.on('load',updateMapStatus);
  basemap.addTo(map);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
  map.createPane('sectors'); map.getPane('sectors').style.zIndex = 410;
  map.createPane('sectorLabels'); map.getPane('sectorLabels').style.zIndex = 430; map.getPane('sectorLabels').style.pointerEvents = 'none';
  map.createPane('scope'); map.getPane('scope').style.zIndex = 420; map.getPane('scope').style.pointerEvents = 'none';
  const Home = L.Control.extend({options:{position:'bottomright'},onAdd() {
    const holder = L.DomUtil.create('div','leaflet-bar');
    const button = L.DomUtil.create('button','home-control',holder);
    button.title = 'Показать всю территорию'; button.setAttribute('aria-label',button.title);
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8M6 9v12h5v-7h3v7h4V9"/></svg>';
    L.DomEvent.disableClickPropagation(holder);
    button.addEventListener('click',()=> homeBounds && map.fitBounds(homeBounds,{padding:[38,38]}));
    return holder;
  }});
  new Home().addTo(map);

  function avatar(observations) {
    const kind = clusterKind(observations);
    const mixed = kind.kind === 'mixed';
    return L.divIcon({className:'bird-marker-icon',iconSize:[46,46],iconAnchor:[23,23],
      html:`<span class="bird-avatar${mixed?' mixed':''}">${mixed?'<span class="mixed-dots" aria-hidden="true">•••</span>':`<img src="${iconPath(kind.speciesId)}" alt="">`}${kind.count>1?`<span class="bird-counter">${kind.count}</span>`:''}</span>`});
  }
  function gridColor(count) { return count>60?'#236b49':count>30?'#519368':count>15?'#8bb980':count>5?'#bfd5a4':'#e6efd3'; }
  function gridStyle(feature) {
    const id = feature.properties.cell_id, count = cellCounts.get(id) || 0, selected = id === state.cell;
    return {color:selected?'#455e2a':'#839675',weight:selected?2.5:.7,opacity:selected?1:.55,
      fillColor:gridColor(count),fillOpacity:count?(state.markersVisible && map.getZoom()>=14?.10:.43):.015};
  }
  function setSidebar(open) {
    $('sidebar').dataset.open = String(open); $('sidebar-toggle').setAttribute('aria-expanded', String(open));
  }
  function setTab(tab) {
    state.tab=tab; state.limit=30;
    for (const name of ['species','observations']) {
      $(name+'-tab').classList.toggle('active',tab===name); $(name+'-tab').setAttribute('aria-selected',String(tab===name));
    }
    renderResults();
  }
  function makeResult(o, total, callback, secondary) {
    const button = document.createElement('button'); button.className='result-item';
    button.innerHTML=`<img src="${iconPath(o.species_id)}" alt=""><span class="result-copy"><span class="result-name">${escape(o.name_ru || o.name_sci)}</span><span class="result-meta">${escape(secondary)}</span></span>${total?`<span class="result-total">${total}</span>`:''}`;
    button.addEventListener('click',callback); return button;
  }
  function renderResults() {
    const visible = state.cell ? filtered.filter(o=>o.cell_id===state.cell) : filtered;
    $('cell-selection').hidden=!state.cell;
    if (state.cell) {
      const feature=data.grid.features.find(f=>f.properties.cell_id===state.cell);
      const area=feature?.properties.area_km2 || 1;
      $('cell-name').textContent = state.cell.replace('S1_','Клетка ').replaceAll('_',' · ');
      $('cell-count').textContent=`Записей: ${visible.length}${area<.99?' · у границы территории':''}`;
    }
    const container=$('results'); container.replaceChildren();
    if (!visible.length) {
      const empty=document.createElement('p'); empty.className='empty-state';
      empty.textContent=state.cell?'В этой клетке нет наблюдений с выбранными фильтрами. Можно выбрать другую клетку или снять её выбор.':'Наблюдений с такими фильтрами нет. Попробуйте другой вид или сезон.';
      container.append(empty); return;
    }
    let rows;
    if (state.tab==='species') {
      const groups=new Map();
      for (const o of visible) { const group=groups.get(o.species_id); if(group) group.count++; else groups.set(o.species_id,{o,count:1}); }
      rows=[...groups.values()].sort((a,b)=>b.count-a.count || a.o.name_ru.localeCompare(b.o.name_ru,'ru'));
      for(const {o,count} of rows.slice(0,state.limit)) container.append(makeResult(o,count,()=>{
        state.species=[String(o.species_id)]; state.tab='observations'; update();
      },o.name_sci));
    } else {
      rows=[...visible].sort((a,b)=>String(b.obs_date).localeCompare(String(a.obs_date)) || b.obs_id-a.obs_id);
      for(const o of rows.slice(0,state.limit)) container.append(makeResult(o,null,()=>{
        setSidebar(false); openObservation(o);
      },`${dateLabel(o.obs_date)} · ${o.sector_name}`));
    }
    if(rows.length>state.limit) {
      const more=document.createElement('button'); more.className='button more-button'; more.textContent=`Ещё ${Math.min(30,rows.length-state.limit)} из ${rows.length-state.limit}`;
      more.addEventListener('click',()=>{ const scroll=container.scrollTop; state.limit+=30; renderResults(); container.scrollTop=scroll; }); container.append(more);
    }
  }
  function setSpeciesPanel(open) {
    $('species-options-panel').hidden=!open; $('species-select').setAttribute('aria-expanded',String(open));
  }
  function renderSpeciesSelection() {
    const selected=new Set(state.species);
    const names=[];
    for(const input of $('species-options').querySelectorAll('input')) {
      input.checked=selected.has(input.value);if(input.checked)names.push(input.nextElementSibling.textContent);
    }
    $('species-selection-text').textContent=!names.length?'Все виды':names.length<=2?names.join(', '):`Выбрано видов: ${names.length}`;
    $('species-select').title=names.length?names.join(', '):'Все виды';
    $('species-all').textContent=names.length?'Снять выбор':'Все виды';
  }
  function update() {
    filtered=filterObservations(data.observations,state); cellCounts=countCells(filtered); state.limit=30;
    const speciesCount=new Set(filtered.map(o=>o.species_id)).size;
    $('filtered-count').textContent=filtered.length; $('filtered-species').textContent=speciesCount;
    $('species-word').textContent=speciesCount%10===1 && speciesCount%100!==11?'вид':speciesCount%10>=2 && speciesCount%10<=4 && !(speciesCount%100>=12 && speciesCount%100<=14)?'вида':'видов';
    renderSpeciesSelection();
    clusters.clearLayers();
    const markers=filtered.map(o=>{
      const marker=L.marker([o.latitude,o.longitude],{icon:avatar([o]),title:`${o.name_ru} · ${dateLabel(o.obs_date)}`,alt:o.name_ru,riseOnHover:true});
      marker.observation=o;
      marker.bindTooltip(`${escape(o.name_ru)}<br>${escape(dateLabel(o.obs_date))}`,{direction:'top',offset:[0,-22]});
      marker.on('click',()=>openObservation(o)); return marker;
    });
    clusters.addLayers(markers); grid.setStyle(gridStyle);
    grid.eachLayer(layer=>{const n=cellCounts.get(layer.feature.properties.cell_id)||0; layer.setTooltipContent(`Наблюдений: ${n}<br>Нажмите, чтобы посмотреть записи`);layer.getElement()?.setAttribute('aria-label',`Клетка ${layer.feature.properties.cell_id}, наблюдений: ${n}`);});
    for(const name of ['species','observations']) {
      $(name+'-tab').classList.toggle('active',state.tab===name); $(name+'-tab').setAttribute('aria-selected',String(state.tab===name));
    }
    renderResults();
  }
  const licenses={cc0:['CC0','https://creativecommons.org/publicdomain/zero/1.0/'],'cc-by':['CC BY','https://creativecommons.org/licenses/by/4.0/'],'cc-by-nc':['CC BY-NC','https://creativecommons.org/licenses/by-nc/4.0/']};
  function licenseLink(code) { const license=licenses[code]; return license?`<a href="${license[1]}" target="_blank" rel="noopener noreferrer">${license[0]}</a>`:escape(code || 'не указана'); }
  let cancelPhoto;
  function cleanupObservationMedia() {
    cancelPhoto?.(); cancelPhoto=null;
    for(const player of $('observation-audio').querySelectorAll('audio')) {
      player.pause(); player.removeAttribute('src'); player.load();
    }
    $('observation-audio').replaceChildren(); $('photo-retry').onclick=null;
  }
  $('observation-dialog').addEventListener('close',cleanupObservationMedia);
  function openObservation(o) {
    $('observation-title').textContent=o.name_ru || o.name_sci; $('scientific-name').textContent=o.name_sci;
    $('observation-date').textContent=`${dateLabel(o.obs_date)} · ${o.season.toLocaleLowerCase('ru')}`;
    const facts=[['Сектор',o.sector_name],['Место',o.place_text],['Координаты',`${Number(o.latitude).toFixed(6)}° с. ш., ${Number(o.longitude).toFixed(6)}° в. д.`],['Погрешность координат',`до ${Math.round(o.accuracy_m)} м`],['Наблюдатель',o.observer]];
    $('observation-facts').replaceChildren();
    for(const [title,value] of facts) {const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=title;dd.textContent=value || 'Не указано';$('observation-facts').append(dt,dd);}
    $('observation-source').href=safeUrl(o.source_url);
    $('observation-license').innerHTML=`Наблюдение № ${o.obs_id} · данные ${licenseLink(o.obs_license)}. Координаты приведены в том виде, в котором опубликованы в источнике.`;
    cleanupObservationMedia();
    const sounds=(o.audio || []).filter(a=>safeUrl(a.file_url));
    const container=$('observation-audio'); container.replaceChildren(); container.hidden=!sounds.length;
    if(sounds.length) {
      const heading=document.createElement('h3'); heading.textContent='Голос птицы'; container.append(heading);
      for(const [index,sound] of sounds.entries()) {
        const item=document.createElement('div'); item.className='audio-item';
        const label=document.createElement('p'); label.className='audio-label'; label.textContent=`Аудиозапись ${index+1}`;
        const player=document.createElement('audio'); player.controls=true; player.preload='none';
        player.src=safeUrl(sound.file_url); player.setAttribute('aria-label',`${o.name_ru} — аудиозапись ${index+1}`);
        const credit=document.createElement('p'); credit.className='audio-credit';
        credit.innerHTML=`${escape(sound.credit)} · ${licenseLink(sound.license)}`;
        const error=document.createElement('p'); error.className='audio-error'; error.hidden=true;
        error.textContent='Не удалось загрузить запись. Её можно открыть в iNaturalist.';
        player.addEventListener('error',()=>{error.hidden=false;});
        item.append(label,player,credit,error); container.append(item);
      }
    }
    const url=safeUrl(o.photo_url);
    $('photo-credit').replaceChildren();
    if(url) $('photo-credit').innerHTML=`${escape(o.photo_credit)} · ${licenseLink(o.photo_license)}${safeUrl(o.photo_page)?` · <a href="${safeUrl(o.photo_page)}" target="_blank" rel="noopener noreferrer">Оригинал фото</a>`:''}`;
    else $('photo-credit').textContent=sounds.length?'Аудиозапись относится к этому наблюдению. Иллюстрация выше обозначает вид.':'Иллюстрация обозначает вид, а не конкретное наблюдение.';
    $('fallback-icon').src=previewIconPath(o.species_id);
    function loadPhoto() {
      cancelPhoto?.();
      const photo=document.createElement('img'); photo.id='observation-photo'; photo.hidden=true;
      photo.alt=`${o.name_ru}, наблюдение ${dateLabel(o.obs_date)}, автор ${o.observer}`;
      $('observation-photo').replaceWith(photo);
      cancelPhoto=AtlasMedia.startPhotoLoad({image:photo,url,onState(status) {
        photo.hidden=status!=='loaded'; $('photo-loading').hidden=status!=='loading';
        $('photo-fallback').hidden=status==='loading' || status==='loaded';
        $('photo-retry').hidden=!['error','timeout'].includes(status);
        const messages={
          absent:[sounds.length?'В наблюдении есть аудиозапись':'Фотографии в выборке нет',sounds.length?'Послушайте голос птицы ниже. Это условная иллюстрация вида.':'Нет фотографии с подходящей лицензией. Источник можно открыть в iNaturalist.'],
          error:['Не удалось загрузить фотографию','Проверьте подключение или откройте оригинал в iNaturalist.'],
          timeout:['Фотография загружается дольше обычного','Прошло 8 секунд. Можно повторить загрузку или открыть оригинал в iNaturalist.']
        };
        if(messages[status]) { $('photo-fallback-title').textContent=messages[status][0]; $('photo-fallback-text').textContent=messages[status][1]; }
      }});
    }
    $('photo-retry').onclick=loadPhoto; loadPhoto();
    $('observation-dialog').showModal();
  }
  function setupDialog(id,closeId) {
    $(closeId).addEventListener('click',()=>$(id).close());
    $(id).addEventListener('click',event=>{if(event.target!==$(id))return;const r=$(id).getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$(id).close();});
  }
  setupDialog('observation-dialog','observation-close'); setupDialog('about-dialog','about-close');
  $('about-open').addEventListener('click',()=>$('about-dialog').showModal());
  $('sidebar-toggle').addEventListener('click',()=>setSidebar($('sidebar').dataset.open!=='true'));
  $('sidebar-close').addEventListener('click',()=>setSidebar(false));
  try {
    const response=await fetch('data/atlas.json?v=webp128-512-20261127'); if(!response.ok)throw new Error('Не удалось прочитать данные'); data=await response.json();
    homeBounds=L.geoJSON(data.scope).getBounds(); map.fitBounds(homeBounds,{padding:[38,38]});
    map.setMaxBounds(homeBounds.pad(1.2));
    L.geoJSON(data.scope,{pane:'scope',interactive:false,style:{color:'#5e7951',weight:1.7,dashArray:'6 5',fill:false,opacity:.85}}).addTo(map);
    L.geoJSON(data.sectors,{pane:'sectors',interactive:false,style:{color:'#718365',weight:1,dashArray:'3 4',fill:false,opacity:.5}}).addTo(map);
    const outerLabels=L.layerGroup().addTo(map),cityLabels=L.layerGroup();
    for(const f of data.sectors.features) L.marker(f.properties.label_latlng,{pane:'sectorLabels',interactive:false,keyboard:false,
      icon:L.divIcon({className:'sector-label',iconSize:[120,32],iconAnchor:[60,16],html:escape(f.properties.label)})}).addTo(f.properties.kind.includes('Район')?cityLabels:outerLabels);
    grid=L.geoJSON(data.grid,{renderer:L.svg(),style:gridStyle,onEachFeature(feature,layer){
      layer.bindTooltip('Наблюдений: 0',{sticky:true});
      const selectCell=()=>{state.cell=feature.properties.cell_id;setTab('observations');grid.setStyle(gridStyle);map.fitBounds(layer.getBounds().pad(.15),{maxZoom:15});setSidebar(true);};
      layer.on('click',selectCell);
      layer.on('add',()=>{const el=layer.getElement();el.setAttribute('role','button');el.setAttribute('tabindex','0');el.setAttribute('aria-label',`Клетка ${feature.properties.cell_id}, наблюдений: ${cellCounts.get(feature.properties.cell_id)||0}`);el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectCell();}});});
    }}).addTo(map);
    clusters=L.markerClusterGroup({maxClusterRadius:48,showCoverageOnHover:false,spiderfyOnMaxZoom:true,zoomToBoundsOnClick:true,animate:!matchMedia('(prefers-reduced-motion: reduce)').matches,
      iconCreateFunction:cluster=>avatar(cluster.getAllChildMarkers().map(m=>m.observation))}).addTo(map);
    const species=[...new Map(data.observations.map(o=>[o.species_id,o])).values()].sort((a,b)=>a.name_ru.localeCompare(b.name_ru,'ru'));
    for(const o of species) {
      const label=document.createElement('label'); label.className='species-option';
      const input=document.createElement('input'); input.type='checkbox'; input.value=String(o.species_id);
      const text=document.createElement('span'); text.textContent=o.name_ru || o.name_sci;
      label.dataset.search=(o.name_ru+' '+o.name_sci).toLocaleLowerCase('ru').replaceAll('ё','е');
      input.addEventListener('change',()=>{
        state.species=input.checked?[...state.species,input.value]:state.species.filter(id=>id!==input.value); update();
      });
      label.append(input,text); $('species-options').append(label);
    }
    let searchTimer;
    $('species-search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.query=$('species-search').value;update();},150);});
    $('species-select').addEventListener('click',()=>setSpeciesPanel($('species-options-panel').hidden));
    $('species-done').addEventListener('click',()=>{setSpeciesPanel(false);$('species-select').focus();});
    $('species-all').addEventListener('click',()=>{state.species=[];update();});
    $('species-options-search').addEventListener('input',()=>{
      const query=$('species-options-search').value.toLocaleLowerCase('ru').replaceAll('ё','е').trim();
      let visible=0; for(const option of $('species-options').children) {option.hidden=!option.dataset.search.includes(query);if(!option.hidden)visible++;}
      $('species-options-empty').hidden=visible>0;
    });
    document.addEventListener('click',event=>{if(!$('species-picker').contains(event.target))setSpeciesPanel(false);});
    $('species-picker').addEventListener('keydown',event=>{
      if(event.key==='Escape' && !$('species-options-panel').hidden){event.preventDefault();event.stopPropagation();setSpeciesPanel(false);$('species-select').focus();}
    });
    $('species-picker').addEventListener('focusout',event=>{if(event.relatedTarget && !$('species-picker').contains(event.relatedTarget))setSpeciesPanel(false);});
    $('season-select').addEventListener('change',()=>{state.season=$('season-select').value;update();});
    $('filters-reset').addEventListener('click',()=>{clearTimeout(searchTimer);Object.assign(state,{query:'',species:[],season:'all',cell:null});$('species-search').value='';$('season-select').value='all';$('species-options-search').value='';$('species-options-search').dispatchEvent(new Event('input'));setSpeciesPanel(false);update();});
    $('species-tab').addEventListener('click',()=>setTab('species'));$('observations-tab').addEventListener('click',()=>setTab('observations'));
    $('cell-clear').addEventListener('click',()=>{state.cell=null;grid.setStyle(gridStyle);renderResults();});
    $('markers-toggle').addEventListener('click',()=>{
      state.markersVisible=!state.markersVisible;
      state.markersVisible?clusters.addTo(map):map.removeLayer(clusters);
      const label=state.markersVisible?'Скрыть значки птиц':'Показать значки птиц';
      $('markers-toggle').setAttribute('aria-pressed',String(!state.markersVisible));
      $('markers-toggle').setAttribute('aria-label',label);$('markers-toggle').title=label;
      grid.setStyle(gridStyle);
    });
    $('grid-toggle').addEventListener('change',()=>{const on=$('grid-toggle').checked;on?grid.addTo(map):map.removeLayer(grid);document.querySelector('.legend-scale').hidden=!on;document.querySelector('.legend-description').hidden=!on;});
    function refreshLabels() {
      const zoom=map.getZoom();
      for(const [labels,visible] of [[outerLabels,zoom<15],[cityLabels,zoom>=13 && zoom<16]]) {
        if(visible && !map.hasLayer(labels))labels.addTo(map);else if(!visible && map.hasLayer(labels))map.removeLayer(labels);
      }
    }
    map.on('zoomend',()=>{grid.setStyle(gridStyle);refreshLabels();}); refreshLabels();
    update(); dataReady=true; updateMapStatus();
  } catch(error) {
    console.error(error);$('map-status').classList.add('error');$('map-status').textContent='Не удалось загрузить атлас. Обновите страницу. Если ошибка повторится, проверьте подключение.';
  }
})();
