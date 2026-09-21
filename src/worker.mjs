import {AppError,LIMITS,normalizeInput} from '../public/shared.mjs';
import {loadTaxonomy} from './taxonomy.mjs';
import {createJev} from './jev.mjs';
import {classify} from './classifier.mjs';
import {demoBody,demoInput,demoProvider,demoTaxonomy} from './demo.mjs';
import {fetchYouTubeMetadata,searchYouTube} from './youtube.mjs';
import {exploreDemo} from './explore-demo.mjs';
export function json(data,status=200) {
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
}
export async function readJson(request) {
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new AppError('invalid_content_type','application/json이 필요해.',415);
  if(Number(request.headers.get('content-length'))>LIMITS.bodyBytes) throw new AppError('input_too_large','요청 body가 너무 커.',413);
  const reader=request.body?.getReader(); if(!reader) throw new AppError('invalid_input','요청 body가 없어.');
  let size=0;const chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>LIMITS.bodyBytes){await reader.cancel();throw new AppError('input_too_large','요청 body가 너무 커.',413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let i=0;for(const c of chunks){bytes.set(c,i);i+=c.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new AppError('invalid_json','JSON을 읽을 수 없어.');}
}
export function assertSameOrigin(request) {
  const origin=request.headers.get('origin');
  if(origin && origin!==new URL(request.url).origin) throw new AppError('forbidden_origin','동일 origin에서만 호출할 수 있어.',403);
  // Browser request protection only; deployment access control belongs at the perimeter.
  const site=request.headers.get('sec-fetch-site');
  if(site && !['same-origin','none'].includes(site))throw new AppError('forbidden_origin','동일 origin에서만 호출할 수 있어.',403);
}
export async function handle(request,env={},deps={}) {
  try {
    const {pathname}=new URL(request.url);
    if(pathname==='/api/config' && request.method==='GET')return json({version:'0.2.0',runtime:env.RUNTIME??'cloudflare-workers',live_available:!!env.TYPESAFE_API_KEY,metadata_available:!!env.YOUTUBE_API_KEY,local_extraction:!!deps.extract,limits:LIMITS});
    if(pathname==='/api/demo' && request.method==='GET')return json({input:demoBody,result:await classify(demoInput(),demoTaxonomy,demoProvider(),{demo:true})});
    if(pathname==='/api/explore/demo' && request.method==='GET')return json(await exploreDemo());
    if(['/api/classify','/api/transcript','/api/youtube/metadata','/api/youtube/classify','/api/youtube/search'].includes(pathname) && request.method==='POST') {
      assertSameOrigin(request); const body=await readJson(request);
      if(!body || typeof body!=='object' || Array.isArray(body)) throw new AppError('invalid_input','JSON object가 필요해.');
      if(pathname==='/api/youtube/search') return json(await searchYouTube(body,{key:env.YOUTUBE_API_KEY,fetcher:deps.youtubeFetcher??fetch,signal:request.signal}));
      if(pathname==='/api/transcript') {
        if(!deps.extract)throw new AppError('input_unavailable','Cloudflare 버전은 자막 파일/붙여넣기를 사용해. URL 자막 추출은 npm run dev 로컬 서버에서 지원해.',422);
        return json(await deps.extract(body.youtube_url));
      }
      if(pathname==='/api/youtube/metadata' || pathname==='/api/youtube/classify') {
        if(pathname==='/api/youtube/classify' && body.consent!==true)throw new AppError('consent_required','공개 YouTube metadata를 TypeSafe에 전송하는 데 동의가 필요해.',422);
        const input=deps.youtubeMetadata
          ? await deps.youtubeMetadata(body.youtube_url)
          : await fetchYouTubeMetadata(body.youtube_url,{key:env.YOUTUBE_API_KEY,fetcher:deps.youtubeFetcher??fetch,signal:request.signal});
        if(pathname==='/api/youtube/metadata') return json({video:input.metadata,youtube_url:input.youtube_url});
        if(!env.TYPESAFE_API_KEY)throw new AppError('not_configured','서버에 TYPESAFE_API_KEY가 없어.',503);
        const taxonomy=deps.taxonomy??await loadTaxonomy(deps.fetcher??fetch);
        const provider=deps.provider??createJev({key:env.TYPESAFE_API_KEY,model:env.JEV_MODEL??'jev-latest',signal:request.signal,fetcher:deps.fetcher??fetch});
        return json(await classify(input,taxonomy,provider));
      }
      if(body.consent!==true)throw new AppError('consent_required','선택한 자막과 제목을 TypeSafe에 전송하는 데 동의가 필요해.',422);
      if(!env.TYPESAFE_API_KEY)throw new AppError('not_configured','서버에 TYPESAFE_API_KEY가 없어. 샘플 데모는 키 없이 볼 수 있어.',503);
      const input=normalizeInput(body);
      const taxonomy=deps.taxonomy??await loadTaxonomy(deps.fetcher??fetch);
      const provider=deps.provider??createJev({key:env.TYPESAFE_API_KEY,model:env.JEV_MODEL??'jev-latest',signal:request.signal,fetcher:deps.fetcher??fetch});
      return json(await classify(input,taxonomy,provider));
    }
    if(pathname.startsWith('/api/'))return json({error:{code:'not_found',message:'API route 또는 HTTP method가 맞지 않아.'}},404);
    return env.ASSETS?env.ASSETS.fetch(request):new Response('Not found',{status:404});
  } catch(e) {
    // Do not echo raw provider errors, state, subtitles, or credentials.
    return json({error:{code:e instanceof AppError?e.code:'internal_error',message:e instanceof AppError?e.message:'내부 오류가 발생했어. 입력이나 키를 로그에 남기지 않았어.'}},e instanceof AppError?e.status:500);
  }
}
export default {fetch:handle};
