import { expandStory, lexicon, line } from './helpers.mjs';

// Scene map and prose-first draft: keeki-o-mite-kudasai-draft.md.
const theStory = expandStory({
  id: 'keeki-o-mite-kudasai',
  title: { ja: 'ケーキを見てください', en: 'Please Watch the Cake' },
  level: 'L1',
  gram: 'G1',
  blurb: 'Mum asks the family’s brand-new robot to watch the cake while she goes out. The robot is very good at doing exactly what it is told.',
  nw: ['ロボット', 'ケーキ', '見る', '食べる', '内緒'],
  // Setup, the robot watching an empty plate, then Kota asking it to keep a secret.
  art: { inline: [{ after: 0, file: '01.webp' }, { after: 1, file: '02.webp' }, { after: 2, file: '03.webp' }] },
  series: null,
  source: {
    kind: 'original',
    text: 'An original story written for Kanji Trail',
    by: 'Claude Opus 5.5',
    credit: 'Written by',
    notes: 'Original Japanese prose and English translations written for this reading level. No published text was adapted.',
    licence: 'Original to Kanji Trail; Japanese text and English translations may be used and adapted with the app.',
    illustrations: 'Inline paintings generated with OpenAI built-in image generation for Kanji Trail, using the approved Kasa Jizō inline treatment and original character designs.',
  },
  lexicon: lexicon({
    'こうた': ['Kota (a boy’s name)', 'pn'],
    // The curriculum's 家 entry is け ("family, house of"), not いえ.
    '家[いえ]': ['house, home', 'n', { d: false }],
    '新[あたら]しい': ['new', 'adj'],
    'ロボット': ['robot', 'n'],
    '来[き]ました': ['came', 'v', { df: '来る', cf: 'polite past' }],
    'お母[かあ]さん': ['Mum, Mother', 'n'],
    'ケーキ': ['cake', 'n'],
    '見[み]てください': ['please watch; please keep an eye on', 'v', { df: '見る', cf: 'polite request form' }],
    '言[い]いました': ['said', 'v', { df: '言う', cf: 'polite past' }],
    'それから': ['after that, then', 'conj', { d: '其れから' }],
    '買[か]い物[もの]': ['shopping', 'n'],
    '行[い]きました': ['went', 'v', { df: '行く', cf: 'polite past' }],
    'じっと': ['fixedly, without looking away', 'adv'],
    '見[み]ました': ['looked at, watched', 'v', { df: '見る', cf: 'polite past' }],
    'いちご': ['strawberry', 'n'],
    '一[ひと]つ': ['one (thing)', 'n'],
    '食[た]べました': ['ate', 'v', { df: '食べる', cf: 'polite past' }],
    '全[ぜん]部[ぶ]': ['all of it, the whole thing', 'n'],
    'とても': ['very', 'adv'],
    'よく': ['closely, carefully', 'adv'],
    '内[ない]緒[しょ]': ['a secret (between people)', 'n'],
    'はい': ['yes', 'int'],
    'です': ['is', 'aux', { df: 'だ', cf: 'polite present/future' }],
    '帰[かえ]りました': ['came home', 'v', { df: '帰る', cf: 'polite past' }],
    '聞[き]きました': ['asked', 'v', { df: '聞く', cf: 'polite past' }],
    '何[なに]も': ['nothing, not anything (with a negative verb)', 'n'],
    '言[い]いませんでした': ['did not say', 'v', { df: '言う', cf: 'polite past negative' }],
    '顔[かお]': ['face', 'n'],
    'クリーム': ['cream', 'n'],
    'で#with': ['with — cause or material', 'part'],
    '真[ま]っ白[しろ]': ['pure white, all white', 'n'],
  }),
  body: [
    [
      line('こうた|の|家[いえ]|に|新[あたら]しい|ロボット|が|来[き]ました|。', 'A new robot came to Kota’s house.'),
      line('お母[かあ]さん|は|「|ロボット|、|ケーキ|を|見[み]てください|」|と|言[い]いました|。', 'Mum said, “Robot, please watch the cake.”'),
      line('それから|、|お母[かあ]さん|は|買[か]い物[もの]|に|行[い]きました|。', 'Then Mum went out to the shops.'),
    ],
    [
      line('ロボット|は|ケーキ|を|じっと|見[み]ました|。', 'The robot stared at the cake.'),
      line('こうた|は|いちご|を|一[ひと]つ|食[た]べました|。', 'Kota ate one strawberry.'),
      line('ロボット|は|ケーキ|を|見[み]ました|。', 'The robot watched the cake.'),
      line('こうた|は|ケーキ|を|全[ぜん]部[ぶ]|食[た]べました|。', 'Kota ate the whole cake.'),
      line('ロボット|は|ケーキ|を|とても|よく|見[み]ました|。', 'The robot watched the cake very carefully.'),
    ],
    [
      line('こうた|は|「|ロボット|、|内[ない]緒[しょ]|ね|」|と|言[い]いました|。', 'Kota said, “Robot, it’s a secret, OK?”'),
      line('ロボット|は|「|はい|、|内[ない]緒[しょ]|です|」|と|言[い]いました|。', 'The robot said, “Yes. It is a secret.”'),
    ],
    [
      line('お母[かあ]さん|が|帰[かえ]りました|。', 'Mum came home.'),
      line('お母[かあ]さん|は|「|ケーキ|は|？|」|と|聞[き]きました|。', '“Where’s the cake?” Mum asked.'),
      line('ロボット|は|何[なに]も|言[い]いませんでした|。', 'The robot said nothing at all.'),
      line('ロボット|は|こうた|を|じっと|見[み]ました|。', 'The robot stared at Kota.'),
      line('こうた|の|顔[かお]|は|クリーム|で#with|真[ま]っ白[しろ]|でした|。', 'Kota’s face was white with cream.'),
    ],
  ],
});

export const STORY_SOURCES = [theStory];
