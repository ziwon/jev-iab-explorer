import test from 'node:test';
import assert from 'node:assert/strict';
import {classify,POLICY} from '../src/classifier.mjs';
import {demoInput,demoTaxonomy,demoProvider} from '../src/demo.mjs';
import {exploreDemo} from '../src/explore-demo.mjs';
import {normalizeMetadataInput,AppError} from '../public/shared.mjs';
import {PURPOSES,PURPOSE_RUBRIC_VERSION} from '../public/purposes.mjs';
import {acceptedPurposes,matchesTopics,matchesPurposes,matchesDiscovery,purposeState} from '../public/explore-data.mjs';

const input=()=>normalizeMetadataInput({video_id:'abcDE_12-34',title:'Cloud deployment tutorial',description:'A step-by-step beginner deployment walkthrough.'});
function provider({sufficient=.95,values={},budgetAfter=Infinity}={}) {
  const calls=[];
  return {calls,metrics:{attempts:0,successful_calls:0,input_tokens:0,output_tokens:0,models:new Set(['test-fixture'])},async evaluate(state,questions){
    if(calls.length>=budgetAfter)throw new AppError('budget_exhausted','Test budget',429);
    calls.push({state,questions});
    return Object.fromEntries(Object.keys(questions).map(id=>[id,id==='sufficient'?sufficient:id.startsWith('purpose_')?(id in values?values[id]:.1):.9]));
  }};
}

test('AND/OR topics match accepted descendants and deduplicate selected IDs',async()=>{
  const {items}=await exploreDemo(),cloud=items[0],startup=items[1];
  assert.equal(matchesTopics(cloud,['52','132'],'AND'),true);
  assert.equal(matchesTopics(startup,['52','132'],'AND'),false);
  assert.equal(matchesTopics(startup,['52','132'],'OR'),true);
  assert.equal(matchesTopics(cloud,['52','52','72'],'AND'),true);
  assert.equal(matchesTopics(cloud,[],'OR'),true);
  assert.equal(matchesTopics({},['52'],'OR'),false);
  assert.equal(matchesTopics(cloud,['unvisited-id'],'AND'),false);
});
test('topic group intersects purpose group; purpose choices use OR',async()=>{
  const {items}=await exploreDemo(),cloud=items[0],startup=items[1];
  const filters={topics:['52','132'],operator:'AND',purposes:['tutorial','case_study']};
  assert.equal(matchesDiscovery(cloud,filters),true);
  assert.equal(matchesDiscovery(startup,filters),false);
  assert.equal(matchesDiscovery(startup,{...filters,operator:'OR'}),true);
  assert.equal(matchesDiscovery(cloud,{...filters,purposes:['news']}),false);
  assert.equal(matchesDiscovery({},{}),true);
});
test('five purpose questions share the sufficiency request and retain raw scores',async()=>{
  const p=provider({values:{purpose_tutorial:.93,purpose_introduction:.81}});
  const r=await classify(input(),demoTaxonomy,p);
  assert.equal(Object.keys(p.calls[0].questions).length,6);
  assert.equal(p.calls.length,4); // Sufficiency/purposes plus three taxonomy levels.
  assert.equal(p.calls.slice(1).some(c=>Object.keys(c.questions).some(k=>k.startsWith('purpose_'))),false);
  assert.deepEqual(acceptedPurposes(r).map(x=>x.purpose_id),['tutorial','introduction']);
  assert.equal(r.segments[0].purpose_assessment.evaluations.length,5);
  assert.equal(r.segments[0].purpose_assessment.labels.find(x=>x.purpose_id==='tutorial').model_probability,.93);
  assert.deepEqual(r.segments[0].purpose_assessment.labels[0].evidence_ids,['meta_title','meta_description']);
  assert.equal(r.purpose_rubric.version,PURPOSE_RUBRIC_VERSION);
  assert.equal(r.purpose_rubric.scope,'project_defined_not_iab');
  assert.equal(r.purpose_rubric.evidence_scope,'public_metadata');
});
test('insufficient metadata suppresses purpose labels but preserves assessed values',async()=>{
  const p=provider({sufficient:.2,values:{purpose_tutorial:.99}}),r=await classify(input(),demoTaxonomy,p);
  assert.equal(p.calls.length,1);assert.equal(acceptedPurposes(r).length,0);
  assert.equal(purposeState({result:r}),'abstained');
  assert.equal(r.segments[0].purpose_assessment.evaluations.find(x=>x.purpose_id==='tutorial').model_probability,.99);
});
test('invalid purpose scores are errors rather than fabricated or silently absent values',async()=>{
  for(const value of [undefined,null,NaN,Infinity,-.1,1.1,'0.9']) {
    await assert.rejects(classify(input(),demoTaxonomy,provider({values:{purpose_news:value}})),{code:'invalid_provider_response'});
  }
});
test('legacy and budget-skipped purposes remain unassessed, distinct from abstention',async()=>{
  const r=await classify(input(),demoTaxonomy,provider({budgetAfter:0}));
  assert.equal(purposeState({result:r}),'not_assessed');
  assert.equal(r.segments[0].purpose_assessment.reason,'budget_exhausted');
  assert.equal(matchesPurposes({result:r},['not_assessed']),true);
  assert.equal(matchesPurposes({result:r},['tutorial']),false);
  assert.equal(purposeState({result:{segments:[{labels:[]}]}}),'not_assessed');
  const abstained=await classify(input(),demoTaxonomy,provider());
  assert.equal(purposeState({result:abstained}),'abstained');
  assert.equal(matchesPurposes({result:abstained},['not_assessed']),false);
});
test('completed purpose evaluation survives a later taxonomy budget limit',async()=>{
  const r=await classify(input(),demoTaxonomy,provider({budgetAfter:1,values:{purpose_news:.88}}));
  assert.equal(r.status,'partial');assert.equal(acceptedPurposes(r)[0].purpose_id,'news');
  assert.equal(r.segments[0].purpose_assessment.status,'classified');
});
test('transcript purpose evidence is scoped to assessed segments; short/omitted segments stay unknown',async()=>{
  const r=await classify(demoInput(),demoTaxonomy,demoProvider(),{demo:true});
  assert.equal(r.purpose_rubric.evidence_scope,'assessed_transcript_segments');
  assert.equal(r.segments.at(-1).purpose_assessment.status,'not_assessed');
  assert.equal(r.segments.at(-1).purpose_assessment.reason,'short_segment_heuristic');
  assert.deepEqual(new Set(acceptedPurposes(r).map(x=>x.purpose_id)),new Set(['tutorial','introduction','case_study']));
  const limited=await classify(demoInput(),demoTaxonomy,provider(),{policy:{...POLICY,maxSegments:1}});
  assert.ok(limited.coverage.omitted_segments.length);
  assert.equal(purposeState({result:limited}),'not_assessed');
});
test('purpose aggregation does not duplicate tags or promote raw unaccepted scores',async()=>{
  const {items}=await exploreDemo(),r=items[0].result;
  r.segments.push(structuredClone(r.segments[0]));
  assert.equal(acceptedPurposes(r).length,2);
  r.segments[1].purpose_assessment.labels[0].model_probability=.99;
  assert.equal(acceptedPurposes(r).some(p=>p.model_probability===.99),true);
  for(const segment of r.segments)segment.purpose_assessment.status='abstained';
  assert.equal(acceptedPurposes(r).length,0);
});
test('every purpose is sent as a separate Noul assessment rather than inferred from an IAB label',async()=>{
  const p=provider();await classify(input(),demoTaxonomy,p);
  for(const purpose of PURPOSES){const question=p.calls[0].questions[`purpose_${purpose.id}`];assert.equal(question.type,'noul');assert.equal(question.instructions.purpose_id,purpose.id);assert.match(question.instructions.question,/not IAB/);assert.match(question.instructions.question,/untrusted/);}
});
