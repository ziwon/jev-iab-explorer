import {buildTaxonomy} from './taxonomy.mjs';
import {normalizeInput} from '../public/shared.mjs';
export const demoBody={title:'클라우드 강의와 스타트업 운영 · 합성 샘플',segments:[
  {start:0,end:25,text:'오늘 온라인 강의에서는 클라우드 서버의 설정과 회사의 IT 시스템 운영 방법을 배웁니다. 수강생은 실습용 서버를 배포하고 장애를 복구하는 과정을 연습합니다.'},
  {start:25,end:58,text:'이 온라인 교육 과정은 녹화 강의와 실습으로 구성됩니다. 회사에서 사용하는 정보 기술과 서버 운영을 학습하고 과제를 제출하는 방법을 안내합니다.'},
  {start:70,end:105,text:'이제 스타트업을 창업한 뒤 초기 사업을 운영하는 이야기를 하겠습니다. 신규 고객을 찾고 첫 제품을 출시하며 작은 팀으로 비용을 관리했던 경험을 설명합니다.'},
  {start:130,end:136,text:'감사합니다. 다음에 만나요.'}
]};
export const demoTaxonomy=buildTaxonomy([
  {id:'52',parent:null,name:'Business and Finance'},
  {id:'53',parent:'52',name:'Business'},
  {id:'72',parent:'53',name:'Business I.T.'},
  {id:'61',parent:'53',name:'Startups'},
  {id:'132',parent:null,name:'Education'},
  {id:'148',parent:'132',name:'Online Education'},
]);
export const demoInput=()=>normalizeInput(demoBody);
export function demoProvider() {
  const metrics={attempts:0,successful_calls:0,input_tokens:0,output_tokens:0,models:new Set(['fixture-not-a-model'])};
  return {metrics,async evaluate(state,questions){
    // Fixed fixture only. NEVER used for arbitrary user input or provider fallback.
    const tables={seg_1:{'Business and Finance':0.91,'Business':0.88,'Business I.T.':0.84,'Startups':0.08,'Education':0.96,'Online Education':0.93},seg_2:{'Business and Finance':0.95,'Business':0.92,'Startups':0.9,'Business I.T.':0.15,'Education':0.12}};
    return Object.fromEntries(Object.entries(questions).map(([id,q])=>[id,id==='sufficient'?1:tables[state.segment_id]?.[q.instructions.category.split(' > ').at(-1)]??0.03]));
  }};
}
