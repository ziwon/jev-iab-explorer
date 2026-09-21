/** Shared validation and subtitle parsing. No network, Node, or DOM dependency. */
export const LIMITS = Object.freeze({bodyBytes: 196608, transcriptChars: 40000, cues: 2000, segmentChars: 4000, segments: 8});
export class AppError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export function videoId(value) {
  if (typeof value !== 'string') throw new AppError('invalid_url', 'YouTube URL 또는 11자리 video ID가 필요해.');
  const input = value.trim();
  if (/^[\w-]{11}$/.test(input)) return input;
  let u; try { u = new URL(input); } catch { throw new AppError('invalid_url', '올바른 YouTube URL이 아니야.'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) throw new AppError('invalid_url', '인증정보나 포트 없는 HTTPS YouTube URL만 허용해.');
  let id;
  if (u.hostname === 'youtu.be') id = u.pathname.slice(1);
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(u.hostname)) {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else id = /^\/(?:shorts|embed|live)\/([\w-]{11})\/?$/.exec(u.pathname)?.[1];
  }
  if (!id || !/^[\w-]{11}$/.test(id)) throw new AppError('invalid_url', '영상 하나의 YouTube URL만 허용해. 재생목록과 외부 URL은 지원하지 않아.');
  return id;
}
export const canonicalUrl = value => `https://www.youtube.com/watch?v=${videoId(value)}`;
function unescapeText(text) {
  return text.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, x) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[x])
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (all, x) => {
      const n = x[0].toLowerCase() === 'x' ? parseInt(x.slice(1), 16) : Number(x);
      return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }).trim();
}
function stamp(text) {
  const p = text.replace(',', '.').split(':').map(Number);
  if (p.some(x => !Number.isFinite(x) || x < 0) || p.length < 2 || p.length > 3 || p.at(-1) >= 60 || (p.length === 3 && p[1] >= 60))
    throw new AppError('invalid_transcript', '자막 timestamp가 잘못됐어.');
  return p.length === 3 ? p[0]*3600+p[1]*60+p[2] : p[0]*60+p[1];
}
export function parseTranscript(input) {
  let raw = input;
  if (typeof raw === 'string') {
    if (raw.length > LIMITS.transcriptChars) throw new AppError('input_too_large', 'PoC 자막 입력은 40,000자까지야. 구간을 나눠서 실행해.');
    const text = raw.replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
    if (!text) throw new AppError('input_unavailable', '자막 내용이 필요해. 제목만으로 영상 전체를 분류하지 않아.', 422);
    if (/^[\[{]/.test(text)) {
      try { raw = JSON.parse(text); } catch {
        if (/^\[(?:Music|음악|Applause|박수)\]/i.test(text)) raw=[{start:null,end:null,text}];
        else throw new AppError('invalid_transcript', '자막 JSON을 읽을 수 없어.');
      }
    } else if (text.includes('-->')) {
      raw = [];
      const lines = text.split('\n');
      for (let i=0; i<lines.length; i++) {
        if (!lines[i].includes('-->')) continue;
        const m = /^\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}[.,]\d{3})(?:\s.*)?$/.exec(lines[i]);
        if (!m) throw new AppError('invalid_transcript', 'SRT/VTT 시간 형식을 확인해.');
        const parts=[];
        while (i+1<lines.length && lines[i+1].trim() && !lines[i+1].includes('-->')) parts.push(lines[++i]);
        raw.push({start:stamp(m[1]), end:stamp(m[2]), text:unescapeText(parts.join(' '))});
      }
    } else {
      // No fabricated timestamps for plain text.
      raw = [{start:null, end:null, text}];
    }
  }
  if (raw && !Array.isArray(raw) && typeof raw === 'object') raw = raw.segments;
  if (!Array.isArray(raw) || !raw.length || raw.length > LIMITS.cues) throw new AppError('invalid_transcript', '비어 있지 않은 segments 배열이 필요해. 최대 2,000개 cue를 허용해.');
  let chars=0;
  const cues=raw.map((c,i) => {
    if (!c || typeof c.text !== 'string' || !c.text.trim()) throw new AppError('invalid_transcript', `cue ${i+1}: text가 필요해.`);
    const text=c.text.trim(); chars+=text.length;
    const start=c.start ?? c.start_sec ?? null;
    const end=c.end ?? c.end_sec ?? (typeof start === 'number' && typeof c.duration === 'number' ? start+c.duration : null);
    const untimed=start===null && end===null;
    if (!untimed && (!(typeof start==='number' && typeof end==='number') || !Number.isFinite(start) || !Number.isFinite(end) || start<0 || end<=start || end>86400))
      throw new AppError('invalid_transcript', `cue ${i+1}: 시작/종료 시간을 확인해.`);
    if (text.length>LIMITS.segmentChars) throw new AppError('input_too_large', '한 cue 또는 시간 없는 텍스트는 4,000자 이하여야 해.');
    return {id:`cue_${i+1}`, start, end, text};
  });
  if (chars>LIMITS.transcriptChars) throw new AppError('input_too_large', '자막 총 길이는 40,000자 이하여야 해.');
  if (cues.some(c=>c.start===null) && cues.some(c=>c.start!==null)) throw new AppError('invalid_transcript', '시간 있는 cue와 시간 없는 cue를 혼합할 수 없어.');
  if (cues.every(c=>c.start!==null)) cues.sort((a,b)=>a.start-b.start);
  return cues;
}
export function segmentCues(cues) {
  const groups=[]; let group=[]; let chars=0;
  const emit=()=>{ if(group.length) groups.push({id:`seg_${groups.length+1}`,start:group[0].start,end:group[0].start===null?null:Math.max(...group.map(x=>x.end)),evidence:group}); group=[]; chars=0; };
  for(const cue of cues) {
    if(group.length && (chars+cue.text.length>LIMITS.segmentChars || (cue.start!==null && (cue.start-group[0].start>=60 || cue.start-group.at(-1).end>15)))) emit();
    group.push(cue); chars+=cue.text.length;
  }
  emit(); return groups;
}
export function normalizeInput(body) {
  if(!body || typeof body!=='object' || Array.isArray(body)) throw new AppError('invalid_input','JSON object가 필요해.');
  if(body.title!==undefined && (typeof body.title!=='string' || body.title.length>300)) throw new AppError('invalid_input','제목은 300자 이하여야 해.');
  return {title:body.title?.trim()??'',youtube_url:body.youtube_url?canonicalUrl(body.youtube_url):null,cues:parseTranscript(body.transcript ?? body.segments)};
}

export function normalizeMetadataInput(metadata, youtubeUrl) {
  if(!metadata || typeof metadata!=='object' || Array.isArray(metadata)) throw new AppError('invalid_metadata','YouTube metadata object가 필요해.',502);
  const text=(value,max=5000)=>typeof value==='string'?value.trim().slice(0,max):'';
  const tags=Array.isArray(metadata.tags)?metadata.tags.filter(x=>typeof x==='string'&&x.trim()).slice(0,100).map(x=>x.trim().slice(0,100)):[];
  const normalized={
    video_id:typeof metadata.video_id==='string'?metadata.video_id.trim():'',title:text(metadata.title,300),description:text(metadata.description),tags,
    youtube_category_id:text(metadata.youtube_category_id,20),channel_title:text(metadata.channel_title,200),
    default_language:text(metadata.default_language,35),default_audio_language:text(metadata.default_audio_language,35),
    duration_iso8601:text(metadata.duration_iso8601,40),published_at:text(metadata.published_at,40),
    thumbnail_url:text(metadata.thumbnail_url,1000)
  };
  if(!/^[\w-]{11}$/.test(normalized.video_id) || !normalized.title) throw new AppError('invalid_metadata','YouTube 응답에 video ID 또는 title이 없어.',502);
  const evidence=[
    {id:'meta_title',field:'title',text:normalized.title},
    ...(normalized.description?[{id:'meta_description',field:'description',text:normalized.description}]:[]),
    ...(tags.length?[{id:'meta_tags',field:'tags',text:tags.join(', ')}]:[]),
    ...(normalized.youtube_category_id?[{id:'meta_category',field:'youtube_category_id',text:normalized.youtube_category_id}]:[]),
    ...(normalized.channel_title?[{id:'meta_channel',field:'channel_title',text:normalized.channel_title}]:[])
  ];
  return {title:normalized.title,youtube_url:canonicalUrl(youtubeUrl??normalized.video_id),cues:[],metadata:normalized,metadata_evidence:evidence,evidence_mode:'metadata_only'};
}
