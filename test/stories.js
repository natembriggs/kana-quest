// Structural contract for every shipped story. Run from the repository root:
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/stories.js

import { STORIES } from '../src/data/story-manifest.js';
import { STORY as a1 } from '../src/data/story-ari-to-hato.js';
import { STORY as a2 } from '../src/data/story-kitakaze-to-taiyou.js';
import { STORY as a3 } from '../src/data/story-ookina-kabu.js';
import { STORY as a4 } from '../src/data/story-lion-to-nezumi.js';
import { STORY as a5 } from '../src/data/story-ari-to-kirigirisu.js';
import { STORY as a6 } from '../src/data/story-karasu-to-mizugame.js';
import { STORY as b1 } from '../src/data/story-momotaro-1.js';
import { STORY as b2 } from '../src/data/story-ookami-ga-kita.js';
import { STORY as b3 } from '../src/data/story-usagi-to-kame.js';
import { STORY as b4 } from '../src/data/story-machi-no-nezumi-inaka-no-nezumi.js';
import { STORY as b5 } from '../src/data/story-urashima-tarou.js';
import { STORY as b6 } from '../src/data/story-kasa-jizou.js';
import { STORY as c1 } from '../src/data/story-cinderella.js';
import { STORY as c2 } from '../src/data/story-goldilocks.js';
import { STORY as c3 } from '../src/data/story-sanbiki-no-kobuta.js';
import { STORY as c4 } from '../src/data/story-hansel-to-gretel.js';
import { STORY as c5 } from '../src/data/story-jack-to-mame-no-ki.js';
import { STORY as c6 } from '../src/data/story-rapunzel.js';
import { STORY as d1 } from '../src/data/story-akazukin.js';
import { STORY as d2 } from '../src/data/story-bremen-no-ongakutai.js';
import { STORY as d3 } from '../src/data/story-shirayukihime.js';
import { STORY as d4 } from '../src/data/story-bijoto-yajuu.js';
import { STORY as d5 } from '../src/data/story-ningyo-hime.js';
import { STORY as d6 } from '../src/data/story-ali-baba.js';
import { STORY as e1 } from '../src/data/story-aladdin-to-mahou-no-lamp.js';
import { STORY as e2 } from '../src/data/story-pinocchio.js';
import { STORY as e3 } from '../src/data/story-takarajima.js';
import { STORY as e4 } from '../src/data/story-hachijuu-nichikan-sekai-isshuu.js';
import { STORY as e5 } from '../src/data/story-robinson-crusoe.js';
import { STORY as e6 } from '../src/data/story-gulliver-ryokouki.js';
import { STORY as f1 } from '../src/data/story-frankenstein.js';
import { STORY as f2 } from '../src/data/story-fushigi-no-kuni-no-alice.js';
import { STORY as f3 } from '../src/data/story-oz-no-mahoutsukai.js';
import { STORY as f4 } from '../src/data/story-dracula.js';
import { STORY as f5 } from '../src/data/story-jekyll-to-hyde.js';
import { STORY as f6 } from '../src/data/story-madara-no-himo.js';

import { STORY as a7 } from '../src/data/story-neko-no-ie.js';
import { STORY as b7 } from '../src/data/story-futatsu-no-obentou.js';
import { STORY as c7 } from '../src/data/story-tabi-suru-kasa.js';
import { STORY as d7 } from '../src/data/story-saigo-no-watashibune.js';
import { STORY as d8 } from '../src/data/story-asagao-o-matsu-asa.js';
import { STORY as a8 } from '../src/data/story-kaze-to-boushi.js';
import { STORY as b8 } from '../src/data/story-tamago-no-otsukai.js';
import { STORY as c8 } from '../src/data/story-gofun-hayai-tokei.js';
import { STORY as e8 } from '../src/data/story-yojihan-no-pan.js';
import { STORY as f8 } from '../src/data/story-shio-no-michi.js';
import { STORY as e7 } from '../src/data/story-ichinichi-dake-no-honya.js';
import { STORY as f7 } from '../src/data/story-atesaki-no-nai-henji.js';
import { STORY as lantern1 } from '../src/data/story-kakure-tani-no-akari-1.js';
import { STORY as lantern2 } from '../src/data/story-kakure-tani-no-akari-2.js';
import { STORY as lantern3 } from '../src/data/story-kakure-tani-no-akari-3.js';
import { STORY as lantern4 } from '../src/data/story-kakure-tani-no-akari-4.js';
import { STORY as lantern5 } from '../src/data/story-kakure-tani-no-akari-5.js';
import { STORY as bell1 } from '../src/data/story-mittsu-no-kane-1.js';
import { STORY as bell2 } from '../src/data/story-mittsu-no-kane-2.js';
import { STORY as bell3 } from '../src/data/story-mittsu-no-kane-3.js';
import { STORY as bell4 } from '../src/data/story-mittsu-no-kane-4.js';
import { STORY as bell5 } from '../src/data/story-mittsu-no-kane-5.js';
import { STORY as lesson1 } from '../src/data/story-saigo-no-otehon-1.js';
import { STORY as lesson2 } from '../src/data/story-saigo-no-otehon-2.js';
import { STORY as lesson3 } from '../src/data/story-saigo-no-otehon-3.js';
import { STORY as lesson4 } from '../src/data/story-saigo-no-otehon-4.js';
import { STORY as lesson5 } from '../src/data/story-saigo-no-otehon-5.js';


const corpus = [
  a1, a2, a3, a4, a5, a6, a7, a8, b1, b2, b3, b4, b5, b6, b7, b8,
  c1, c2, c3, c4, c5, c6, c7, c8, d1, d2, d3, d4, d5, d6, d7, d8,
  e1, e2, e3, e4, e5, e6, e7, e8, lantern1, lantern2, lantern3, lantern4, lantern5,
  bell1, bell2, bell3, bell4, bell5, lesson1, lesson2, lesson3, lesson4, lesson5,
  f1, f2, f3, f4, f5, f6, f7, f8,
];
let failures = 0;
function check(name, condition, detail = '') {
  if (condition) return;
  failures += 1;
  print(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

// Compare ids, not a frozen count: every added story must join this suite.
check('manifest and corpus contain the same stories',
  JSON.stringify(Object.keys(STORIES).sort()) === JSON.stringify(corpus.map((story) => story.id).sort()));
for (let n = 1; n <= 6; n += 1) {
  check(`L${n} has stories`, corpus.some((story) => story.level === `L${n}`));
}

// A source author can opt out of a wrong homograph without losing the
// story-local definition or disabling useful links on neighbouring words.
const catStoryTokens = a7.body.flat().flatMap((sentence) => sentence.t);
check('家/いえ does not link to the curriculum 家/け', catStoryTokens
  .filter((token) => token.s === '家').every((token) => token.d === null && !!token.g));
check('猫 still links to its vocabulary entry', catStoryTokens
  .filter((token) => token.s === '猫').every((token) => token.d === '猫'));

corpus.forEach((story) => {
  check(`${story.id}: manifest entry`, !!STORIES[story.id]);
  check(`${story.id}: explicit writer credit`, !!story.source.by && !!story.source.credit);
  check(`${story.id}: manifest writer matches`, STORIES[story.id]?.source?.by === story.source.by);
  check(`${story.id}: manifest and story agree on cover availability`,
    STORIES[story.id]?.cover === story.art.cover);
  check(`${story.id}: installed covers have an artwork credit`,
    !story.art.cover || !!story.source.cover);
  const placements = new Set();
  for (const art of story.art.inline) {
    check(`${story.id}: illustration follows a unique existing paragraph`,
      Number.isInteger(art.after) && art.after >= 0 && art.after < story.body.length && !placements.has(art.after));
    placements.add(art.after);
    check(`${story.id}: one illustration format`, !!art.svg !== !!art.src);
    if (art.src) {
      check(`${story.id}: painted illustration has a versioned local URL`,
        art.src.startsWith(`assets/stories/${story.id}/`) && /\.webp\?v=[a-f0-9]{16}$/.test(art.src));
      check(`${story.id}: painted dimensions and credit`, art.width > 0 && art.height > 0 && !!story.source.illustrations);
    }
  }
  // Match the current writing guide: L1 none, L2 up to four distinct
  // words (including the title), and no minimum or maximum above L2.
  const katakana = new Set();
  function countKatakana(text) {
    (text.match(/[ァ-ヺ][ァ-ヺー・]*/g) || []).forEach((word) => katakana.add(word.replace(/・$/, '')));
  }
  countKatakana(story.title.ja);
  story.body.flat().forEach((sentence, sentenceIndex) => {
    check(`${story.id} sentence ${sentenceIndex + 1}: translation`, !!sentence.en?.trim());
    check(`${story.id} sentence ${sentenceIndex + 1}: tokens`, sentence.t.length > 0);
    const text = sentence.t.map((token) => token.s).join('');
    check(`${story.id} sentence ${sentenceIndex + 1}: closing punctuation`, /[。！？]$/.test(text));
    sentence.t.forEach((token, tokenIndex) => {
      const label = `${story.id} sentence ${sentenceIndex + 1} token ${tokenIndex + 1}`;
      check(`${label}: surface and reading`, !!token.s && !!token.k);
      check(`${label}: runtime link is an id or null`, token.d === null || typeof token.d === 'string');
      check(`${label}: contextual gloss`, token.pos === 'punct' ? token.g === null : !!token.g?.trim());
      check(`${label}: conjugation fields paired`, !!token.df === !!token.cf);
      const kanji = [...token.s].filter((character) => /[㐀-䶿一-鿿]/.test(character)).length;
      check(`${label}: every kanji has ruby`, kanji === (token.ruby || []).length);
      countKatakana(token.s);
    });
  });
  if (story.level === 'L1') check(`${story.id}: no L1 katakana`, katakana.size === 0);
  if (story.level === 'L2') check(`${story.id}: at most four L2 katakana words`, katakana.size <= 4);
});

if (failures) throw new Error(`${failures} story contract check(s) failed`);
print(`PASS  stories — ${corpus.length} stories, ${corpus.reduce((n, story) => n + story.body.flat().length, 0)} sentences`);
