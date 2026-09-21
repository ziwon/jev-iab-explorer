/** Pure presentation data: accepted labels alone create facets, never unvisited nodes. */
import {purposeCatalog} from './purposes.mjs';
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
export function matchesTopics(item,ids=[],operator='AND') {
  const topics=[...new Set(ids)];
  if(!topics.length)return true;
  return operator==='OR'?topics.some(id=>matchesCategory(item,id)):topics.every(id=>matchesCategory(item,id));
}
export function acceptedPurposes(result) {
  const labels=new Map(),known=new Set(purposeCatalog(result).map(p=>p.id));
  for(const segment of result?.segments??[]) {
    if(segment.purpose_assessment?.status!=='classified')continue;
    for(const label of segment.purpose_assessment.labels??[]) {
      if(!known.has(label.purpose_id))continue;
      if(!labels.has(label.purpose_id) || labels.get(label.purpose_id).model_probability<label.model_probability)labels.set(label.purpose_id,label);
    }
  }
  return [...labels.values()].sort((a,b)=>b.model_probability-a.model_probability);
}
export function purposeState(item) {
  if(acceptedPurposes(item.result).length)return 'classified';
  const segments=item.result?.segments??[];
  if(!segments.length || segments.some(s=>!s.purpose_assessment || s.purpose_assessment.status==='not_assessed'||s.purpose_assessment.pending_purpose_ids?.length) || item.result.coverage?.omitted_segments?.length)return 'not_assessed';
  return 'abstained';
}
export function matchesPurposes(item,ids=[]) {
  if(!ids.length)return true;
  const accepted=new Set(acceptedPurposes(item.result).map(p=>p.purpose_id));
  return ids.some(id=>id==='not_assessed'||id==='abstained'?purposeState(item)===id:accepted.has(id));
}
export function matchesDiscovery(item,{topics=[],operator='AND',purposes=[]}={}) {
  return matchesTopics(item,topics,operator) && matchesPurposes(item,purposes);
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
