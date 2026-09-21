import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {handle,json} from '../src/worker.mjs';
import {AppError,LIMITS,videoId} from '../public/shared.mjs';
const run=promisify(execFile);const root=resolve(fileURLToPath(new URL('../public/',import.meta.url)));
const port=Number(process.env.PORT??8790);const demoOnly=process.argv.includes('--demo-only');let extracting=false;let active=0;
const csp="default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: https://i.ytimg.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};
const env={RUNTIME:'localhost',TYPESAFE_API_KEY:demoOnly?'':process.env.TYPESAFE_API_KEY,YOUTUBE_API_KEY:demoOnly?'':process.env.YOUTUBE_API_KEY,GEMINI_API_KEY:demoOnly?'':process.env.GEMINI_API_KEY,GEMINI_MODEL:process.env.GEMINI_MODEL,JEV_MODEL:process.env.JEV_MODEL,ASSETS:{async fetch(req){
  let path;try{path=decodeURIComponent(new URL(req.url).pathname);}catch{return new Response('Bad path',{status:400});}
  const file=resolve(root,'.'+(path==='/'?'/index.html':path));
  if(!file.startsWith(root+sep) && file!==resolve(root,'index.html'))return new Response('Forbidden',{status:403});
  try{return new Response(await readFile(file),{headers:{'Content-Type':mime[extname(file)]??'application/octet-stream','Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}catch{return new Response('Not found',{status:404});}
}}};
async function extract(url){
  if(extracting)throw new AppError('extractor_busy','다른 자막 추출이 실행 중이야.',429);
  const id=videoId(url);extracting=true;
  try {
    const {stdout}=await run(process.env.PYTHON??'python',[fileURLToPath(new URL('../scripts/extract_youtube.py',import.meta.url)),`--video-id=${id}`],{timeout:45000,maxBuffer:LIMITS.bodyBytes,windowsHide:true,env:{...process.env,TYPESAFE_API_KEY:'',YOUTUBE_API_KEY:'',GEMINI_API_KEY:'',APP_TOKEN:''}});
    const data=JSON.parse(stdout);
    if(data.error)throw new AppError(data.error.code,data.error.message,422);
    return data;
  }catch(e){if(e instanceof AppError)throw e;throw new AppError('input_unavailable','자막을 가져올 수 없어. Python 환경·자막 제공 여부를 확인하거나 SRT/VTT를 직접 입력해.',422);}
  finally{extracting=false;}
}
const server=http.createServer(async(req,res)=>{
  const abort=new AbortController();res.on('close',()=>{if(!res.writableEnded)abort.abort();});
  let entered=false;
  try{
    // Loopback-only listener plus Host/Origin validation: do not expose this server via a tunnel.
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))throw new AppError('forbidden_host','허용되지 않은 Host.',403);
    if(req.method==='POST') {
      if(active>=2)throw new AppError('busy','최대 동시 요청 수를 초과했어.',429);
      active++;entered=true;
    }
    let size=0;const chunks=[];
    for await(const chunk of req){size+=chunk.length;if(size>LIMITS.bodyBytes)throw new AppError('input_too_large','요청이 너무 커.',413);chunks.push(chunk);}
    const request=new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,signal:abort.signal,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
    const response=await handle(request,env,{extract:demoOnly?undefined:extract});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){const response=json({error:{code:e.code??'internal_error',message:e instanceof AppError?e.message:'Local server error.'}},e.status??500);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());}
  finally{if(entered)active--;}
});
server.listen(port,'127.0.0.1',()=>{console.log(`jev-iab-youtube: http://localhost:${port}`);console.log(demoOnly?'Fixture demo only; no external requests.':'Local mode. Live Jev requires .dev.vars. YouTube extraction requires the optional Python dependency.');});
