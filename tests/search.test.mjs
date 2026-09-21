import test from 'node:test';
import assert from 'node:assert/strict';
import {searchYouTube,YOUTUBE_SEARCH_ENDPOINT,YOUTUBE_VIDEOS_ENDPOINT} from '../src/youtube.mjs';
import {handle} from '../src/worker.mjs';

const ids=['abcDE_12-34','abcDE_12-35'];
const video=id=>({id,snippet:{title:`Synthetic ${id}`,description:'Synthetic metadata for offline tests.',channelTitle:'Fixture channel',tags:['fixture'],categoryId:'28'},contentDetails:{duration:'PT4M20S'}});
test('search preserves provider order, deduplicates IDs and enriches through one fixed videos request',async()=>{
  const calls=[];
  const result=await searchYouTube({query:'  cloud course  ',limit:12,page_token:'CAoQAA=='},{key:'private-key',fetcher:async(url,options)=>{
    calls.push(url.origin+url.pathname);
    assert.equal(options.redirect,'error');
    assert.equal(url.searchParams.get('key'),'private-key');
    if(calls.length===1){
      assert.equal(url.searchParams.get('q'),'cloud course');assert.equal(url.searchParams.get('type'),'video');assert.equal(url.searchParams.get('pageToken'),'CAoQAA==');
      return Response.json({items:[{id:{videoId:ids[0]}},{id:{videoId:ids[1]}},{id:{videoId:ids[0]}},{id:{channelId:'ignored'}}],nextPageToken:'NEXT'});
    }
    assert.equal(url.searchParams.get('id'),ids.join(','));
    return Response.json({items:[video(ids[1]),video(ids[0])]});
  }});
  assert.deepEqual(calls,[YOUTUBE_SEARCH_ENDPOINT,YOUTUBE_VIDEOS_ENDPOINT]);
  assert.deepEqual(result.items.map(x=>x.video.video_id),ids);
  assert.deepEqual(result.items.map(x=>x.search_rank),[1,2]);
  assert.deepEqual(result.items[0].video.tags,['fixture']);
  assert.equal(result.next_page_token,'NEXT');assert.equal(result.classification_performed,false);
  assert.ok(!JSON.stringify(result).includes('private-key'));
});
test('empty search does not request metadata or invent results',async()=>{
  let calls=0;
  const r=await searchYouTube({query:'nothing'},{key:'x',fetcher:async()=>{calls++;return Response.json({items:[]});}});
  assert.equal(calls,1);assert.deepEqual(r.items,[]);
});
test('inaccessible videos are recorded, never replaced with fixtures',async()=>{
  let calls=0;
  const r=await searchYouTube({query:'cloud'},{key:'x',fetcher:async()=>Response.json(++calls===1?{items:ids.map(videoId=>({id:{videoId}}))}:{items:[video(ids[1])]})});
  assert.deepEqual(r.unavailable_video_ids,[ids[0]]);assert.equal(r.items[0].search_rank,2);
});
test('search rejects invalid or unbounded input before network',async()=>{
  for(const body of [null,[],{}, {query:'x',limit:21},{query:'x',limit:1.5},{query:'x'.repeat(201)},{query:'x',page_token:'https://evil.example/'},{query:'\n'}]) {
    await assert.rejects(searchYouTube(body,{key:'x',fetcher:()=>{throw new Error('network must not run');}}),{code:'invalid_search'});
  }
});
test('upstream errors and malformed responses remain errors without leaking credentials',async()=>{
  await assert.rejects(searchYouTube({query:'cloud'},{key:'secret-value',fetcher:async()=>new Response('secret-value',{status:403})}),e=>e.code==='youtube_quota_or_key'&&!e.message.includes('secret-value'));
  await assert.rejects(searchYouTube({query:'cloud'},{key:'x',fetcher:async()=>Response.json({error:{}})}),{code:'youtube_invalid_response'});
});
test('search route works without an app token or Jev key and still checks browser origin',async()=>{
  const env={YOUTUBE_API_KEY:'server-only'};
  const req=(origin,body={query:'cloud'})=>new Request('https://lab.example/api/youtube/search',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
  let calls=0;const deps={youtubeFetcher:async()=>{calls++;return Response.json({items:[]});}};
  assert.equal((await handle(req('https://evil.example'),env,deps)).status,403);
  assert.equal(calls,0);
  const r=await handle(req('https://lab.example'),env,deps);assert.equal(r.status,200);assert.equal((await r.json()).mode,'youtube_search');assert.equal(calls,1);
  assert.equal((await handle(req(undefined,null),env,deps)).status,400);
});
