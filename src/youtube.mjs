import {AppError,canonicalUrl,normalizeMetadataInput,videoId} from '../public/shared.mjs';

export const YOUTUBE_VIDEOS_ENDPOINT='https://www.googleapis.com/youtube/v3/videos';
export const YOUTUBE_SEARCH_ENDPOINT='https://www.googleapis.com/youtube/v3/search';

export function normalizeSearch(body) {
  if(!body || typeof body!=='object' || Array.isArray(body)) throw new AppError('invalid_search','검색 조건이 필요합니다.');
  const query=typeof body.query==='string'?body.query.trim():'';
  if(!query || query.length>200 || /[\u0000-\u001f]/.test(query)) throw new AppError('invalid_search','검색어를 1~200자로 입력해 주세요.');
  const limit=body.limit??12;
  if(!Number.isInteger(limit) || limit<1 || limit>20) throw new AppError('invalid_search','한 번에 1~20개 영상을 검색할 수 있습니다.');
  const pageToken=body.page_token??'';
  if(typeof pageToken!=='string' || !/^[A-Za-z0-9_=-]{0,512}$/.test(pageToken)) throw new AppError('invalid_search','유효하지 않은 다음 페이지 정보입니다. 다시 검색해 주세요.');
  return {query,limit,pageToken};
}

async function youtubeRequest(endpoint,params,{key,fetcher=fetch,signal}={}) {
  if(!key) throw new AppError('not_configured','서버에 YOUTUBE_API_KEY가 없어.',503);
  const url=new URL(endpoint);
  for(const [name,value] of Object.entries(params)) url.searchParams.set(name,String(value));
  url.searchParams.set('key',key);
  let response;
  try {
    const timeout=AbortSignal.timeout(8000);
    response=await fetcher(url,{method:'GET',redirect:'error',signal:signal?AbortSignal.any([signal,timeout]):timeout,headers:{Accept:'application/json'}});
  } catch {
    throw new AppError(signal?.aborted?'cancelled':'youtube_unavailable','YouTube 요청이 취소되었거나 연결 시간이 초과되었습니다. 다시 시도해 주세요.',502);
  }
  if(!response.ok) {
    await response.body?.cancel();
    throw new AppError(response.status===403?'youtube_quota_or_key':'youtube_error',`YouTube Data API HTTP ${response.status}. 서버 키와 quota를 확인해 주세요.`,502);
  }
  let data;try{data=await response.json();}catch{throw new AppError('youtube_invalid_response','YouTube 응답을 읽을 수 없습니다.',502);}
  if(!Array.isArray(data?.items)) throw new AppError('youtube_invalid_response','YouTube 응답에 영상 목록이 없습니다.',502);
  return data;
}

function metadataFromItem(item,id) {
  const snippet=item.snippet??{};const details=item.contentDetails??{};
  const thumbs=snippet.thumbnails??{};
  const thumbnail=thumbs.high??thumbs.medium??thumbs.default;
  return normalizeMetadataInput({
    video_id:id,title:snippet.title,description:snippet.description,tags:snippet.tags,
    youtube_category_id:snippet.categoryId,channel_title:snippet.channelTitle,
    default_language:snippet.defaultLanguage,default_audio_language:snippet.defaultAudioLanguage,
    duration_iso8601:details.duration,published_at:snippet.publishedAt,thumbnail_url:thumbnail?.url
  },canonicalUrl(id));
}

export async function searchYouTube(body,options={}) {
  const {query,limit,pageToken}=normalizeSearch(body);
  const data=await youtubeRequest(YOUTUBE_SEARCH_ENDPOINT,{part:'snippet',type:'video',q:query,maxResults:limit,order:'relevance',...(pageToken?{pageToken}:{})},options);
  const ids=[...new Set(data.items.map(x=>x?.id?.videoId).filter(x=>typeof x==='string'&&/^[\w-]{11}$/.test(x)))].slice(0,limit);
  const details=ids.length?await youtubeRequest(YOUTUBE_VIDEOS_ENDPOINT,{part:'snippet,contentDetails',id:ids.join(',')},options):{items:[]};
  const byId=new Map(details.items.filter(x=>ids.includes(x.id)).map(x=>[x.id,x]));
  const items=[];const unavailable=[];
  for(const [index,id] of ids.entries()) {
    const item=byId.get(id);
    if(!item){unavailable.push(id);continue;}
    const input=metadataFromItem(item,id);
    items.push({video:input.metadata,youtube_url:input.youtube_url,search_rank:index+1});
  }
  return {mode:'youtube_search',query,items,next_page_token:typeof data.nextPageToken==='string'?data.nextPageToken:null,unavailable_video_ids:unavailable,source:'YouTube Data API',order:'relevance',classification_performed:false};
}

export async function fetchYouTubeMetadata(value,{key,fetcher=fetch,signal}={}) {
  if(!key) throw new AppError('not_configured','서버에 YOUTUBE_API_KEY가 없어.',503);
  const id=videoId(value);
  const data=await youtubeRequest(YOUTUBE_VIDEOS_ENDPOINT,{part:'snippet,contentDetails',id},{key,fetcher,signal});
  const item=data?.items?.[0];
  if(!item) throw new AppError('video_unavailable','공개 영상 metadata를 찾을 수 없어. 삭제·비공개·지역 제한 여부를 확인해.',404);
  return metadataFromItem(item,id);
}
