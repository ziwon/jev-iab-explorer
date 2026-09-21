import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchYouTubeMetadata,YOUTUBE_VIDEOS_ENDPOINT} from '../src/youtube.mjs';

const id='abcDE_12-34';
const fixture={items:[{snippet:{title:'NVIDIA Blackwell B200 Deep Dive',description:'Benchmarks and architecture of a datacenter GPU.',tags:['NVIDIA','B200','GPU'],categoryId:'28',channelTitle:'Example Tech',defaultLanguage:'en',publishedAt:'2026-09-01T00:00:00Z',thumbnails:{high:{url:'https://i.ytimg.com/vi/example/hqdefault.jpg'}}},contentDetails:{duration:'PT13M44S'}}]};

test('uses only fixed videos.list endpoint and normalizes public metadata',async()=>{
  const input=await fetchYouTubeMetadata(id,{key:'server-key',fetcher:async(url,options)=>{
    assert.equal(url.origin+url.pathname,YOUTUBE_VIDEOS_ENDPOINT);
    assert.equal(url.searchParams.get('part'),'snippet,contentDetails');
    assert.equal(url.searchParams.get('id'),id);
    assert.equal(url.searchParams.get('key'),'server-key');
    assert.equal(options.method,'GET');
    return Response.json(fixture);
  }});
  assert.equal(input.evidence_mode,'metadata_only');
  assert.equal(input.metadata.youtube_category_id,'28');
  assert.deepEqual(input.metadata.tags,['NVIDIA','B200','GPU']);
  assert.equal(input.metadata_evidence[0].id,'meta_title');
});

test('missing API key fails before network access',async()=>{
  let called=false;
  await assert.rejects(fetchYouTubeMetadata(id,{fetcher:async()=>{called=true;}}),{code:'not_configured'});
  assert.equal(called,false);
});

test('unavailable video is explicit',async()=>{
  await assert.rejects(fetchYouTubeMetadata(id,{key:'x',fetcher:async()=>Response.json({items:[]})}),{code:'video_unavailable'});
});

test('YouTube upstream details and API key are not exposed in errors',async()=>{
  await assert.rejects(fetchYouTubeMetadata(id,{key:'do-not-leak',fetcher:async()=>new Response('sensitive',{status:403})}),e=>e.code==='youtube_quota_or_key'&&!e.message.includes('do-not-leak')&&!e.message.includes('sensitive'));
});
