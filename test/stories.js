// Structural contract for every shipped story. Run from the repository root:
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/stories.js

import { STORIES } from '../src/data/story-manifest.js';
import { STORY as a1 } from '../src/data/story-ari-to-hato.js';
import { STORY as a2 } from '../src/data/story-kitakaze-to-taiyou.js';
import { STORY as a3 } from '../src/data/story-ookina-kabu.js';
import { STORY as a4 } from '../src/data/story-lion-to-nezumi.js';
import { STORY as a5 } from '../src/data/story-ari-to-kirigirisu.js';
import { STORY as b1 } from '../src/data/story-momotaro-1.js';
import { STORY as b2 } from '../src/data/story-ookami-ga-kita.js';
import { STORY as b3 } from '../src/data/story-usagi-to-kame.js';
import { STORY as b4 } from '../src/data/story-machi-no-nezumi-inaka-no-nezumi.js';
import { STORY as b5 } from '../src/data/story-urashima-tarou.js';
import { STORY as c1 } from '../src/data/story-cinderella.js';
import { STORY as c2 } from '../src/data/story-goldilocks.js';
import { STORY as c3 } from '../src/data/story-sanbiki-no-kobuta.js';
import { STORY as c4 } from '../src/data/story-hansel-to-gretel.js';
import { STORY as c5 } from '../src/data/story-jack-to-mame-no-ki.js';
import { STORY as d1 } from '../src/data/story-akazukin.js';
import { STORY as d2 } from '../src/data/story-bremen-no-ongakutai.js';
import { STORY as d3 } from '../src/data/story-shirayukihime.js';
import { STORY as d4 } from '../src/data/story-bijoto-yajuu.js';
import { STORY as d5 } from '../src/data/story-ningyo-hime.js';
import { STORY as e1 } from '../src/data/story-aladdin-to-mahou-no-lamp.js';
import { STORY as e2 } from '../src/data/story-pinocchio.js';
import { STORY as e3 } from '../src/data/story-takarajima.js';
import { STORY as e4 } from '../src/data/story-hachijuu-nichikan-sekai-isshuu.js';
import { STORY as e5 } from '../src/data/story-robinson-crusoe.js';
import { STORY as f1 } from '../src/data/story-frankenstein.js';
import { STORY as f2 } from '../src/data/story-fushigi-no-kuni-no-alice.js';
import { STORY as f3 } from '../src/data/story-oz-no-mahoutsukai.js';
import { STORY as f4 } from '../src/data/story-dracula.js';
import { STORY as f5 } from '../src/data/story-jekyll-to-hyde.js';

const corpus = [
  a1, a2, a3, a4, a5, b1, b2, b3, b4, b5, c1, c2, c3, c4, c5,
  d1, d2, d3, d4, d5, e1, e2, e3, e4, e5, f1, f2, f3, f4, f5,
];
let failures = 0;
function check(name, condition, detail = '') {
  if (condition) return;
  failures += 1;
  print(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

check('manifest and corpus both contain 30 stories', Object.keys(STORIES).length === 30 && corpus.length === 30);
for (let n = 1; n <= 6; n += 1) {
  check(`L${n} has five stories`, corpus.filter((story) => story.level === `L${n}`).length === 5);
}

corpus.forEach((story) => {
  check(`${story.id}: manifest entry`, !!STORIES[story.id]);
  check(`${story.id}: explicit writer credit`, !!story.source.by && !!story.source.credit);
  check(`${story.id}: manifest writer matches`, STORIES[story.id]?.source?.by === story.source.by);
  let katakana = 0;
  story.body.flat().forEach((sentence, sentenceIndex) => {
    check(`${story.id} sentence ${sentenceIndex + 1}: translation`, !!sentence.en?.trim());
    check(`${story.id} sentence ${sentenceIndex + 1}: tokens`, sentence.t.length > 0);
    const text = sentence.t.map((token) => token.s).join('');
    check(`${story.id} sentence ${sentenceIndex + 1}: closing punctuation`, /[。！？]$/.test(text));
    sentence.t.forEach((token, tokenIndex) => {
      const label = `${story.id} sentence ${sentenceIndex + 1} token ${tokenIndex + 1}`;
      check(`${label}: surface and reading`, !!token.s && !!token.k);
      check(`${label}: contextual gloss`, token.pos === 'punct' ? token.g === null : !!token.g?.trim());
      check(`${label}: conjugation fields paired`, !!token.df === !!token.cf);
      const kanji = [...token.s].filter((character) => /[㐀-䶿一-鿿]/.test(character)).length;
      check(`${label}: every kanji has ruby`, kanji === (token.ruby || []).length);
      katakana += [...token.s].filter((character) => /[ァ-ヺ]/.test(character)).length;
    });
  });
  if (story.level === 'L1' || story.level === 'L2') check(`${story.id}: no early-level katakana`, katakana === 0);
  else check(`${story.id}: substantial katakana practice`, katakana >= 12, `${katakana} characters`);
});

if (failures) throw new Error(`${failures} story contract check(s) failed`);
print(`PASS  stories — ${corpus.length} stories, ${corpus.reduce((n, story) => n + story.body.flat().length, 0)} sentences`);
