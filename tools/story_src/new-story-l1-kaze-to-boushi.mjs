import { expandStory, lexicon, line } from './helpers.mjs';

// Scene map and prose-first draft: see this story in new-stories-2026-09-18.md.
const theStory = expandStory({
  id: 'kaze-to-boushi',
  title: { ja: '風と帽子', en: 'The Wind and the Hat' },
  level: 'L1',
  gram: 'G1',
  blurb: 'The wind blows Taro’s red hat into a tall tree, and a passing big girl is exactly the right height to help.',
  nw: ['風', '帽子', '木', '背が高い', '取る', 'かぶる'],
  series: null,
  source: {
    kind: 'original',
    text: 'An original story written for Kanji Trail',
    by: 'Claude Fable 5.1',
    credit: 'Written by',
    notes: 'Original Japanese prose and English translations written for this reading level. No published text was adapted.',
    licence: 'Original to Kanji Trail; Japanese text and English translations may be used and adapted with the app.',
  },
  lexicon: lexicon({
    'たろう': ['Taro', 'pn'],
    '今[きょ]日[う]': ['today', 'n'],
    '風[かぜ]': ['wind', 'n'],
    '強[つよ]い': ['strong', 'adj'],
    'です': ['is', 'aux', { df: 'だ', cf: 'polite present/future' }],
    '公[こう]園[えん]': ['park', 'n'],
    '行[い]きます': ['goes', 'v', { df: '行く', cf: 'polite present/future' }],
    '帽[ぼう]子[し]': ['hat', 'n'],
    '赤[あか]い': ['red', 'adj'],
    '飛[と]びます': ['flies away', 'v', { df: '飛ぶ', cf: 'polite present/future' }],
    '木[き]': ['tree', 'n'],
    '上[うえ]': ['top; up in', 'n'],
    '高[たか]い': ['tall', 'adj'],
    '小[ちい]さい': ['small', 'adj'],
    '困[こま]ります': ['is stuck; does not know what to do', 'v', { df: '困る', cf: 'polite present/future' }],
    'お姉[ねえ]さん': ['a big girl; an older girl', 'n'],
    '来[き]ます': ['comes', 'v', { df: '来る', cf: 'polite present/future' }],
    '背[せ]が高[たか]い': ['tall (of a person)', 'adj'],
    '取[と]ります': ['gets (it) down; takes', 'v', { df: '取る', cf: 'polite present/future' }],
    'ありがとう': ['thank you', 'n'],
    '言[い]います': ['says', 'v', { df: '言う', cf: 'polite present/future' }],
    'かぶります': ['puts on (a hat)', 'v', { df: 'かぶる', cf: 'polite present/future' }],
    'まだ': ['still', 'adv'],
    '手[て]': ['hand', 'n'],
    '持[も]ちます': ['holds', 'v', { df: '持つ', cf: 'polite present/future' }],
  }),
  body: [
    [
      line('今[きょ]日[う]|は|風[かぜ]|が|強[つよ]い|です|。', 'Today the wind is strong.'),
      line('たろう|は|公[こう]園[えん]|へ|行[い]きます|。', 'Taro goes to the park.'),
      line('たろう|の|帽[ぼう]子[し]|は|赤[あか]い|です|。', 'Taro’s hat is red.'),
      line('風[かぜ]|で|帽[ぼう]子[し]|が|飛[と]びます|。', 'The wind blows the hat away.'),
      line('帽[ぼう]子[し]|は|木[き]|の|上[うえ]|です|。', 'The hat is up in a tree.'),
    ],
    [
      line('木[き]|は|高[たか]い|です|。', 'The tree is tall.'),
      line('たろう|は|小[ちい]さい|です|。', 'Taro is small.'),
      line('たろう|は|困[こま]ります|。', 'Taro does not know what to do.'),
    ],
    [
      line('お姉[ねえ]さん|が|来[き]ます|。', 'A big girl comes along.'),
      line('お姉[ねえ]さん|は|背[せ]が高[たか]い|です|。', 'The big girl is tall.'),
      line('お姉[ねえ]さん|は|帽[ぼう]子[し]|を|取[と]ります|。', 'The big girl gets the hat down.'),
      line('たろう|は|「|ありがとう|」|と|言[い]います|。', 'Taro says, “Thank you.”'),
    ],
    [
      line('たろう|は|帽[ぼう]子[し]|を|かぶります|。', 'Taro puts the hat on.'),
      line('風[かぜ]|は|まだ|強[つよ]い|です|。', 'The wind is still strong.'),
      line('たろう|は|帽[ぼう]子[し]|を|手[て]|で|持[も]ちます|。', 'Taro holds the hat on with his hand.'),
    ],
  ],
});

export const STORY_SOURCES = [theStory];
