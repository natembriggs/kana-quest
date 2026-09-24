import { expandStory, lexicon, line } from './helpers.mjs';

// Scene map and prose-first draft: see this story in new-stories-2026-09-16.md.
const theStory = expandStory({
  id: "neko-no-ie",
  title: {"ja": "猫の家", "en": "A House for the Cat"},
  level: "L1",
  gram: "G1",
  blurb: "Hana makes a big new house for her cat, but the cat has its own idea of a good home.",
  nw: ["家", "猫", "箱", "中", "入る", "入れる", "犬", "人形"],
  series: null,
  source: {"kind": "original", "text": "An original story written for Kanji Trail", "by": "GPT-6 Astra", "credit": "Written by", "notes": "Original Japanese prose and English translations written for this reading level. No published text was adapted.", "licence": "Original to Kanji Trail; Japanese text and English translations may be used and adapted with the app.", "illustrations": "Inline SVG illustrations drawn by GPT-6 Astra for Kanji Trail, using the cover as a character and palette reference."},
  // Scene openings only: the familiar small box, then an inspection of the
  // new house. Leave the cat's choice and the toy-dog ending to the prose.
  art: { inline: [{ after: 0, file: '01.svg' }, { after: 1, file: '02.svg' }] },
  lexicon: lexicon({
    "はな": ["Hana", "pn"],
    "家[いえ]": ["house; home", "n"],
    "猫[ねこ]": ["cat", "n"],
    "います": ["is here", "v", {"df": "いる", "cf": "polite present/future"}],
    "小[ちい]さい": ["small", "adj"],
    "箱[はこ]": ["box", "n"],
    "中[なか]": ["inside", "n"],
    "です": ["is", "aux", {"df": "だ", "cf": "polite present/future"}],
    "大[おお]きい": ["big", "adj"],
    "持[も]って来[き]ます": ["brings", "v", {"df": "持って来る", "cf": "polite present/future"}],
    "作[つく]ります": ["makes", "v", {"df": "作る", "cf": "polite present/future"}],
    "新[あたら]しい": ["new", "adj"],
    "とても": ["very", "adv"],
    "見[み]ます": ["looks at", "v", {"df": "見る", "cf": "polite present/future"}],
    "でも": ["but", "adv"],
    "入[はい]ります": ["goes into", "v", {"df": "入る", "cf": "polite present/future"}],
    "寝[ね]ます": ["sleeps", "v", {"df": "寝る", "cf": "polite present/future"}],
    "犬[いぬ]": ["dog", "n"],
    "人[にん]形[ぎょう]": ["toy figure; doll", "n"],
    "入[い]れます": ["puts into", "v", {"df": "入れる", "cf": "polite present/future"}],
  }),
  body: [
    [
      line("はな|の|家[いえ]|に|猫[ねこ]|が|います|。", "There is a cat in Hana’s house."),
      line("猫[ねこ]|は|小[ちい]さい|箱[はこ]|の|中[なか]|に|います|。", "The cat is in a small box."),
      line("箱[はこ]|は|猫[ねこ]|の|家[いえ]|です|。", "The box is the cat’s house."),
      line("はな|は|大[おお]きい|箱[はこ]|を|持[も]って来[き]ます|。", "Hana brings a big box."),
    ],
    [
      line("はな|は|箱[はこ]|で|家[いえ]|を|作[つく]ります|。", "Hana makes a house out of the box."),
      line("新[あたら]しい|家[いえ]|は|とても|大[おお]きい|です|。", "The new house is very big."),
      line("猫[ねこ]|は|新[あたら]しい|家[いえ]|を|見[み]ます|。", "The cat looks at the new house."),
      line("でも|、|猫[ねこ]|は|小[ちい]さい|箱[はこ]|に|入[はい]ります|。", "But the cat goes into the small box."),
      line("猫[ねこ]|は|箱[はこ]|の|中[なか]|で|寝[ね]ます|。", "The cat sleeps inside the box."),
    ],
    [
      line("はな|は|犬[いぬ]|の|人[にん]形[ぎょう]|を|持[も]って来[き]ます|。", "Hana brings a toy dog."),
      line("はな|は|犬[いぬ]|の|人[にん]形[ぎょう]|を|新[あたら]しい|家[いえ]|に|入[い]れます|。", "Hana puts the toy dog in the new house."),
      line("猫[ねこ]|の|家[いえ]|は|小[ちい]さい|です|。", "The cat’s house is small."),
      line("犬[いぬ]|の|家[いえ]|は|大[おお]きい|です|。", "The dog’s house is big."),
    ],
  ],
});

export const STORY_SOURCES = [theStory];
