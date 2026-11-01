/**
 * User-visible text (Korean UI). Shared by the pipeline, the service worker and the extension pages.
 * The content scripts (overlay.js, content.js) are classic scripts and keep their few strings inline.
 */
export const ko = {
  verdict: { match: '원문과 일치', distorted: '왜곡됨', not_found: '출처 없음', unclear: '판단 불가' },
  stepNames: ['글 읽기', '원출처 찾기', '확인·요약'],   // one per entry of STEPS in messages.js

  // Fixed notes the pipeline adds to results, in the two output languages.
  pipeline: {
    notFound: '신뢰할 수 있는 출처에서 이 주장에 대한 기사를 찾지 못했어요.',
    noMatch: '후보 기사 중 이 주장과 분명히 일치하는 것이 없어요.',
    unreadable: ' (기사를 열 수 없어 검색 결과 요약만으로 판단했어요.)',
    failed: '추적에 실패했어요: ',
    noClaims: '사실 여부를 확인할 수 있는 주장이 없어요.'
  },
  pipelineEn: {
    notFound: 'No article from the trusted outlets was found for this claim.',
    noMatch: 'None of the candidate articles clearly matches this claim.',
    unreadable: ' (The page could not be opened, so this is based on the search snippet only.)',
    failed: 'Tracing failed: ',
    noClaims: 'No checkable factual claims found.'
  },

  err: {
    noKey: 'OpenRouter API 키가 없어요. 툴바 아이콘 → 설정에서 입력해 주세요.',
    unknownProvider: p => `알 수 없는 제공자예요: ${p}`,
    modelBusy: m => `${m} 모델이 지금 혼잡해요(무료 모델 공용 한도).`,
    freeLimit: '무료 모델 사용 한도에 도달했어요(분당 20회, 하루 50회). 잠시 후 다시 시도해 주세요.',
    badKey: 'OpenRouter가 API 키를 거부했어요. 설정에서 키를 확인해 주세요.',
    empty: m => `${m} 모델이 빈 답을 보냈어요(생각하는 데 토큰을 다 쓴 것 같아요).`,
    allBusy: last => `무료 모델이 모두 혼잡하거나 사용할 수 없어요. 잠시 후 다시 시도해 주세요. (마지막 오류: ${last})`,
    noJson: '모델이 JSON 형식으로 답하지 않았어요.',
    badJson: '모델의 답이 올바른 JSON이 아니에요.'
  },

  menu: '이 주장 추적하기',

  quota: q => `${q.used} / ${q.limit}회 사용`
};
