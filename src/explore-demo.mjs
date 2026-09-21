import {buildTaxonomy} from './taxonomy.mjs';
import {classify} from './classifier.mjs';

// An explicitly synthetic, offline collection. IDs below are official taxonomy
// IDs; fixture IDs are local identifiers, never YouTube video IDs.
const taxonomy=buildTaxonomy([
  {id:'52',parent:null,name:'Business and Finance'},
  {id:'53',parent:'52',name:'Business'},
  {id:'72',parent:'53',name:'Business I.T.'},
  {id:'61',parent:'53',name:'Startups'},
  {id:'132',parent:null,name:'Education'},
  {id:'148',parent:'132',name:'Online Education'},
  {id:'1',parent:null,name:'Automotive'},
  {id:'37',parent:'1',name:'Auto Technology'},
  {id:'40',parent:'37',name:'Auto Safety Technologies'},
  {id:'JLBCU7',parent:null,name:'Entertainment'},
  {id:'338',parent:'JLBCU7',name:'Music'},
  {id:'357',parent:'338',name:'Jazz'}
]);
const fixtures=[
  ['cloud','클라우드 서버, 처음부터 함께 만들기','교육 실습 · 합성 채널','서버 설정부터 배포까지 배우는 온라인 교육 과정입니다.',{'52':.91,'53':.88,'72':.86,'132':.96,'148':.94}],
  ['startup','작은 팀을 위한 업무 자동화','비즈니스 연구 · 합성 채널','스타트업의 IT 시스템과 업무 자동화 사례를 설명합니다.',{'52':.94,'53':.92,'72':.87,'61':.89}],
  ['safety','자동차의 충돌 방지 기술은 어떻게 작동할까','기술 해설 · 합성 채널','자동차 안전 기술과 센서의 동작 원리를 소개합니다.',{'1':.96,'37':.92,'40':.9}],
  ['jazz','재즈의 리듬과 즉흥연주 이야기','음악 수업 · 합성 채널','재즈 음악의 리듬과 즉흥연주를 설명하는 콘텐츠입니다.',{'JLBCU7':.92,'338':.9,'357':.88}],
  ['learning','온라인 학습 환경을 설계하는 방법','교육 실습 · 합성 채널','온라인 강의와 학습 활동을 구성하는 과정을 소개합니다.',{'132':.93,'148':.89}],
  ['broad','음악과 기술이 만나는 순간','콘텐츠 노트 · 합성 채널','음악 콘텐츠입니다. 구체적인 장르를 확정할 단서는 부족합니다.',{'JLBCU7':.79,'338':.88}],
  ['uncertain','오늘의 짧은 기록','일상 기록 · 합성 채널','오늘도 함께해 주세요.',{},.3]
];
const purposeFixtures={cloud:{introduction:.84,tutorial:.95},startup:{case_study:.93,tutorial:.83},safety:{introduction:.94},jazz:{introduction:.91},learning:{tutorial:.9},broad:{},uncertain:{}};
export async function exploreDemo() {
  const items=[];
  for(const [key,title,channel,description,table,sufficient=1] of fixtures) {
    const metadata={video_id:null,title,description,channel_title:channel,tags:[],thumbnail_url:'',duration_iso8601:'',published_at:''};
    const input={title,youtube_url:null,evidence_mode:'metadata_only',metadata,metadata_evidence:[{id:'fixture_title',field:'title',text:title},{id:'fixture_description',field:'description',text:description}]};
    const provider={metrics:{attempts:0,successful_calls:0,input_tokens:0,output_tokens:0,models:new Set(['fixture-not-a-model'])},async evaluate(state,questions){
      return Object.fromEntries(Object.entries(questions).map(([id,q])=>[id,['sufficient','purpose_sufficient'].includes(id)?sufficient:q.instructions.purpose_id?purposeFixtures[key][q.instructions.purpose_id]??.02:table[[...taxonomy.nodes.values()].find(n=>n.path.join(' > ')===q.instructions.category)?.id]??.02]));
    }};
    items.push({fixture_id:`fixture-${key}`,video:metadata,youtube_url:null,search_rank:items.length+1,result:await classify(input,taxonomy,provider,{demo:true})});
  }
  return {mode:'fixture_demo',query:'여러 분야의 합성 예시',items,next_page_token:null,unavailable_video_ids:[],source:'Synthetic fixture',classification_performed:true};
}
