import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
import {get} from 'node:http';
test('localhost serves HTML, CSS, ES modules and actual demo route',async(t)=>{
  const port=18789;
  const child=spawn(process.execPath,['scripts/server.mjs','--demo-only'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('server startup timeout')),5000);child.stdout.on('data',s=>{if(s.toString().includes('http://localhost')){clearTimeout(timeout);resolve();}});child.on('error',reject);child.on('exit',c=>{if(c)reject(new Error(`server exit ${c}`));});});
  for(const [path,type] of [['/','text/html'],['/analyze.html','text/html'],['/explore.mjs','text/javascript'],['/explore-data.mjs','text/javascript'],['/explore.css','text/css'],['/shared.mjs','text/javascript']]){
    const r=await fetch(`http://127.0.0.1:${port}${path}`);assert.equal(r.status,200,path);assert.ok(r.headers.get('content-type').includes(type));assert.ok(r.headers.get('content-security-policy'));
  }
  const r=await fetch(`http://127.0.0.1:${port}/api/demo`);assert.equal(r.status,200);assert.equal((await r.json()).result.segments.length,3);
  const browserDemo=await fetch(`http://127.0.0.1:${port}/api/explore/demo`);assert.equal(browserDemo.status,200);assert.equal((await browserDemo.json()).mode,'fixture_demo');
  const blocked=await fetch(`http://127.0.0.1:${port}/.dev.vars`);assert.equal(blocked.status,404);
  const foreignHost=await new Promise((resolve,reject)=>{get(`http://127.0.0.1:${port}/api/config`,{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});assert.equal(foreignHost,403);
  const foreignOrigin=await fetch(`http://127.0.0.1:${port}/api/youtube/search`,{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({query:'synthetic'})});assert.equal(foreignOrigin.status,403);
});
