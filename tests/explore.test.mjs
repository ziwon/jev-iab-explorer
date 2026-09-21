import test from 'node:test';
import assert from 'node:assert/strict';
import {exploreDemo} from '../src/explore-demo.mjs';
import {handle} from '../src/worker.mjs';
import {acceptedLabels,buildFacets,displayTime,duration,matchesCategory,resultState,safeThumbnail,warningText} from '../public/explore-data.mjs';

test('keyless browser demo is synthetic, has no YouTube IDs or network usage, and retains provenance',async()=>{
  const response=await handle(new Request('https://lab.example/api/explore/demo'));
  assert.equal(response.status,200);const demo=await response.json();assert.equal(demo.mode,'fixture_demo');
  assert.equal(demo.items.length,7);
  for(const item of demo.items){assert.ok(item.fixture_id.startsWith('fixture-'));assert.equal(item.youtube_url,null);assert.equal(item.video.video_id,null);assert.equal(item.result.mode,'fixture_demo');assert.equal(item.result.usage.http_attempts,0);assert.equal(item.result.taxonomy.scope,'demo_subset');assert.ok(item.result.rubric_version);}
});
test('hierarchical facets count distinct videos, not the number of overlapping labels or segments',async()=>{
  const {items}=await exploreDemo();
  const facets=buildFacets(items),business=facets.find(n=>n.id==='52');
  assert.equal(business.videos.size,2);assert.equal(business.children[0].videos.size,2);
  const cloud=items[0];cloud.result.segments.push(structuredClone(cloud.result.segments[0]));
  assert.equal(buildFacets(items).find(n=>n.id==='52').videos.size,2);
  assert.equal(acceptedLabels(cloud.result).length,2);
  assert.equal(matchesCategory(cloud,'52'),true);assert.equal(matchesCategory(cloud,'357'),false);
  assert.equal(matchesCategory({video:{video_id:'fixture'},result:null},'52'),false);
});
test('unassessed, abstained, partial, failed and fallback results remain distinct',async()=>{
  const {items}=await exploreDemo();
  assert.equal(resultState({}), 'unassessed');assert.equal(resultState({error:'failed'}),'error');
  assert.equal(resultState({state:'running'}),'running');assert.equal(resultState(items[0]),'classified');
  assert.equal(resultState(items.find(x=>x.fixture_id==='fixture-broad')),'review');
  assert.equal(resultState(items.at(-1)),'abstained');assert.equal(resultState({result:{status:'partial'}}),'partial');
  assert.equal(buildFacets([items.at(-1)]).length,0);
});
test('facet ancestry uses official IDs and never invents missing parent IDs',async()=>{
  const {items}=await exploreDemo();const item=items[0];
  for(const s of item.result.segments)for(const label of s.labels)delete label.ancestor_ids;
  assert.equal(buildFacets([item]).length,0);
});
test('missing metadata times and invalid durations never render NaN or fabricated timestamps',()=>{
  for(const value of [null,undefined,NaN,Infinity,'1',-1])assert.equal(displayTime(value),'시간 정보 없음');
  assert.equal(displayTime(65),'01:05');assert.equal(duration('PT1H2M3S'),'1:02:03');assert.equal(duration('PT4M27S'),'4:27');assert.equal(duration(''),'');assert.equal(duration('PT'),'');
});
test('only an allowlisted HTTPS thumbnail destination is rendered',()=>{
  assert.equal(safeThumbnail('https://i.ytimg.com/vi/test/hqdefault.jpg'),'https://i.ytimg.com/vi/test/hqdefault.jpg');
  for(const value of ['https://evil.example/image','https://i.ytimg.com.evil.example/image','http://i.ytimg.com/a','https://user:password@i.ytimg.com/a','https://i.ytimg.com:8000/a','javascript:alert(1)'])assert.equal(safeThumbnail(value),null);
});
test('hierarchy disagreement explains the actual category and both scores',async()=>{
  const {items}=await exploreDemo(),segment=items.find(x=>x.fixture_id==='fixture-broad').result.segments[0];
  assert.match(warningText(segment.warnings[0],segment),/Music.*0\.88.*0\.79/);
});
