import {AppError} from '../public/shared.mjs';

// Signed, client-held state. It is not encrypted and is never an access token.
// A domain-separated HMAC binds evidence, raw scores and catalog definitions.
const encoder=new TextEncoder(),decoder=new TextDecoder();
const MAX_TOKEN=175000;
function encode(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
function decode(s){return Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));}
async function signingKey(secret){
  if(!secret)throw new AppError('not_configured','서버에 Jev 키가 필요합니다.',503);
  return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
export async function seal(kind,value,secret,{now=Date.now()}={}){
  const payload=encode(encoder.encode(JSON.stringify({version:1,kind,expires_at:now+6*60*60*1000,value})));
  const signature=encode(new Uint8Array(await crypto.subtle.sign('HMAC',await signingKey(secret),encoder.encode(`jev-explorer-v1.${payload}`))));
  const token=`${payload}.${signature}`;
  if(token.length>MAX_TOKEN)throw new AppError('checkpoint_too_large','입력이 커서 이어서 분류할 정보를 저장하지 못했습니다.',413);
  return token;
}
export async function unseal(token,kind,secret,{now=Date.now()}={}){
  try{
    if(typeof token!=='string'||token.length>MAX_TOKEN||!/^[-\w]+\.[-\w]+$/.test(token))throw new Error();
    const [payload,signature]=token.split('.');
    if(!await crypto.subtle.verify('HMAC',await signingKey(secret),decode(signature),encoder.encode(`jev-explorer-v1.${payload}`)))throw new Error();
    const data=JSON.parse(decoder.decode(decode(payload)));
    if(data.version!==1||data.kind!==kind||!Number.isFinite(data.expires_at))throw new Error();
    if(data.expires_at<now)throw new AppError('checkpoint_expired','분류 재개 정보가 만료되었습니다. 새로 검색해 주세요.',409);
    return data.value;
  }catch(e){if(e instanceof AppError)throw e;throw new AppError('invalid_checkpoint','분류 재개 정보가 유효하지 않습니다. 새로 검색해 주세요.',400);}
}
