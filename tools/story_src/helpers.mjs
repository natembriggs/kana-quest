// Compact authoring helpers for Kana Quest stories.
//
// Story source stays readable as Japanese with explicit word boundaries:
//
//   line('昔[むかし]|、|村[むら]|に|...|。', 'Long ago ...')
//
// A reading in square brackets belongs to the kanji immediately before it.
// The build script expands this notation into the verbose runtime token shape.

const KANJI_RE = /[㐀-䶿一-鿿]/;

const PUNCTUATION = new Set([
  '。', '、', '「', '」', '『', '』', '（', '）', '？', '！', '…', '・',
]);

const COMMON = {
  'は': ['topic marker — "as for ..."', 'part'],
  'が': ['subject marker', 'part'],
  'を': ['object marker', 'part'],
  'に': ['to / in / at — destination, place or time', 'part'],
  'へ': ['to / toward — direction', 'part'],
  'で': ['at / in / by — place, means or circumstance', 'part'],
  'と': ['and / with — joins nouns, or marks a quote', 'part'],
  'も': ['also, too / even', 'part'],
  'の': ['possessive — "\'s" / "of"', 'part'],
  'から': ['from / because', 'part'],
  'まで': ['until / as far as', 'part'],
  'より': ['than / from', 'part'],
  'や': ['and — gives examples in a list', 'part'],
  'か': ['question marker / or', 'part'],
  'ね': ['sentence ending seeking agreement', 'part'],
  'よ': ['sentence ending adding emphasis', 'part'],
  'ので': ['because / since', 'part'],
  'のに': ['although / despite', 'part'],
  'けれど': ['but / although', 'part'],
  'けれども': ['but / although', 'part'],
  'なら': ['if it is / if that is the case', 'part'],
  'ばかり': ['only / just / nothing but', 'part'],
  'ほど': ['to the extent that / about', 'part'],
  'だけ': ['only / just', 'part'],
  'ずつ': ['each / at a time', 'part'],
  'など': ['and so on / such as', 'part'],
  'って': ['casual quotation or topic marker', 'part'],
  'この': ['this', 'adj'],
  'その': ['that; the previously mentioned', 'adj'],
  'あの': ['that over there; that remembered', 'adj'],
  'これ': ['this; this one', 'n'],
  'それ': ['that; that one', 'n'],
  'あれ': ['that over there', 'n'],
  'だ': ['is; to be', 'aux'],
  'だった': ['was', 'aux', { df: 'だ', cf: 'plain past' }],
  'でした': ['was', 'aux', { df: 'だ', cf: 'polite past' }],
  'いた': ['was there; lived', 'v', { df: 'いる', cf: 'plain past' }],
  'いる': ['is there; lives', 'v', { df: 'いる', cf: 'plain present' }],
  'なりました': ['became', 'v', { df: 'なる', cf: 'polite past' }],
  'という': ['called; known as', 'part'],
  'まま': ['remaining as; still in the same state', 'part'],
  'ください': ['please do', 'aux'],
  'そして': ['and then', 'adv'],
  'それでも': ['even so, nevertheless', 'adv'],
  'そんなに': ['that much; so', 'adv'],
  'おまえ': ['you (blunt, familiar)', 'pn'],
  'それぞれ': ['each; respectively', 'adv'],
  '私[わたし]': ['I, me', 'pn'],
  '時[とき]': ['when; time', 'n'],
  'あなた': ['you', 'pn'],
  'たち': ['plural suffix — marks a group, "-s" or "and the others"', 'part'],
  'しかし': ['however, but', 'adv'],
  'よく': ['well; often; much', 'adv'],
  'やがて': ['soon, before long', 'adv'],
  'のように': ['like; in the manner of', 'part'],
  'のような': ['like; resembling', 'part'],
  'こと': ['nominalizer — turns a verb or clause into "the act/fact of ~"', 'part'],
};

export function line(tokens, en) {
  // Expand this common jukujikun shorthand to per-character readings so the
  // runtime can still link and render every kanji independently.
  return { tokens: tokens.replaceAll('一人[ひとり]', '一[ひと]人[り]'), en };
}

export function lexicon(entries) {
  return entries;
}

function normaliseDefinition(raw) {
  if (Array.isArray(raw)) {
    const [g, pos = 'n', extra = {}] = raw;
    return { g, pos, ...extra };
  }
  return { pos: 'n', ...raw };
}

function parseAnnotated(form) {
  let s = '';
  let k = '';
  const ruby = [];

  for (let i = 0; i < form.length;) {
    const ch = form[i];
    if (ch === '[' || ch === ']') {
      throw new Error(`orphan reading bracket in token ${form}`);
    }
    const surfaceIndex = s.length;
    s += ch;
    i += ch.length;

    if (KANJI_RE.test(ch)) {
      if (form[i] !== '[') {
        throw new Error(`kanji ${ch} has no reading annotation in token ${form}`);
      }
      const end = form.indexOf(']', i + 1);
      if (end < 0) throw new Error(`unclosed reading annotation in token ${form}`);
      const reading = form.slice(i + 1, end);
      if (!reading) throw new Error(`empty reading annotation in token ${form}`);
      ruby.push([surfaceIndex, reading]);
      k += reading;
      i = end + 1;
    } else {
      k += ch;
    }
  }
  return { s, k, ruby: ruby.length ? ruby : null };
}

function tokenFrom(key, storyLexicon, storyId) {
  // A source-only #sense suffix lets the same written word carry a different
  // contextual gloss (が#but versus the ordinary subject-marker が). It is
  // stripped before runtime data is emitted.
  const marker = key.indexOf('#');
  const form = marker < 0 ? key : key.slice(0, marker);
  if (PUNCTUATION.has(form)) {
    return { s: form, k: form, d: null, pos: 'punct', ruby: null, g: null };
  }
  const raw = Object.prototype.hasOwnProperty.call(storyLexicon, key)
    ? storyLexicon[key]
    : COMMON[form];
  if (!raw) throw new Error(`${storyId}: no lexicon entry for token ${key}`);
  const def = normaliseDefinition(raw);
  const parsed = parseAnnotated(form);
  return {
    ...parsed,
    d: def.d === undefined ? null : def.d,
    pos: def.pos,
    g: def.g,
    ...(def.df ? { df: def.df, cf: def.cf } : {}),
  };
}

export function expandStory(spec) {
  const body = spec.body.map((paragraph) => paragraph.map((sentence) => {
    if (!sentence.en || !sentence.en.trim()) {
      throw new Error(`${spec.id}: sentence has no English translation`);
    }
    const forms = sentence.tokens.split('|');
    if (forms.some((form) => !form)) {
      throw new Error(`${spec.id}: empty token boundary in ${sentence.tokens}`);
    }
    return {
      en: sentence.en,
      t: forms.map((form) => tokenFrom(form, spec.lexicon, spec.id)),
    };
  }));
  const { lexicon: _lexicon, ...record } = spec;
  return { ...record, body };
}
