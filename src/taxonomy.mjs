import {AppError} from '../public/shared.mjs';
export const TAXONOMY_SOURCE = 'https://raw.githubusercontent.com/InteractiveAdvertisingBureau/Taxonomies/de75783684ec6c6f91ee0591bcba16827482d412/Content%20Taxonomies/Content%20Taxonomy%203.1.tsv';
export const TAXONOMY_BLOB = 'a3a76ad293ade6485187a2903ee916c16bf1cf01';
export function buildTaxonomy(rows, version='3.1') {
  const nodes=new Map();
  for(const row of rows) {
    if(!row.id || !row.name || nodes.has(row.id)) throw new AppError('taxonomy_invalid','중복되거나 비어 있는 taxonomy ID.',503);
    nodes.set(row.id,{...row,children:[]});
  }
  for(const n of nodes.values()) {
    if(n.parent) {
      if(!nodes.has(n.parent)) throw new AppError('taxonomy_invalid',`누락된 parent: ${n.parent}`,503);
      nodes.get(n.parent).children.push(n);
    }
  }
  for(const n of nodes.values()) {
    const seen=new Set(); const chain=[]; let p=n;
    while(p) {
      if(seen.has(p.id)) throw new AppError('taxonomy_invalid','taxonomy cycle 발견.',503);
      seen.add(p.id); chain.unshift(p); p=nodes.get(p.parent);
    }
    n.path=chain.map(x=>x.name); n.ancestors=chain.slice(0,-1).map(x=>x.id); n.depth=chain.length;
  }
  return {version,nodes,roots:[...nodes.values()].filter(n=>!n.parent)};
}
export function parseTaxonomy(tsv) {
  const lines=tsv.replace(/^\uFEFF/,'').split(/\r?\n/);
  const header=lines.findIndex(l=>l.startsWith('Unique ID\tParent\tName\t'));
  if(header<0) throw new AppError('taxonomy_invalid','IAB TSV header가 맞지 않아.',503);
  const rows=lines.slice(header+1).filter(l=>l.trim()).map(l=>{
    const [id,parent,name,,,,,extension]=l.split('\t').map(x=>x.trim());
    return {id,parent:parent||null,name,extension:extension||null};
  });
  return buildTaxonomy(rows);
}
export async function verifySource(bytes) {
  const prefix=new TextEncoder().encode(`blob ${bytes.length}\0`);
  const full=new Uint8Array(prefix.length+bytes.length); full.set(prefix); full.set(bytes,prefix.length);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1',full)),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==TAXONOMY_BLOB) throw new AppError('taxonomy_changed','공식 taxonomy 원본이 바뀌었어. checksum을 검토한 뒤 업데이트해.',503);
}
let cached;
export async function loadTaxonomy(fetcher=fetch) {
  if(!cached) cached=(async()=>{
    const response=await fetcher(TAXONOMY_SOURCE,{redirect:'error',signal:AbortSignal.timeout(8000)});
    if(!response.ok) throw new AppError('taxonomy_unavailable','공식 IAB taxonomy를 가져올 수 없어.',503);
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length>200000) throw new AppError('taxonomy_invalid','taxonomy가 예상 크기를 초과했어.',503);
    await verifySource(bytes); return parseTaxonomy(new TextDecoder().decode(bytes));
  })().catch(e=>{cached=undefined;throw e instanceof AppError?e:new AppError('taxonomy_unavailable','IAB taxonomy 다운로드에 실패했어.',503);});
  return cached;
}
