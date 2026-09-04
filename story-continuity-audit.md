# Story continuity audit

Audit date: 5 September 2026

Scope: the 22 shipped stories credited to Sol 5.6 at the start of the audit.
`momotaro-1` and `usagi-to-kame`, credited to Claude Opus 5.0, were read for
comparison but are not rated here. Four unshipped story source files being
written concurrently were deliberately left out.

The ratings describe narrative continuity, not grammatical correctness:

- **Light** — the action chain is easy to follow; revise locally.
- **Moderate** — understandable, but noticeably choppy or under-motivated.
- **Major** — important identities, motives or causal steps are absent.
- **Critical** — the text is difficult to follow without already knowing the
  source story.

## Findings by story

| Level | Story | Rating | Main continuity problem |
| --- | --- | --- | --- |
| L1 | `ari-to-hato` | Moderate | Thirteen isolated clauses sit in one paragraph. The hunter appears without scene-setting, so the return of the favour feels attached rather than developed. |
| L1 | `ookina-kabu` | Light | The repeated attempts form a clear chain. The helpers could be introduced with slightly more motivation, but the story is self-contained. |
| L1 | `kitakaze-to-taiyou` | Major | The wind and sun never argue, set a challenge or state what they are trying to prove. A man simply appears and the actions begin, so there is no narrative question or resolution. |
| L1 | `lion-to-nezumi` | Moderate | The rescue chain is clear, but the lion never responds to the mouse's return and the final moral changes suddenly from story action to a generic present-tense claim. |
| L2 | `ookami-ga-kita` | Moderate | The sequence is coherent. The safe ending, in which the boy saves every sheep himself, weakens the consequence that is meant to connect the lie to the lesson. |
| L2 | `machi-no-nezumi-inaka-no-nezumi` | Light | Cause and contrast are clear. Dialogue tags and the town mouse's reaction to the final choice need a little more connective tissue. |
| L3 | `goldilocks` | Moderate | The three tests are easy to follow but mechanical. The bears abruptly forgive Goldilocks, repair the chair and share a meal without enough emotional transition. |
| L3 | `sanbiki-no-kobuta` | Light | The houses, danger and payoff are introduced in order. Only the reconciliation at the end is compressed. |
| L3 | `cinderella` | Moderate | The main chain survives, but the magical helper appears without context and the prince's search and Cinderella's new life are resolved as summary rather than scene. |
| L3 | `hansel-to-gretel` | Major | The father's reason for taking the children into the forest is unclear, the second abandonment is skipped over, the witch suddenly becomes an apologetic ordinary woman, and the duck, old stone trail and treasure arrive without setup. |
| L4 | `akazukin` | Light | It is linear and self-contained. Frequent short subject–verb sentences make it sound staccato, especially in the escape, but few facts are actually missing. |
| L4 | `bremen-no-ongakutai` | Light | Goals and consequences connect well. The travellers hearing forest concerts is an unsupported late addition, and the final choice to stay could be made more explicit. |
| L4 | `shirayukihime` | Major | It reads as a checklist of familiar incidents. The prince has no narrative role before the accidental awakening, the resolution is abrupt, and the final mirror moral is asserted rather than earned. |
| L4 | `bijoto-yajuu` | Moderate | The plot is mostly intelligible, but Belle and the Beast's friendship and love are compressed into statements. The sisters' delay and the curse explanation arrive mainly to trigger the ending. |
| L5 | `aladdin-to-mahou-no-lamp` | Moderate | Individual scenes connect better than most long retellings, but the courtship, palace condition, theft and final social reforms pass too quickly. Several sentences also need a separate natural-Japanese pass. |
| L5 | `pinocchio` | Moderate | The episodic structure works, but the letter about Geppetto, the whale encounter and the fairy's illness appear as convenient plot triggers with little preparation. |
| L5 | `takarajima` | Major | A complete novel is reduced to a sequence of outcomes. The black spot, map, mutiny, Ben Gunn, loss of the fort and removal of the treasure are not given enough cause-and-effect explanation for a new reader. |
| L5 | `hachijuu-nichikan-sekai-isshuu` | Major | The middle is a travel montage. Fix's interference, Passepartout's separations, Aouda's developing relationship with Fogg and several transport solutions are reported without enough setup or consequence. |
| L6 | `fushigi-no-kuni-no-alice` | Light | This succeeds because it adapts one continuous opening episode rather than the entire novel. Physical space, Alice's intentions and each object's effect remain visible from sentence to sentence. |
| L6 | `oz-no-mahoutsukai` | Light | This also succeeds by stopping after one coherent opening journey. New companions are introduced through complete miniature scenes with a problem, response and decision. |
| L6 | `frankenstein` | Major | The framing works, but the middle assumes knowledge of the novel: the innocent person who is punished is unnamed, the creature's education and rejection are compressed, and Henry and Elizabeth become victims without adequate reintroduction. There is also a `語語` typo. |
| L6 | `dracula` | Critical before revision | The ship was not explicitly connected to Dracula, Lucy's attacker was implicit, Quincey and Renfield appeared just before their payoffs, the hunters' method was unexplained, and the climax misstated how Dracula died. Revised as the worked example below. |

## Corpus-level diagnosis

The strongest predictor of continuity is not nominal reading level but scope.
The Alice and Oz texts cover one sustained episode and read coherently. The
weakest stories attempt to preserve the complete plot of a novel in roughly
the minimum permitted sentence count. This produces four recurring faults:

1. **Plot-point drafting.** Sentences record what happened but omit why a
   character acts, how information is learned, and what changed because of
   the action.
2. **Assumed source knowledge.** Famous characters and objects are treated as
   if the reader already knows their role. Names often arrive at the moment of
   payoff rather than at introduction.
3. **Even-sized paragraphing.** Several long stories divide sixty sentences
   into six blocks of ten. Those blocks do not consistently correspond to
   scenes, so changes of place, time and viewpoint are hidden inside them.
4. **Premature tokenisation.** Writing directly as glossed `line(...)` data
   encourages local correctness and makes it hard to hear the complete prose.

Short graded sentences are not themselves the problem. `ookina-kabu` is
simple but causal; the original Dracula was grammatically more advanced but
contextually incomplete.

## Repair plan

### 1. Fix critical and major stories first

Recommended order:

1. `dracula` — completed as the worked example.
2. `frankenstein`, including the `語語` typo.
3. `takarajima`.
4. `hachijuu-nichikan-sekai-isshuu`.
5. `hansel-to-gretel`.
6. `shirayukihime`.
7. `kitakaze-to-taiyou`.

Then revise the moderate stories and finish with local smoothing of the light
group. This order addresses the texts most likely to lose a reader before
spending time polishing stories whose narrative already works.

### 2. Reduce scope before adding sentences

For each major long adaptation, decide whether the whole novel is genuinely
needed. Prefer one complete episode or a small number of connected scenes. If
the full arc is essential, use the available L5/L6 length rather than treating
the sixty-sentence minimum as a target.

### 3. Make a scene map

For every scene record its place/time, viewpoint, immediate goal, obstacle,
change and consequence. Also keep a cast/object ledger so every later payoff
has an earlier introduction. Do this before writing Japanese.

### 4. Draft and review un-tokenized prose

Write ordinary Japanese paragraphs first. Run a continuity review with no
gloss data visible. A reviewer unfamiliar with the source should be able to
explain what happened, why each character acted, and how the group learned
what it knows. Only then split the prose into tappable tokens and add readings,
glosses and translations.

### 5. Use two human review passes

- **Story pass:** continuity, motivation, time/place, referents, setup/payoff
  and fidelity to the selected source arc.
- **Japanese pass:** natural phrasing, collocation, register, readings,
  token boundaries and English alignment.

The same native speaker can perform both, but not in one pass. Correct
sentences otherwise distract from missing narrative logic.

### 6. Keep automated checks in their proper role

The existing build checks remain valuable for structure. They cannot certify
coherence. Sentence count should stay a range and never become the drafting
target. The manual continuity checklist now lives in `story-writing-guide.md`.

## Dracula implementation

The revised Dracula uses ten scene-based paragraphs and 112 sentences instead
of six equal paragraphs and 60 sentences. It now:

- establishes Jonathan's reason for accepting the danger;
- connects the castle's earth boxes directly to the ship at Whitby;
- shows what Mina sees and why Lucy's decline becomes suspicious;
- introduces Arthur, Quincey and Renfield before their actions matter;
- explains the vampire's dependence on native earth and the hunters' plan;
- gives Mina an active role in assembling records and tracking Dracula;
- makes the attack, retreat, pursuit and final fight causally continuous; and
- corrects the origin of Mina's forehead mark and the method of Dracula's
  death.

