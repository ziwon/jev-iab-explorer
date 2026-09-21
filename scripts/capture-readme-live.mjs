// Records real YouTube search + Jev metadata classification. This is NOT a test.
// Running it uses provider quota/billing. No fixtures or response replay.
import {mkdtemp,mkdir,writeFile,copyFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
if(!process.argv.includes('--live'))throw new Error('Pass --live to run a real search and paid classification capture.');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const run=promisify(execFile),base='http://localhost:8790',query='업무 자동화';
const output=fileURLToPath(new URL('../assets/readme/',import.meta.url));
const staging=await mkdtemp(join(tmpdir(),'jev-live-capture-'));
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH??'/usr/bin/google-chrome',args:['--no-sandbox']});
const frames=[],results=[],failures=[],pageErrors=[],pending=new Set();
let searchRequests=0,searchResult=null,startedAt=new Date().toISOString();
try{
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  page.on('pageerror',e=>pageErrors.push(e.message));
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin===base){
      if(url.pathname==='/api/youtube/search'){
        searchRequests++;
        // Bound this recording to one page; the product still supports 100 items.
        if(searchRequests>1){await route.abort();return;}
      }
      if(url.pathname.startsWith('/api/')&&!['/api/config','/api/youtube/search','/api/youtube/classify'].includes(url.pathname)){await route.abort();return;}
      await route.continue();return;
    }
    if(url.protocol==='https:'&&url.hostname==='i.ytimg.com'&&req.method()==='GET'){await route.continue();return;}
    await route.abort();
  });
  page.on('response',response=>{
    const path=new URL(response.url()).pathname;
    if(!['/api/youtube/search','/api/youtube/classify'].includes(path))return;
    const task=(async()=>{
      const data=await response.json();
      if(!response.ok()){failures.push({path,status:response.status,code:data.error?.code,message:data.error?.message});console.log(JSON.stringify({event:'provider_response_error',path,status:response.status,code:data.error?.code}));return;}
      if(path==='/api/youtube/search'){searchResult=data;console.log(JSON.stringify({event:'search_complete',videos:data.items.length}));}
      else{results.push(data);console.log(JSON.stringify({event:'classified',completed:results.length,status:data.status,mode:data.mode,labels:data.summary.map(x=>x.path.join(' > '))}));}
    })().catch(e=>pageErrors.push(e.message));pending.add(task);task.finally(()=>pending.delete(task));
  });
  const capture=async(phase,duration=1)=>{
    const file=join(staging,`frame-${String(frames.length).padStart(4,'0')}.png`);
    await page.screenshot({path:file,animations:'disabled'});
    frames.push({file,phase,duration,captured_at:new Date().toISOString()});
  };
  await page.goto(base);await page.waitForFunction(()=>document.querySelector('#runtime').classList.contains('ready'),{},{timeout:10000});
  await page.locator('#search-limit').selectOption('12');await page.locator('#query').fill(query);await page.locator('#query').blur();
  await capture('query',1.8);
  await page.locator('#search-submit').click();await capture('searching',0.8);
  let lastState='',finished=false;
  const deadline=Date.now()+20*60*1000;
  while(Date.now()<deadline){
    const state=await page.evaluate(()=>({busy:document.querySelector('#search-submit').disabled,summary:document.querySelector('#result-summary').textContent,count:document.querySelector('#batch-count').textContent,notice:document.querySelector('#notice').textContent,noticeVisible:!document.querySelector('#notice').hidden}));
    const signature=JSON.stringify(state);
    if(signature!==lastState){await capture('live-progress',0.85);lastState=signature;}
    if(!state.busy){finished=true;break;}
    await new Promise(resolve=>setTimeout(resolve,400));
  }
  if(!finished)throw new Error('Capture exceeded the recording deadline.');
  await Promise.all(pending);
  if(!searchResult || !results.length || results.some(r=>r.mode!=='live_jev'))throw new Error('No verified live classification results; existing README capture is unchanged.');
  if(searchRequests!==1)throw new Error('Recording unexpectedly paged beyond the first search page.');
  if(pageErrors.length)throw new Error(pageErrors.join('\n'));
  await capture('classified-overview',3);
  await page.screenshot({path:join(staging,'poster.png'),animations:'disabled'});
  const facets=await page.locator('.facet-select').evaluateAll(nodes=>nodes.map(el=>({id:el.dataset.category,name:el.querySelector('.facet-name').textContent})));
  const chosen=facets.find(x=>/Business I\.T\.|Productivity|Business Software|Artificial Intelligence/.test(x.name))??facets[0];
  if(!chosen)throw new Error('Live results contain no accepted category to demonstrate.');
  await page.locator(`[data-category="${chosen.id}"]`).click();await page.mouse.move(1880,1030);await capture('iab-topic-filter',2.5);
  const card=page.locator('.video-card').filter({has:page.locator('.card-topics')}).first();
  await card.locator('.card-title').click();await page.mouse.move(1880,1030);await capture('raw-and-path-scores',3.5);
  const trace=page.locator('.detail-section').filter({has:page.getByRole('heading',{name:'평가 범위와 판정 경로',exact:true})});
  await trace.locator('summary').first().click();
  await trace.evaluate(el=>el.closest('dialog').scrollTo({top:el.offsetTop-85,behavior:'instant'}));await capture('evaluation-trace',3);
  await page.locator('#detail-close').click();await capture('topic-results',2);
  // Return to the real search form for a clean loop; this makes no provider call.
  await page.reload();await page.waitForFunction(()=>document.querySelector('#runtime').classList.contains('ready'));
  await page.locator('#query').fill(query);await page.locator('#query').blur();await capture('loop-return',0.7);
  const manifest={captured_at:startedAt,query,resolution:{width:1920,height:1080},source:'Live YouTube Data API and TypeSafe Jev responses',evidence_mode:'metadata_only',editing:'API waiting periods shortened; not a real-time speed demonstration.',search_requests:searchRequests,returned_videos:searchResult.items.length,classified_videos:results.length,failures,selected_category:chosen,jev_http_attempts:results.reduce((sum,r)=>sum+r.usage.http_attempts,0),runs:results.map(r=>({youtube_url:r.video.youtube_url,status:r.status,taxonomy:r.taxonomy,rubric_version:r.rubric_version,model_versions:r.usage.model_versions,usage:r.usage,summary:r.summary})),frames:frames.map(({file,...frame})=>frame)};
  await writeFile(join(staging,'capture.json'),JSON.stringify(manifest,null,2)+'\n');
}finally{await browser.close();}
const list=frames.flatMap(f=>[`file '${f.file}'`,`duration ${f.duration}`]);list.push(`file '${frames.at(-1).file}'`);
await writeFile(join(staging,'frames.txt'),list.join('\n')+'\n');
const gif=join(staging,'workflow-automation-live.gif');
await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',join(staging,'frames.txt'),'-filter_complex','[0:v]fps=10,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle','-loop','0',gif],{maxBuffer:1024*1024});
await copyFile(gif,join(output,'workflow-automation-live.gif'));
await copyFile(join(staging,'poster.png'),join(output,'workflow-automation-live.png'));
await copyFile(join(staging,'capture.json'),join(output,'workflow-automation-live.json'));
console.log(JSON.stringify({event:'capture_ready',staging,gif_bytes:(await stat(gif)).size,frames:frames.length,playback_seconds:frames.reduce((sum,f)=>sum+f.duration,0),classified:results.length,failures:failures.length}));
