import test from 'node:test';
import assert from 'node:assert/strict';
import {classify,classificationCheckpoint,POLICY} from '../src/classifier.mjs';
import {discoverPurposes,discoveryInput} from '../src/gemini.mjs';
import {seal,unseal} from '../src/checkpoint.mjs';
import {buildTaxonomy} from '../src/taxonomy.mjs';
import {normalizeMetadataInput,AppError} from '../public/shared.mjs';
import {PURPOSES} from '../public/purposes.mjs';
import {acceptedPurposes,matchesPurposes} from '../public/explore-data.mjs';
import {handle} from '../src/worker.mjs';

const video={video_id:'abcDE_12-34',title:'AI 자동화의 한계와 과장 광고 비평',description:'자동화 도입의 실패 요인과 과장된 수익 주장의 한계를 비평합니다.'};
const input=()=>normalizeMetadataInput(video);
const taxonomy=buildTaxonomy(Array.from({length:6},(_,i)=>[{id:`root${i}`,name:`Topic ${i}`},{id:`child${i}`,parent:`root${i}`,name:`Detail ${i}`}]).flat());
function provider({budget=100,sufficient=.95,purposeSufficient=.9,values={}}={}){
  const calls=[],metrics={attempts:0,successful_calls:0,input_tokens:0,output_tokens:0,models:new Set(['offline-evaluator'])};
  return {calls,metrics,async evaluate(state,questions){
    if(calls.length>=budget)throw new AppError('budget_exhausted','Fixture budget',429);
    calls.push({state,questions});metrics.attempts++;metrics.successful_calls++;
    return Object.fromEntries(Object.keys(questions).map(k=>[k,k==='sufficient'?sufficient:k==='purpose_sufficient'?purposeSufficient:k.startsWith('purpose_')?values[k]??.1:.91]));
  }};
}
const proposal=()=>({name:'위험·한계 비평',description:'주장의 한계와 위험을 논평한다.',include:'근거를 들어 한계나 위험을 비평하는 내용',exclude:'방법을 따라하는 실습이나 단순 제품 비교',existing_id:'',evidence_ids:[`${video.video_id}:title`]});
const geminiResponse=value=>new Response(JSON.stringify({modelVersion:'gemini-offline-fixture',candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:10}}));
const payload=(proposals=[proposal()])=>({proposals,insufficient_video_ids:[]});
async function catalog(){return discoverPurposes(discoveryInput({query:'AI 자동화 수익',videos:[video]}),{key:'fixture',fetcher:async()=>geminiResponse(payload())});}

test('signed state rejects tampering, wrong kind/key and expiry',async()=>{
  const token=await seal('classification',{text:'한글',scores:[.91]},'fixture-secret',{now:1000});
  assert.equal((await unseal(token,'classification','fixture-secret',{now:1001})).text,'한글');
  for(const [value,kind,key] of [[token+'a','classification','fixture-secret'],[token,'purpose-catalog','fixture-secret'],[token,'classification','wrong']])await assert.rejects(unseal(value,kind,key,{now:1001}),{code:'invalid_checkpoint'});
  await assert.rejects(unseal(token,'classification','fixture-secret',{now:99999999}),{code:'checkpoint_expired'});
});
test('continuation evaluates only skipped IAB nodes and clears branch partial status',async()=>{
  const first=await classify(input(),taxonomy,provider());
  assert.equal(first.status,'partial');assert.equal(first.continuation.pending_category_count,2);assert.equal(first.fallback_required,false);
  const p=provider(),next=await classify(input(),taxonomy,p,{previous:classificationCheckpoint(input(),first),action:'continue'});
  assert.equal(next.status,'completed');assert.equal(next.continuation.pending_category_count,0);
  assert.equal(p.calls.length,1);assert.equal(Object.keys(p.calls[0].questions).length,2);
  const old=new Map(first.segments[0].evaluations.map(e=>[e.category_id,e]));
  for(const e of next.segments[0].evaluations)if(old.has(e.category_id))assert.deepEqual(e,old.get(e.category_id));
  assert.equal(next.evaluation_runs.length,2);
  assert.equal(next.segments[0].evaluations.find(e=>e.category_id==='child5').evaluation_run,1);
});
test('call-budget continuation preserves completed rows and resumes a partially evaluated level',async()=>{
  const first=await classify(input(),taxonomy,provider({budget:2}),{policy:{...POLICY,batchSize:3}});
  assert.equal(first.status,'partial');
  const p=provider({budget:1}),next=await classify(input(),taxonomy,p,{previous:classificationCheckpoint(input(),first),action:'continue',policy:{...POLICY,batchSize:3}});
  assert.equal(next.status,'partial');assert.equal(next.segments[0].evaluations.length,6);
  assert.ok(next.segments[0].evaluations.slice(0,3).every(e=>e.evaluation_run===0));
  assert.equal(Object.keys(p.calls[0].questions).length,3);
});
test('purpose sufficiency is independent of topic sufficiency',async()=>{
  const r=await classify(input(),taxonomy,provider({sufficient:.1,values:{purpose_tutorial:.95}}));
  assert.equal(r.status,'insufficient_evidence');assert.equal(acceptedPurposes(r)[0].purpose_id,'tutorial');
  const no=await classify(input(),taxonomy,provider({purposeSufficient:.2,values:{purpose_tutorial:.99}}));
  assert.equal(acceptedPurposes(no).length,0);assert.equal(no.segments[0].purpose_assessment.reason,'insufficient_purpose_evidence');
});
test('new Gemini purpose is a candidate until independently evaluated by Jev',async()=>{
  const c=await catalog(),extra=c.purposes.at(-1),first=await classify(input(),taxonomy,provider());
  assert.equal(acceptedPurposes(first).length,0);
  const p=provider({values:{[`purpose_${extra.id}`]:.89}});
  const result=await classify(input(),taxonomy,p,{catalog:c,previous:classificationCheckpoint(input(),first),action:'purposes'});
  assert.deepEqual(Object.keys(p.calls[0].questions),[`purpose_${extra.id}`]);assert.equal(p.calls.length,1);
  assert.deepEqual(result.segments[0].evaluations,first.segments[0].evaluations);
  assert.equal(result.status,'partial');assert.equal(result.continuation.pending_category_count,2);
  assert.equal(acceptedPurposes(result)[0].purpose_id,extra.id);assert.equal(matchesPurposes({result},[extra.id]),true);
  const repeat=provider();await classify(input(),taxonomy,repeat,{catalog:c,previous:classificationCheckpoint(input(),result),action:'purposes'});assert.equal(repeat.calls.length,0);
});
test('Gemini uses a fixed destination, server header, strict JSON schema and exact metadata quotes',async()=>{
  let request;const c=await discoverPurposes(discoveryInput({query:'test',videos:[video]}),{key:'secret',fetcher:async(url,options)=>{request={url,options};return geminiResponse(payload());}});
  assert.equal(request.url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');assert.equal(request.options.redirect,'error');assert.equal(request.options.headers['x-goog-api-key'],'secret');assert.ok(!request.options.body.includes('secret'));
  const body=JSON.parse(request.options.body);assert.equal(body.generationConfig.responseMimeType,'application/json');assert.equal(body.generationConfig.thinkingConfig.thinkingBudget,512);assert.equal(body.tools,undefined);
  assert.equal(c.purposes.length,6);assert.equal(c.discovery.model_version,'gemini-offline-fixture');assert.equal(c.purposes[5].evidence[0].quote,video.title);
});
test('existing purpose synonyms merge without changing definitions; no candidates is valid',async()=>{
  const p={...proposal(),existing_id:'tutorial'};
  const c=await discoverPurposes(discoveryInput({query:'test',videos:[video]}),{key:'fixture',fetcher:async()=>geminiResponse(payload([p]))});
  assert.deepEqual(c.purposes,PURPOSES);assert.equal(c.discovery.merged[0].existing_id,'tutorial');
  const empty=await discoverPurposes(discoveryInput({query:'test',videos:[video]}),{key:'fixture',fetcher:async()=>geminiResponse({proposals:[],insufficient_video_ids:[video.video_id]})});
  assert.equal(empty.purposes.length,5);assert.equal(empty.discovery.insufficient_video_ids.length,1);
});
test('invalid Gemini evidence references, malformed values and incomplete output fail explicitly',async()=>{
  const cases=[payload([{...proposal(),existing_id:'invented'}]),payload([{...proposal(),evidence_ids:['invented:evidence']}]),payload([{...proposal(),name:''}]),{proposals:[],insufficient_video_ids:['invented']}];
  for(const data of cases)await assert.rejects(discoverPurposes(discoveryInput({query:'test',videos:[video]}),{key:'fixture',fetcher:async()=>geminiResponse(data)}),{code:'invalid_gemini_response'});
  await assert.rejects(discoverPurposes(discoveryInput({query:'test',videos:[video]}),{key:'fixture',fetcher:async()=>new Response(JSON.stringify({candidates:[{finishReason:'MAX_TOKENS'}]}))}),{code:'invalid_gemini_response'});
});
test('Gemini failures never become synthetic results and requests have bounded inputs',async()=>{
  await assert.rejects(discoverPurposes(discoveryInput({query:'test',videos:[video]}),{key:'fixture',fetcher:async()=>new Response('provider secret',{status:429})}),{code:'gemini_error'});
  assert.throws(()=>discoveryInput({query:'test',videos:[video,video]}),{code:'invalid_input'});
  assert.throws(()=>discoveryInput({query:'test',videos:Array(21).fill(video)}),{code:'invalid_input'});
  await assert.rejects(discoverPurposes({},{key:'fixture',model:'../bad'}),{code:'invalid_configuration'});
});
const env={TYPESAFE_API_KEY:'fixture-jev-key',GEMINI_API_KEY:'fixture-gemini-key'};
const req=(path,body,origin='https://app.example')=>new Request('https://app.example'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
test('API connects signed discovery and refinement without accepting caller scores',async()=>{
  const first=await (await handle(req('/api/youtube/classify',{youtube_url:video.video_id,consent:true}),env,{taxonomy,provider:provider(),youtubeMetadata:async()=>input()})).json();
  const discovery=await (await handle(req('/api/purposes/discover',{query:'test',videos:[video]}),env,{geminiFetcher:async()=>geminiResponse(payload())})).json();
  assert.ok(discovery.catalog_token);assert.ok(first.continuation.checkpoint);
  const id=discovery.catalog.purposes.at(-1).id;
  const res=await handle(req('/api/classification/refine',{checkpoint:first.continuation.checkpoint,catalog_token:discovery.catalog_token,action:'purposes',max_calls:4}),env,{taxonomy,provider:provider({values:{[`purpose_${id}`]:.92}})});
  assert.equal(res.status,200);assert.equal(acceptedPurposes(await res.json())[0].purpose_id,id);
  const tampered=await handle(req('/api/classification/refine',{checkpoint:first.continuation.checkpoint+'x',action:'continue'}),env);assert.equal(tampered.status,400);
  const invalidBudget=await handle(req('/api/classification/refine',{checkpoint:first.continuation.checkpoint,action:'continue',max_calls:1000}),env);assert.equal(invalidBudget.status,400);
});
test('new endpoints reject cross-origin calls before work; configuration exposes no secrets',async()=>{
  for(const path of ['/api/purposes/discover','/api/classification/refine'])assert.equal((await handle(req(path,{},'https://evil.example'),env)).status,403);
  const config=await handle(new Request('https://app.example/api/config'),env),text=await config.text();assert.equal(JSON.parse(text).purpose_discovery_available,true);assert.ok(!text.includes(env.GEMINI_API_KEY));assert.ok(!text.includes(env.TYPESAFE_API_KEY));
});
