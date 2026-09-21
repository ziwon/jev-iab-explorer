/** Pure presentation data: accepted labels alone create facets, never unvisited nodes. */
export const itemKey=item=>item.fixture_id??item.video.video_id;
export function acceptedLabels(result) {
  const labels=new Map();
  for(const segment of result?.segments??[]) for(const label of segment.labels??[]) {
    if(!labels.has(label.category_id) || labels.get(label.category_id).path_score<label.path_score) labels.set(label.category_id,label);
  }
  return [...labels.values()].sort((a,b)=>b.path_score-a.path_score);
}
export function resultState(item) {
  if(item.state==='running') return 'running';
  if(item.error) return 'error';
  if(!item.result) return 'unassessed';
  if(item.result.status==='partial') return 'partial';
  if(!acceptedLabels(item.result).length) return 'abstained';
  return item.result.fallback_required?'review':'classified';
}
export function matchesCategory(item,id) {
  return !id || acceptedLabels(item.result).some(l=>l.category_id===id || l.ancestor_ids?.includes(id));
}
export function buildFacets(items) {
  const nodes=new Map();
  for(const item of items) for(const label of acceptedLabels(item.result)) {
    const ids=[...(label.ancestor_ids??[]),label.category_id];
    // Missing ancestry stays unavailable rather than inventing an ID from a name.
    if(ids.length!==label.path.length) continue;
    ids.forEach((id,index)=>{
      if(!nodes.has(id)) nodes.set(id,{id,name:label.path[index],parent:ids[index-1]??null,path:label.path.slice(0,index+1),videos:new Set(),children:[]});
      nodes.get(id).videos.add(itemKey(item));
    });
  }
  for(const node of nodes.values()) if(node.parent) nodes.get(node.parent)?.children.push(node);
  const sort=rows=>{rows.sort((a,b)=>b.videos.size-a.videos.size || a.name.localeCompare(b.name));for(const n of rows) sort(n.children);return rows;};
  return sort([...nodes.values()].filter(n=>!n.parent));
}
export function safeThumbnail(value) {
  try {const url=new URL(value);return url.protocol==='https:' && url.hostname==='i.ytimg.com' && !url.port && !url.username && !url.password?url.href:null;}catch{return null;}
}
export function displayTime(seconds) {
  return typeof seconds==='number' && Number.isFinite(seconds) && seconds>=0?`${Math.floor(seconds/60).toString().padStart(2,'0')}:${Math.floor(seconds%60).toString().padStart(2,'0')}`:'시간 정보 없음';
}
export function duration(value) {
  const m=/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value??'');
  if(!m || !m.slice(1).some(Boolean)) return '';
  const h=Number(m[1]??0),min=Number(m[2]??0),s=Math.floor(Number(m[3]??0));
  return h?`${h}:${String(min).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${min}:${String(s).padStart(2,'0')}`;
}
export function warningText(warning,segment) {
  if(warning.startsWith('hierarchy_probability_mismatch:')) {
    const id=warning.split(':')[1],row=segment.evaluations.find(e=>e.category_id===id);
    return row?`${row.name}: 원시 점수 ${row.model_probability.toFixed(2)}가 상위 범주보다 높습니다. 경로 점수 ${row.path_score.toFixed(2)}로 수락 여부를 판단했습니다.`:'일부 하위 범주의 원시 점수가 상위 범주보다 높습니다.';
  }
  if(warning.includes('branch_budget')) return '탐색 예산으로 일부 하위 가지를 평가하지 않았습니다.';
  if(warning.includes('depth_budget')) return '깊이 제한으로 더 아래의 범주는 평가하지 않았습니다.';
  if(warning==='call_or_time_budget_exhausted') return '호출 또는 시간 예산에 도달했습니다. 남은 범주는 미평가입니다.';
  return warning;
}
