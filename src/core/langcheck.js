// Free models sometimes slip into other languages mid-sentence (Chinese, Japanese, glued English, junk tokens).
// isCleanText() is the gate every user-facing sentence must pass; anything that fails is retried or replaced.
export function isCleanText(text, lang) {
  if (/[぀-ヿ㐀-鿿豈-﫿]/.test(text)) return false;                       // Chinese / Japanese leaked in
  if (/[^\p{Script=Hangul}\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(text)) return false; // Cyrillic, Thai, Arabic ...
  if (/[a-z][A-Z]{2}/.test(text)) return false;                                                    // junk like "dexterouslySENews"
  if (lang === 'ko') {
    if (/[가-힣][A-Za-z]/.test(text)) return false;                                        // Latin glued after Hangul ("야ahu")
    if (/(?:[A-Za-z][A-Za-z'’-]*[ ,]+){4}[A-Za-z]/.test(text)) return false;                      // an untranslated English sentence
  } else if (/[가-힣]/.test(text)) {
    return false;                                                                                  // Korean inside English text
  }
  return true;
}
