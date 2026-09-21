import {acceptedLabels,acceptedPurposes,buildFacets,displayTime,duration,itemKey,matchesDiscovery,matchesTopics,matchesPurposes,purposeState,resultState,safeThumbnail,warningText} from './explore-data.mjs';
import {PURPOSES} from './purposes.mjs';
import {LIMITS,normalizeInput,parseTranscript} from './shared.mjs';

const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,cls,fn)=>{const n=el('button',text,cls);n.type='button';n.onclick=fn;return n;};
const icons={chevron:'M9 5l7 7-7 7',list:'M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1',grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',play:'M9 5l11 7-11 7z',branch:'M5 4v16M5 8h13M5 17h13M18 5v6M18 14v6'};
function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [k,v] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.6','aria-hidden':'true'}))svg.setAttribute(k,v);const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',icons[name]);svg.append(path);return svg;}
const stateNames={unassessed:'미분류',running:'분류 중',classified:'분류 완료',review:'추가 근거 권고',partial:'부분 평가',abstained:'판단 보류',error:'분류 실패'};
const filters=[['all','전체'],['unassessed','미분류'],['classified','분류 완료'],['review','검토 필요'],['error','실패']];
const needsReview=item=>['review','partial','abstained'].includes(resultState(item));
const fieldNames={title:'제목',description:'설명',tags:'태그',youtube_category_id:'YouTube 카테고리 · 참고 정보',channel_title:'채널 · 참고 정보'};
const welcome=$('video-list').firstElementChild.cloneNode(true);
const treeWelcome=$('topic-tree').firstElementChild.cloneNode(true);
let config=null,collection=null,items=[],selected=new Set(),topicOperator='AND',stateFilter='all',listView=false,busy=null,controller=null,detailItem=null;
const topics=new Map(),purposes=new Set();
const purposeOptions=[...PURPOSES,{id:'not_assessed',name:'목적 미평가'},{id:'abstained',name:'목적 판단 보류'}];
const discoveryFilters=()=>({topics:[...topics.keys()],operator:topicOperator,purposes:[...purposes]});
const hasFilters=()=>topics.size>0 || purposes.size>0 || stateFilter!=='all';
const matchesState=(item,value=stateFilter)=>value==='all' || (value==='review'?needsReview(item):resultState(item)===value);
function clearFilters(){topics.clear();purposes.clear();topicOperator='AND';stateFilter='all';}
const closedBranches=new Set();
const transcriptDrafts=new WeakMap();
const MAX_RESULTS=100;
const visitedPages=new Set();
let paginationPaused=null,paginationEnd='',loadingMore=false,scrollCheck=null;

function hasNextPage(){return collection?.mode==='youtube_search' && !!collection.next_page_token && items.length<MAX_RESULTS;}
function scheduleNextPage(){
  if(scrollCheck!==null)return;
  scrollCheck=requestAnimationFrame(()=>{
    scrollCheck=null;
    if(busy || paginationPaused || detailItem || hasFilters() || !hasNextPage())return;
    const bounds=$('scroll-sentinel').getBoundingClientRect();
    if(bounds.top<=innerHeight+240 && bounds.bottom>=0)search(true);
  });
}
function renderPagination(){
  const container=$('pagination');container.hidden=!collection || collection.mode==='fixture_demo';
  const next=hasNextPage(),filtered=hasFilters(),unfinished=items.some(selectable);
  const count=`${items.length} / ${MAX_RESULTS}개 영상`;
  $('scroll-cancel').hidden=busy!=='classify' && !(busy==='search'&&loadingMore);
  $('load-more').hidden=!!busy || (!paginationPaused && !(filtered&&next));
  if(paginationPaused==='stopped')$('load-more').hidden=!!busy || (!unfinished&&!next);
  else if(paginationPaused)$('load-more').hidden=!!busy || !next;
  $('load-more').textContent=filtered?'필터 해제하고 계속 탐색':paginationPaused==='stopped'?'분류와 탐색 계속하기':'다시 불러오기';
  $('scroll-status').textContent=busy==='search'?`검색 결과를 불러오고 있습니다 · ${count}`:
    busy==='classify'?`불러온 영상을 분류하고 있습니다 · ${items.filter(x=>x.result).length}개 평가 · ${count}`:
    paginationPaused==='stopped'?`탐색을 중단했습니다. 완료된 결과는 유지됩니다 · ${count}`:
    paginationPaused==='error'?`다음 결과를 불러오지 못했습니다. 다시 시도할 수 있습니다 · ${count}`:
    paginationPaused==='empty'?`이번 페이지에 새로운 영상이 없습니다. 다음 페이지를 확인할 수 있습니다 · ${count}`:
    items.length>=MAX_RESULTS?`100개 영상까지 불러왔습니다. 새 검색으로 탐색을 이어가세요.`:
    paginationEnd?`${paginationEnd} · ${count}`:
    next?(filtered?`현재 모은 영상에 필터를 적용했습니다. 필터를 해제하면 다음 결과를 불러옵니다 · ${count}`:`아래로 스크롤하면 다음 영상을 자동으로 불러와 분류합니다 · ${count}`):`검색 결과를 모두 불러왔습니다 · ${count}`;
  scheduleNextPage();
}
function stopBrowse(){paginationPaused='stopped';controller?.abort();renderPagination();}
async function resumeBrowse(){
  if(busy)return;
  if(hasFilters()){clearFilters();render();}
  const resumeClassification=paginationPaused==='stopped' && items.some(selectable);
  paginationPaused=null;
  if(resumeClassification)await classifyItems(items.filter(selectable));
  else if(hasNextPage())await search(true);
  renderPagination();
}

function notify(message,info=false){$('notice').textContent=message;$('notice').className=`notice${info?' info':''}`;$('notice').hidden=false;}
function ensureConnection(inference=false){
  if(!config?.metadata_available || (inference&&!config?.live_available)){notify(inference?'서버에 YouTube API 키와 Jev 키를 설정해 주세요. 합성 데모는 연결 없이 사용할 수 있습니다.':'서버에 YouTube API 키를 설정해 주세요. 합성 데모는 연결 없이 사용할 수 있습니다.');return false;}
  return true;
}
async function api(path,body,signal){
  const options=body===undefined?{signal}:{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};
  const response=await fetch(path,options);
  let data;try{data=await response.json();}catch{throw new Error('서버 응답을 읽을 수 없습니다. 연결 상태를 확인해 주세요.');}
  if(!response.ok){const e=new Error(data.error?.message??'요청에 실패했습니다. 다시 시도해 주세요.');e.code=data.error?.code;e.status=response.status;throw e;}return data;
}
function setBusy(value){
  busy=value;
  for(const id of ['search-submit','query','search-limit','demo','leave-demo','load-more'])$(id).disabled=!!value;
  for(const control of document.querySelectorAll('.transcript-control'))control.disabled=!!value;
  const cancel=document.querySelector('[data-supplement-cancel]');if(cancel)cancel.hidden=!transcriptDrafts.get(detailItem)?.running;
  $('search-submit').firstChild.textContent=value==='search'?'검색 중… ':value==='classify'?'분류 중… ':'검색하고 분류 ';
  $('cancel').hidden=value!=='classify';
  $('results').setAttribute('aria-busy',String(value==='search'));
  updateSelection();
  renderPagination();
}
function visibleItems(){
  const rows=items.filter(item=>matchesDiscovery(item,discoveryFilters()) && matchesState(item));
  if($('sort').value==='classified')rows.sort((a,b)=>Number(!!b.result)-Number(!!a.result) || a.collection_rank-b.collection_rank);
  return rows;
}
function selectable(item){return !item.result && !item.fixture_id && item.state!=='running';}
function updateSelection(){
  const candidates=visibleItems().filter(selectable),count=candidates.filter(x=>selected.has(itemKey(x))).length;
  $('select-all').checked=!!candidates.length && count===candidates.length;
  $('select-all').indeterminate=count>0 && count<candidates.length;
  $('select-all').disabled=!!busy || !candidates.length;
  document.querySelector('.select-all').hidden=busy==='classify';
  $('selection-count').textContent=busy==='classify'?'결과를 순서대로 분류하고 있습니다.':selected.size?`${selected.size}개 선택`:'미분류·실패 영상은 다시 시도할 수 있습니다.';
  $('classify').hidden=busy==='classify';
  $('classify').textContent=selected.size?`선택 ${selected.size}개 다시 시도`:'선택 영상 다시 시도';
  $('classify').disabled=!!busy || !selected.size || collection?.mode==='fixture_demo';
}
function setTopic(node){if(!node)topics.clear();else if(topics.has(node.id))topics.delete(node.id);else topics.set(node.id,node);render();if(node)$('topic-tree').querySelector(`[data-category="${CSS.escape(node.id)}"] input`)?.focus();}
function setPurpose(id){if(purposes.has(id))purposes.delete(id);else purposes.add(id);render();$('purpose-filters').querySelector(`[data-purpose="${CSS.escape(id)}"]`)?.focus();}
function toggleTopics(open){document.querySelector('.facet-panel').classList.toggle('topics-open',open);$('topics-toggle').textContent=open?'주제 접기':'주제 펼치기';$('topics-toggle').setAttribute('aria-expanded',String(open));}
function renderTree(){
  $('all-count').textContent=collection?String(items.length):'—';
  $('all-topics').classList.toggle('active',!topics.size);$('all-topics').setAttribute('aria-pressed',String(!topics.size));
  $('reset-filters').disabled=!hasFilters();
  for(const input of $('topic-operator').querySelectorAll('input'))input.checked=input.value===topicOperator;
  const root=$('topic-tree');root.replaceChildren();const facets=buildFacets(items);
  if(!facets.length){root.append(treeWelcome.cloneNode(true));if(collection)root.querySelector('p').textContent=items.some(i=>i.result)?'수락된 IAB 분류가 없습니다. 판단 보류와 미평가는 관련 없음이 아닙니다.':busy==='classify'?'검색 결과를 분류하고 있습니다. 완료된 주제부터 표시합니다.':'아직 분류된 주제가 없습니다. 남은 영상의 분류를 다시 시도할 수 있습니다.';return;}
  function branch(n){
    const wrap=el('div',undefined,'facet-node'),row=el('div',undefined,'facet-row'),children=el('div',undefined,'facet-children');
    children.hidden=closedBranches.has(n.id);
    if(n.children.length){const toggle=button(undefined,'facet-toggle',()=>{if(closedBranches.has(n.id))closedBranches.delete(n.id);else closedBranches.add(n.id);children.hidden=closedBranches.has(n.id);toggle.setAttribute('aria-expanded',String(!children.hidden));});toggle.append(icon('chevron'));toggle.setAttribute('aria-label',`${n.name} 하위 주제`);toggle.setAttribute('aria-expanded',String(!children.hidden));row.append(toggle);}else row.append(el('span',undefined,'facet-spacer'));
    const choose=el('label',undefined,`facet-select${topics.has(n.id)?' active':''}`),check=el('input');check.type='checkbox';check.checked=topics.has(n.id);check.onchange=()=>setTopic(n);check.setAttribute('aria-label',n.path.join(' › '));choose.dataset.category=n.id;choose.title=n.path.join(' › ');choose.append(check,el('span',n.name,'facet-name'),el('span',String(n.videos.size),'facet-count'));row.append(choose);wrap.append(row);
    if(n.children.length){children.append(...n.children.map(branch));wrap.append(children);}return wrap;
  }
  root.append(...facets.map(branch));
}
function renderPurposes(){
  $('purpose-panel').hidden=!collection;
  const root=$('purpose-filters');root.replaceChildren();
  const candidates=items.filter(item=>matchesTopics(item,[...topics.keys()],topicOperator)&&matchesState(item));
  const all=button('모든 목적',`purpose-filter${!purposes.size?' active':''}`,()=>{purposes.clear();render();$('purpose-filters').firstElementChild.focus();});all.setAttribute('aria-pressed',String(!purposes.size));root.append(all);
  for(const purpose of purposeOptions){
    const count=candidates.filter(item=>matchesPurposes(item,[purpose.id])).length;
    const b=button(undefined,`purpose-filter${purposes.has(purpose.id)?' active':''}`,()=>setPurpose(purpose.id));
    b.append(el('span',purpose.name),el('span',String(count),'purpose-count'));b.dataset.purpose=purpose.id;b.setAttribute('aria-pressed',String(purposes.has(purpose.id)));b.disabled=!count&&!purposes.has(purpose.id);root.append(b);
  }
}
function renderActiveFilters(){
  const root=$('active-topic');root.hidden=!topics.size&&!purposes.size;root.replaceChildren();
  if(topics.size)root.append(el('span',topicOperator==='AND'?'모든 주제 포함':'주제 중 하나 포함','filter-operator-label'));
  for(const node of topics.values()){
    const b=button(`${node.path.at(-1)} 해제`,'filter-remove',()=>setTopic(node));b.title=node.path.join(' › ');root.append(b);
  }
  for(const id of purposes){const p=purposeOptions.find(p=>p.id===id);root.append(button(`${p.name} 해제`,'filter-remove',()=>setPurpose(id)));}
  root.append(button('조건 초기화','text-button',resetFilters));
}
function badge(item){const s=resultState(item);return el('span',stateNames[s],`state-badge state-${s}`);}
function placeholder(item){const p=el('div',undefined,'thumb-placeholder');p.append(icon(item.fixture_id?'branch':'play'),el('span',item.fixture_id?'합성 콘텐츠 예시':'미리보기 없음'));return p;}
function card(item){
  const key=itemKey(item),article=el('article',undefined,`video-card${selected.has(key)?' is-selected':''}`);article.dataset.video=key;
  const thumb=el('div',undefined,'thumbnail'),open=button(undefined,'thumbnail-button',()=>showDetail(item));open.setAttribute('aria-label',`${item.video.title} 상세 보기`);
  const src=safeThumbnail(item.video.thumbnail_url);
  if(src){const image=el('img');image.src=src;image.alt='';image.loading='lazy';image.referrerPolicy='no-referrer';image.onerror=()=>open.replaceChildren(placeholder(item));open.append(image);}else open.append(placeholder(item));thumb.append(open);
  if(!item.fixture_id && selectable(item) && !busy){const check=el('label',undefined,'card-checkbox'),input=el('input');input.type='checkbox';input.checked=selected.has(key);input.setAttribute('aria-label',`${item.video.title} 다시 시도할 영상으로 선택`);input.onchange=()=>{if(input.checked)selected.add(key);else selected.delete(key);article.classList.toggle('is-selected',input.checked);updateSelection();};check.append(input);thumb.append(check);}else if(item.fixture_id)thumb.append(el('span','합성 데모','fixture-mark'));
  const length=duration(item.video.duration_iso8601);if(length)thumb.append(el('span',length,'video-duration'));
  const body=el('div',undefined,'video-body'),title=button(undefined,'card-title',()=>showDetail(item));title.append(el('span',item.video.title));
  const date=item.video.published_at && !Number.isNaN(Date.parse(item.video.published_at))?new Date(item.video.published_at).toLocaleDateString('ko-KR'):'';
  body.append(title,el('p',[item.video.channel_title,date].filter(Boolean).join(' · '),'video-byline'));
  const meta=el('div',undefined,'video-meta');meta.append(badge(item),el('span',item.fixture_id?'고정 예시':`검색 순서 ${item.collection_rank}`,'search-rank'));body.append(meta);
  const labels=acceptedLabels(item.result);
  if(labels.length){const chips=el('div',undefined,'card-topics');for(const l of labels.slice(0,2)){const chip=button(l.name,'topic-chip',()=>setTopic({id:l.category_id,path:l.path}));chip.title=l.path.join(' › ');chips.append(chip);}if(labels.length>2)chips.append(button(`+${labels.length-2}`,'topic-chip',()=>showDetail(item)));body.append(chips);}
  const purposeLabels=acceptedPurposes(item.result);
  if(purposeLabels.length){const tags=el('div',undefined,'card-purposes');tags.append(el('span','목적','purpose-caption'));for(const p of purposeLabels){const tag=button(p.name,'purpose-tag',()=>setPurpose(p.purpose_id));tag.setAttribute('aria-label',`${p.name} 목적 필터`);tags.append(tag);}body.append(tags);}
  if(item.error)body.append(el('p',item.error,'card-error'));
  article.append(thumb,body);return article;
}
function render(){
  const hasCollection=!!collection,isDemo=collection?.mode==='fixture_demo';
  $('demo-banner').hidden=!isDemo;$('collection-toolbar').hidden=!hasCollection || isDemo || (!items.some(selectable)&&busy!=='classify');$('filter-toolbar').hidden=!hasCollection;
  $('sort').options[0].textContent=isDemo?'데모 예시 순서':'YouTube 검색 순서';
  $('export').disabled=!hasCollection || !items.length;
  $('results-title').textContent=hasCollection?`${collection.query}`:'탐색할 영상을 찾아보세요';
  const assessed=items.filter(x=>x.result).length,attempts=items.reduce((n,x)=>n+(x.result?.usage.http_attempts??0)+(x.previous_results??[]).reduce((sum,r)=>sum+r.usage.http_attempts,0),0);
  $('result-summary').textContent=hasCollection?`${items.length}개 영상 · ${assessed}개 평가 · ${items.length-assessed}개 미평가${attempts?` · Jev HTTP ${attempts}회`:''}${isDemo?' · 실제 호출 없음':''}`:'검색이 완료되면 Jev가 자동으로 주제를 분류합니다.';
  if(hasCollection&&hasFilters())$('result-summary').textContent+=` · ${visibleItems().length}개 표시`;
  renderTree();renderPurposes();
  const filterRoot=$('state-filters');filterRoot.replaceChildren();
  for(const [value,name] of filters){const count=items.filter(x=>matchesDiscovery(x,discoveryFilters())&&matchesState(x,value)).length;const b=button(`${name} ${count}`,`state-filter${stateFilter===value?' active':''}`,()=>{stateFilter=value;render();$('state-filters').querySelector(`[data-filter="${value}"]`)?.focus();});b.dataset.filter=value;b.setAttribute('aria-pressed',String(stateFilter===value));filterRoot.append(b);}
  renderActiveFilters();
  const list=$('video-list');list.classList.toggle('list-view',listView);list.replaceChildren();
  const visible=visibleItems();
  if(!hasCollection)list.append(welcome.cloneNode(true));
  else if(!visible.length){const empty=el('div',undefined,'empty-state');empty.append(el('h3',items.length?'이 조건에 해당하는 영상이 없습니다.':'검색 결과가 없습니다.'),el('p',items.length?'주제·목적·상태 조건을 줄이거나 주제를 OR로 조합해 보세요.':'검색어를 바꾸거나 범위를 넓혀 다시 검색해 보세요.'));if(items.length)empty.append(button('필터 초기화','button secondary small',resetFilters));list.append(empty);}
  else list.append(...visible.map(card));
  renderPagination();
  $('view-toggle').replaceChildren(icon(listView?'grid':'list'));$('view-toggle').setAttribute('aria-label',listView?'격자로 보기':'목록으로 보기');$('view-toggle').title=listView?'격자로 보기':'목록으로 보기';
  updateSelection();
}
function resetFilters(){clearFilters();render();}
function skeleton(){const list=$('video-list');list.replaceChildren();for(let i=0;i<6;i++){const x=el('div',undefined,'skeleton');x.append(el('div',undefined,'thumbnail'),el('div',undefined,'skeleton-line'),el('div',undefined,'skeleton-line short'));list.append(x);}}
async function search(more=false){
  if(busy || (more&&!hasNextPage()) || !ensureConnection(true))return;
  const query=more?collection?.query:$('query').value.trim();if(!query)return;
  const added=[],pageToken=more?collection.next_page_token:null;let searchSucceeded=false;
  loadingMore=more;
  controller=new AbortController();setBusy('search');$('notice').hidden=true;
  if(!collection)skeleton();
  try{
    const data=await api('/api/youtube/search',{query,limit:Math.min(Number($('search-limit').value),more?MAX_RESULTS-items.length:20),...(more?{page_token:pageToken}:{})},controller.signal);
    if(!more){items=[];selected.clear();clearFilters();closedBranches.clear();visitedPages.clear();paginationEnd='';$('batch-status').hidden=true;}
    paginationPaused=null;
    if(pageToken)visitedPages.add(pageToken);
    const existing=new Set(items.map(itemKey));const base=items.length;
    for(const item of data.items)if(items.length<MAX_RESULTS && !existing.has(itemKey(item))){const candidate={...item,collection_rank:items.length+1};items.push(candidate);added.push(candidate);existing.add(itemKey(item));}
    collection={...data,items:undefined,searched_at:new Date().toISOString(),unavailable_video_ids:[...(more?collection?.unavailable_video_ids??[]:[]),...data.unavailable_video_ids]};
    if(collection.next_page_token && visitedPages.has(collection.next_page_token)){collection.next_page_token=null;paginationEnd='같은 페이지 정보가 반복되어 추가 탐색을 멈췄습니다';}
    if(data.unavailable_video_ids.length)notify(`${data.unavailable_video_ids.length}개 영상의 공개 정보를 가져오지 못했습니다. 확인된 영상만 표시합니다.`,true);
    if(items.length===base && hasNextPage())paginationPaused='empty';
    searchSucceeded=true;
  }catch(e){paginationPaused=e.name==='AbortError'?'stopped':'error';notify(e.name==='AbortError'?'검색을 중단했습니다. 기존 목록을 유지합니다.':`검색하지 못했습니다. ${e.message}${collection?' 기존 목록을 유지합니다.':''}`);}
  finally{controller=null;loadingMore=false;setBusy(null);render();}
  if(searchSucceeded && added.length)await classifyItems(added,{automatic:true});
}
async function classifySelected(){
  await classifyItems(items.filter(x=>selected.has(itemKey(x))));
}
async function classifyItems(candidates,{automatic=false}={}){
  if(busy || !ensureConnection(true))return;
  const queue=candidates.filter(selectable);if(!queue.length)return;
  controller=new AbortController();setBusy('classify');if(!automatic)$('notice').hidden=true;$('batch-status').hidden=false;
  $('batch-progress').max=queue.length;$('batch-progress').value=0;let done=0,failed=0,stopped=false;
  for(const item of queue){
    if(controller.signal.aborted){stopped=true;break;}
    item.state='running';delete item.error;render();
    $('batch-text').textContent=`${item.video.title} — 분류 중`;$('batch-count').textContent=`${done} / ${queue.length}`;
    try{
      item.result=await api('/api/youtube/classify',{youtube_url:item.youtube_url,consent:true},controller.signal);
      item.classified_at=new Date().toISOString();selected.delete(itemKey(item));
    }catch(e){
      if(controller.signal.aborted || e.name==='AbortError'){stopped=true;break;}
      item.error=e.message;failed++;selected.delete(itemKey(item));
      if([401,403,503].includes(e.status)){stopped=true;notify(`분류를 중단했습니다. ${e.message}`);done++;break;}
    }finally{delete item.state;}
    done++;$('batch-progress').value=done;$('batch-count').textContent=`${done} / ${queue.length}`;
    if(detailItem===item)renderDetail(item);
  }
  if(stopped)paginationPaused='stopped';
  controller=null;setBusy(null);render();if(detailItem)renderDetail(detailItem);
  $('batch-text').textContent=stopped?'분류를 중단했습니다. 완료된 결과는 유지됩니다.':`${automatic?'검색 결과':'선택한 영상'} 평가가 끝났습니다.${failed?` ${failed}개 실패 — 다시 선택해 재시도할 수 있습니다.`:''}`;
  $('batch-progress').value=done;$('batch-count').textContent=`${done} / ${queue.length}`;
  if(stopped&&$('notice').hidden)notify('완료된 분류는 유지했습니다. 취소 시점에 전송된 호출은 quota 또는 과금에 포함될 수 있습니다.',true);
}
function section(title){const n=el('section',undefined,'detail-section');n.append(el('h3',title));return n;}
function transcriptEditor(item){
  let draft=transcriptDrafts.get(item);
  if(!draft){draft={text:'',open:false,message:'',running:false};transcriptDrafts.set(item,draft);}
  const editor=el('details',undefined,'transcript-editor');editor.open=draft.open;
  editor.ontoggle=()=>{draft.open=editor.open;};editor.append(el('summary','자막으로 근거 보완'));
  const content=el('div',undefined,'transcript-fields'),label=el('label','자막 내용');label.htmlFor='supplement-transcript';
  const input=el('textarea',undefined,'transcript-control');input.id='supplement-transcript';input.rows=6;input.maxLength=LIMITS.transcriptChars;input.value=draft.text;input.placeholder='SRT, VTT, JSON 또는 텍스트를 붙여넣으세요.';input.oninput=()=>{draft.text=input.value;};input.setAttribute('aria-describedby','supplement-help');
  const help=el('p','제공한 자막과 영상 제목을 Jev로 재분류합니다. 최대 40,000자, 처음 8개 구간을 평가합니다. 영상·음성은 분석하지 않습니다.','help');help.id='supplement-help';
  const status=el('p',draft.message,'help transcript-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const message=text=>{draft.message=text;status.textContent=text;};
  const actions=el('div',undefined,'transcript-actions'),file=el('input');file.type='file';file.accept='.srt,.vtt,.json,.txt';file.hidden=true;file.className='transcript-control';file.setAttribute('aria-label','자막 파일');
  file.onchange=async()=>{const chosen=file.files[0];if(!chosen || busy)return;try{if(chosen.size>LIMITS.bodyBytes)throw new Error('파일은 196,608바이트 이하여야 합니다. 필요한 구간만 넣어 주세요.');const text=await chosen.text();parseTranscript(text);if(busy)return;draft.text=text;input.value=text;message(`${chosen.name} 파일을 열었습니다. 자막으로 재분류를 누르면 전송합니다.`);}catch(e){message(e.message);}finally{file.value='';}};
  actions.append(button('파일 열기','button secondary small transcript-control',()=>file.click()),file);
  async function execute(extract=false){
    if(busy)return;
    let body;
    try{if(!extract){if(!config?.live_available)throw new Error('서버에 Jev 키를 설정해 주세요.');body={title:item.video.title,youtube_url:item.youtube_url,transcript:draft.text,consent:true};normalizeInput(body);}}
    catch(e){message(e.message);return;}
    controller=new AbortController();draft.running=true;setBusy(extract?'extract':'transcript');
    message(extract?'공개 자막을 가져오고 있습니다…':'자막 구간을 재분류하고 있습니다…');
    try{
      if(extract){const data=await api('/api/transcript',{youtube_url:item.youtube_url},controller.signal);parseTranscript(data.segments);draft.text=JSON.stringify(data.segments,null,2);message('자막을 가져왔습니다. 내용을 확인하고 자막으로 재분류를 눌러 주세요.');}
      else{const result=await api('/api/classify',body,controller.signal);if(item.result)(item.previous_results??=[]).push(item.result);item.result=result;item.classified_at=new Date().toISOString();delete item.error;selected.delete(itemKey(item));message('자막 기준으로 분류를 갱신했습니다. 이전 결과는 JSON에 함께 보존됩니다.');}
    }catch(e){message(e.name==='AbortError'?'요청을 취소했습니다. 기존 결과는 유지됩니다. 이미 전송된 호출은 과금될 수 있습니다.':`${e.message} 기존 결과는 유지됩니다.`);}
    finally{controller=null;draft.running=false;setBusy(null);render();if(detailItem===item)renderDetail(item);}
  }
  if(config?.local_extraction)actions.append(button('자막 가져오기','button secondary small transcript-control',()=>execute(true)));
  actions.append(button('자막으로 재분류','button primary small transcript-control',()=>execute()));
  const cancel=button('중단','button secondary small',()=>controller?.abort());cancel.dataset.supplementCancel='';cancel.hidden=!draft.running;actions.append(cancel);
  if(config?.local_extraction)content.append(el('p','공개 자막 가져오기는 영상과 접근 상태에 따라 실패할 수 있습니다. 파일이나 텍스트를 직접 제공할 수도 있습니다.','help'));
  content.append(label,input,help,actions,status);editor.append(content);for(const c of editor.querySelectorAll('.transcript-control'))c.disabled=!!busy;return editor;
}
function renderDetail(item){
  const out=$('detail-content');out.replaceChildren();
  if(item.fixture_id)out.append(el('p','합성 데모 · 모의 점수 · 실제 호출 없음','demo-label'));
  const title=el('h2',item.video.title);title.id='detail-title';out.append(title,el('p',item.video.channel_title||'채널 정보 없음','detail-byline'),badge(item));
  const links=el('div',undefined,'detail-links');
  if(item.youtube_url){const a=el('a','YouTube에서 열기','button secondary small');a.href=item.youtube_url;a.target='_blank';a.rel='noopener noreferrer';links.append(a);}
  if(selectable(item)){const run=button('이 영상 분류','button primary small',()=>{selected.clear();selected.add(itemKey(item));$('detail').close();classifySelected();});run.disabled=!!busy;links.append(run);}out.append(links);
  if(!item.fixture_id && item.youtube_url)out.append(transcriptEditor(item));
  if(item.error)out.append(el('p',item.error,'detail-message warning'));
  if(!item.result){out.append(el('p','이 영상의 IAB 범주는 아직 평가하지 않았습니다. 분류를 실행하면 결과와 근거를 확인할 수 있습니다.','detail-message'));}
  const r=item.result;
  if(r){
    const metadata=r.classification_mode==='metadata';
    const result=section('IAB 분류');
    result.append(el('p',metadata?'분류 근거 · 공개 메타데이터':'분류 근거 · 제공한 자막과 제목','evidence-mode'));
    if(r.fallback_required)result.append(el('p','메타데이터만으로 확정하기 어렵습니다. 자막 등 추가 근거를 검토해 주세요.','detail-message warning'));
    if(r.status==='partial')result.append(el('p','예산 제한으로 일부 가지를 평가하지 않았습니다. 표시된 분류는 부분 결과입니다.','detail-message warning'));
    const labels=acceptedLabels(r);
    if(!labels.length)result.append(el('p','수락 기준을 넘는 범주가 없거나 근거가 부족해 판단을 보류했습니다. 관련 없음이라는 뜻은 아닙니다.','detail-message warning'));
    for(const label of labels){
      const row=el('div',undefined,'label-result');row.append(el('h4',label.name),el('p',`${label.path.join(' › ')} · ID ${label.category_id}`,'label-path'));
      const scores=el('div',undefined,'score-pair');for(const [value,name] of [[label.model_probability,'모델 원시 점수'],[label.path_score,'경로 점수']]){const s=el('div');s.append(el('strong',value.toFixed(2)),el('span',name));scores.append(s);}row.append(scores);
      const bar=el('progress');bar.max=1;bar.value=label.path_score;bar.setAttribute('aria-label',`${label.name} 경로 점수 ${label.path_score.toFixed(2)}`);row.append(bar);
      if(label.specificity==='broad')row.append(el('p','상위 범주에서 수락 · 더 구체적인 분류는 미확정','help'));result.append(row);
    }
    result.append(el('p',`수락 기준 ${r.policy.accept.toFixed(2)}${metadata?' · 메타데이터 종료 기준 0.85':''}. 경로 점수는 경로상의 원시 점수 최솟값이며, 두 값 모두 검증된 정확도가 아닙니다.`,'help'));out.append(result);
    const purposeSection=section('영상 목적'),purposeLabels=acceptedPurposes(r);
    purposeSection.append(el('p',metadata?'공개 메타데이터에서 추정한 활용 목적입니다. IAB 범주와 별도 태그입니다.':'평가한 자막 구간에서 확인한 활용 목적입니다. 영상 전체의 목적을 확정하지 않습니다.','help'));
    if(purposeLabels.length){
      const names=el('p',purposeLabels.map(p=>p.name).join(' · '),'purpose-summary');purposeSection.append(names);
    }else purposeSection.append(el('p',purposeState(item)==='not_assessed'?'영상 목적을 평가하지 않은 입력이 있습니다. 미평가는 관련 없음이 아닙니다.':'목적 판단을 보류했습니다. 근거가 부족하거나 수락 기준을 넘는 목적이 없습니다.','detail-message warning'));
    for(const segment of r.segments){
      const assessment=segment.purpose_assessment;
      if(!assessment || assessment.status==='not_assessed'){purposeSection.append(el('p',`${segment.segment_id}: 목적 미평가`,'help'));continue;}
      const detail=el('details');detail.append(el('summary',metadata?'목적별 원시 점수':`${segment.segment_id} · 목적별 원시 점수`));
      const table=el('table',undefined,'trace-table'),thead=el('thead'),head=el('tr');for(const name of ['목적','원시 점수','판정'])head.append(el('th',name));thead.append(head);table.append(thead);
      const tbody=el('tbody');for(const p of assessment.evaluations){const row=el('tr');row.append(el('td',p.name),el('td',p.model_probability.toFixed(3)),el('td',assessment.labels.some(l=>l.purpose_id===p.purpose_id)?'수락':'보류'));tbody.append(row);}table.append(tbody);detail.append(table);purposeSection.append(detail);
    }
    if(r.coverage.omitted_segments.length)purposeSection.append(el('p','생략된 자막 구간의 목적은 미평가입니다.','help'));
    if(r.purpose_rubric)purposeSection.append(el('p',`수락 기준 ${r.purpose_rubric.accept.toFixed(2)} · ${r.purpose_rubric.version}. 원시 점수는 검증된 정확도가 아닙니다.`,'help'));
    out.append(purposeSection);
    const evaluated=r.segments.reduce((n,s)=>n+s.evaluations.length,0),trace=section('평가 범위와 판정 경로');
    trace.append(el('p',`${r.coverage.processed_text_segments}/${r.coverage.total_text_segments} ${metadata?'메타데이터 묶음':'자막 구간'} · ${evaluated}회 범주 판정 · taxonomy ${r.taxonomy.node_count}개 노드`),el('p','평가하지 않은 노드는 미평가입니다. 근거 필드는 모델에 제공한 입력이며, 독립적으로 검증된 설명이 아닙니다.','help'));
    for(const segment of r.segments){
      if(!metadata)trace.append(el('h4',`${segment.segment_id} · ${displayTime(segment.start_sec)}${segment.end_sec==null?'':` – ${displayTime(segment.end_sec)}`}`));
      if(segment.warnings.length){const ul=el('ul',undefined,'warning-list');for(const w of segment.warnings)ul.append(el('li',warningText(w,segment)));trace.append(ul);}
      if(segment.evaluations.length){const details=el('details');details.append(el('summary',`판정 ${segment.evaluations.length}개 펼치기`));const scroll=el('div',undefined,'trace-scroll'),table=el('table',undefined,'trace-table'),thead=el('thead'),head=el('tr');for(const name of ['IAB 경로','원시','경로'])head.append(el('th',name));thead.append(head);table.append(thead);const tbody=el('tbody');for(const e of segment.evaluations){const row=el('tr');row.append(el('td',e.path.join(' › ')),el('td',e.model_probability.toFixed(3)),el('td',e.path_score.toFixed(3)));tbody.append(row);}table.append(tbody);scroll.append(table);details.append(scroll);trace.append(details);}
    }
    if(r.coverage.omitted_segments.length)trace.append(el('p',`구간 예산으로 미평가: ${r.coverage.omitted_segments.map(s=>s.segment_id).join(', ')}`,'detail-message warning'));
    if(r.coverage.budget_skipped_segments.length)trace.append(el('p',`호출 예산으로 미평가: ${r.coverage.budget_skipped_segments.join(', ')}`,'detail-message warning'));
    out.append(trace);
    const provenance=section('실행 정보');const p=el('div',undefined,'provenance');for(const text of [`Taxonomy ${r.taxonomy.version} · ${r.taxonomy.scope}`,`Source checksum: ${r.taxonomy.source_blob??'해당 없음 · 합성 데모'}`,`Model: ${r.usage.model_versions.join(', ')}`,`Rubric: ${r.rubric_version}`,`Jev HTTP 시도 ${r.usage.http_attempts}회 · 성공 ${r.usage.successful_calls}회`])p.append(el('div',text));provenance.append(p);out.append(provenance);
  }
  const transcript=r?.classification_mode==='transcript',evidence=section(transcript?'분류에 사용한 자막 입력':r?'모델에 제공된 메타데이터':'공개 메타데이터');
  const fields=r?.segments.flatMap(s=>s.evidence)??Object.entries(item.video).filter(([k,v])=>['title','description','tags','youtube_category_id','channel_title'].includes(k)&&v?.length).map(([field,text])=>({field,text:Array.isArray(text)?text.join(', '):text}));
  if(transcript)evidence.append(el('p',`제목 힌트: ${r.video.title}`,'help'),el('p','입력 자막을 표시합니다. 예산으로 판정하지 못한 구간은 위의 평가 범위에 명시됩니다.','help'));
  const dl=el('dl');for(const e of fields){const group=el('div',undefined,'evidence-field');group.append(el('dt',transcript?`${e.id} · ${displayTime(e.start)}`:fieldNames[e.field]??e.field??e.id),el('dd',e.text));dl.append(group);}evidence.append(dl);out.append(evidence);
}
function showDetail(item){detailItem=item;renderDetail(item);$('detail').showModal();$('detail').scrollTop=0;}
$('detail-close').onclick=()=>$('detail').close();$('detail').addEventListener('close',()=>{detailItem=null;scheduleNextPage();});
$('search-form').onsubmit=e=>{e.preventDefault();search();};$('load-more').onclick=resumeBrowse;
$('select-all').onchange=e=>{for(const item of visibleItems().filter(selectable)){if(e.target.checked)selected.add(itemKey(item));else selected.delete(itemKey(item));}render();};
$('classify').onclick=classifySelected;$('cancel').onclick=stopBrowse;$('scroll-cancel').onclick=stopBrowse;
$('all-topics').onclick=()=>setTopic(null);$('reset-filters').onclick=resetFilters;$('sort').onchange=render;
$('topic-operator').onchange=e=>{if(e.target.name==='topic-operator'){topicOperator=e.target.value;render();}};
const topicsToggle=button('주제 펼치기','text-button mobile-topics-toggle',()=>toggleTopics(!document.querySelector('.facet-panel').classList.contains('topics-open')));topicsToggle.id='topics-toggle';topicsToggle.setAttribute('aria-expanded','false');topicsToggle.setAttribute('aria-controls','topic-tree');document.querySelector('.facet-heading').append(topicsToggle);
$('view-toggle').onclick=()=>{listView=!listView;render();};
$('video-list').addEventListener('click',e=>{const b=e.target.closest('[data-query]');if(b){$('query').value=b.dataset.query;$('query').focus();}});
$('demo').onclick=async()=>{
  if(busy)return;setBusy('demo');$('notice').hidden=true;
  try{const data=await api('/api/explore/demo');collection={...data,items:undefined};items=data.items.map((x,i)=>({...x,collection_rank:i+1}));selected.clear();clearFilters();closedBranches.clear();$('batch-status').hidden=true;}
  catch(e){notify(`데모를 불러오지 못했습니다. ${e.message}`);}finally{setBusy(null);render();}
};
$('leave-demo').onclick=()=>{collection=null;items=[];selected.clear();clearFilters();$('notice').hidden=true;render();$('query').focus();};
$('export').onclick=()=>{
  const data={schema_version:'explore-1.1',...collection,filters:{...discoveryFilters(),state:stateFilter},items:items.map(({state,...item})=>({...item,assessment_status:resultState(item)})),notes:['Counts refer only to collected candidates, not all of YouTube.','Unassessed categories and videos are unknown, not negative.','Raw model values and path scores are not calibrated accuracy.','Viewing purposes are separate project-defined tags, not IAB categories. Transcript purposes refer only to assessed segments.']};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=el('a');a.href=url;a.download=collection.mode==='fixture_demo'?'jev-iab-synthetic-demo.json':'jev-iab-search-results.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
const scrollObserver=new IntersectionObserver(scheduleNextPage,{rootMargin:'240px 0px'});scrollObserver.observe($('scroll-sentinel'));
window.addEventListener('scroll',scheduleNextPage,{passive:true});
render();
try{config=await api('/api/config');const ready=config.metadata_available&&config.live_available;$('runtime').textContent=ready?`${config.runtime==='localhost'?'로컬':'서버'} · 검색과 분류 준비됨`:'서버 API 키 설정 필요';$('runtime').classList.toggle('ready',ready);}
catch(e){$('runtime').textContent='서버 연결 실패';notify(e.message);}
