/** Project-defined viewing purposes. These are not IAB categories. */
export const PURPOSES = Object.freeze([
  {id:'introduction',name:'입문 설명',description:'Introduces foundational concepts for a newcomer; explains what a subject is or how it works.'},
  {id:'tutorial',name:'실습 튜토리얼',description:'Teaches an actionable task through steps, a walkthrough, or a hands-on demonstration.'},
  {id:'comparison',name:'제품 비교',description:'Explicitly compares two or more products, tools, or services to help choose between them.'},
  {id:'news',name:'뉴스',description:'Reports a specific recent event, announcement, or development. A publication date alone is not evidence.'},
  {id:'case_study',name:'사례 소개',description:'Examines a concrete implementation, project, experience, or outcome in context.'}
]);
export const PURPOSE_ACCEPT = 0.75;
export const PURPOSE_RUBRIC_VERSION = 'viewing-purpose-2026-09-22-v2';
export const purposeCatalog=result=>result?.purpose_rubric?.catalog??PURPOSES;
