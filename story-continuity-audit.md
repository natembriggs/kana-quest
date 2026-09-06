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
| L1 | `ari-to-hato` | Moderate before revision | Thirteen isolated clauses sat in one paragraph. The hunter appeared without scene-setting, so the return of the favour felt attached rather than developed. Revised as described below. |
| L1 | `ookina-kabu` | Light | The repeated attempts form a clear chain. The helpers could be introduced with slightly more motivation, but the story is self-contained. |
| L1 | `kitakaze-to-taiyou` | Major before revision | The wind and sun never argued, set a challenge or stated what they were trying to prove. Revised as described below. |
| L1 | `lion-to-nezumi` | Moderate before revision | The rescue chain was clear, but the lion never responded to the mouse's return and the final moral changed suddenly from story action to a generic present-tense claim. Revised as described below. |
| L2 | `ookami-ga-kita` | Moderate before revision | The sequence was coherent. The safe ending, in which the boy saved every sheep himself, weakened the consequence that was meant to connect the lie to the lesson. Revised as described below. |
| L2 | `machi-no-nezumi-inaka-no-nezumi` | Light | Cause and contrast are clear. Dialogue tags and the town mouse's reaction to the final choice need a little more connective tissue. |
| L3 | `goldilocks` | Moderate before revision | The three tests were easy to follow but mechanical. The bears abruptly forgave Goldilocks, repaired the chair and shared a meal without enough emotional transition. Revised as described below. |
| L3 | `sanbiki-no-kobuta` | Light | The houses, danger and payoff are introduced in order. Only the reconciliation at the end is compressed. |
| L3 | `cinderella` | Moderate before revision | The main chain survived, but the magical helper appeared without context and the prince's search and Cinderella's new life were resolved as summary rather than scene. Revised as described below. |
| L3 | `hansel-to-gretel` | Major before revision | The father's reason for taking the children into the forest was unclear, the second abandonment was skipped, and several ending elements lacked setup. Revised as described below. |
| L4 | `akazukin` | Light | It is linear and self-contained. Frequent short subject–verb sentences make it sound staccato, especially in the escape, but few facts are actually missing. |
| L4 | `bremen-no-ongakutai` | Light | Goals and consequences connect well. The travellers hearing forest concerts is an unsupported late addition, and the final choice to stay could be made more explicit. |
| L4 | `shirayukihime` | Major before revision | The prince had no narrative role before the accidental awakening, the resolution was abrupt, and the final mirror moral was asserted rather than earned. Revised as described below. |
| L4 | `bijoto-yajuu` | Moderate before revision | The plot was mostly intelligible, but Belle and the Beast's friendship and love were compressed into statements. The sisters' delay and the curse explanation arrived mainly to trigger the ending. Revised as described below. |
| L5 | `aladdin-to-mahou-no-lamp` | Moderate before revision | Individual scenes connected better than most long retellings, but the courtship, palace condition, theft and final social reforms passed too quickly. Several sentences also needed a separate natural-Japanese pass. Revised as described below. |
| L5 | `pinocchio` | Moderate before revision | The episodic structure worked, but the letter about Geppetto, the whale encounter and the fairy's illness appeared as convenient plot triggers with little preparation. Revised as described below. |
| L5 | `takarajima` | Major before revision | The black spot, map, mutiny, Ben Gunn, loss of the fort and removal of the treasure lacked enough cause-and-effect explanation. Revised as described below. |
| L5 | `hachijuu-nichikan-sekai-isshuu` | Major before revision | Fix's interference, Passepartout's separation, Aouda's developing relationship with Fogg and several transport solutions lacked setup or consequence. Revised as described below. |
| L6 | `fushigi-no-kuni-no-alice` | Light | This succeeds because it adapts one continuous opening episode rather than the entire novel. Physical space, Alice's intentions and each object's effect remain visible from sentence to sentence. |
| L6 | `oz-no-mahoutsukai` | Light | This also succeeds by stopping after one coherent opening journey. New companions are introduced through complete miniature scenes with a problem, response and decision. |
| L6 | `frankenstein` | Major before revision | The framing works, but the middle assumes knowledge of the novel: the innocent person who is punished is unnamed, the creature's education and rejection are compressed, and Henry and Elizabeth become victims without adequate reintroduction. There is also a `語語` typo. Revised as described below. |
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
2. `frankenstein`, including the `語語` typo — completed.
3. `takarajima` — completed.
4. `hachijuu-nichikan-sekai-isshuu` — completed.
5. `hansel-to-gretel` — completed.
6. `shirayukihime` — completed.
7. `kitakaze-to-taiyou` — completed.

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

## Frankenstein implementation

The revised Frankenstein uses thirteen scene-based paragraphs and 125
sentences instead of six equal paragraphs and 60 sentences. It now:

- introduces Elizabeth and Henry during Victor's childhood, before either
  relationship becomes important to the ending;
- names William and Justine, explains Justine's place in the family, identifies
  the planted portrait locket, and shows why Victor remains silent during her
  trial;
- gives the creature a sustained learning arc through sensation, observation,
  Safie's language lessons, books and Victor's journal;
- connects the De Lacey family's rejection, the shooting after the river
  rescue, William's murder and the framing of Justine as successive causes and
  consequences;
- establishes the terms of the companion bargain and Victor's reasons for
  breaking it;
- keeps Henry present through the journey to Britain before revealing his body
  in Ireland;
- returns to Elizabeth's fears and Victor's mistaken reading of the
  wedding-night threat before her murder;
- makes the pursuit lead geographically and causally back to Walton's ship;
- connects Walton's decision to turn south to the fate he has just witnessed;
  and
- replaces the malformed `語語` token and corrects several other readings and
  word boundaries found during retokenisation.

It remains one standalone L6 story pending linked episode navigation. Its
natural episode boundaries are the creation and William's murder, the
creature's account, the broken companion bargain, and the final pursuit.

## Major-story implementations 3–7

The five remaining major stories were revised without changing their levels,
source credits or scope:

- `takarajima` now connects the black-spot deadline to Jim's escape, makes
  Trelawney's information leak the reason Silver can recruit Flint's former
  crew, states the mutineers' timing, establishes Ben Gunn's motive and boat,
  explains the choice and surrender of the stockade, and links the moved
  treasure to the otherwise useless map and final ambush. It has 73 sentences.
- `hachijuu-nichikan-sekai-isshuu` now establishes the limit on Fix's warrant,
  gives the temple intrusion a legal consequence, explains the incomplete
  railway and the Hong Kong separation, develops Aouda's reason to continue
  and her trust in Fogg, and motivates both the American rescue delay and the
  Henrietta's change of course. It has 74 sentences.
- `hansel-to-gretel` now shows the famine, the parents' disagreement and both
  abandonments. The witch remains the antagonist, the cage key and treasure
  are placed before use, and the children follow their father's axe home. The
  unexplained duck and surviving old-stone trail are gone. It has 40 sentences.
- `shirayukihime` introduces the prince during Snow White's life with the
  dwarfs and gives him a promise and purpose before his return. The huntsman
  and dwarfs provide evidence at the castle, and the mirror is turned away in
  a concrete closing action. It has 46 sentences.
- `kitakaze-to-taiyou` now begins with competing claims, defines the coat as
  the contest, marks each turn and ends with an acknowledged winner. It uses
  the L1 maximum of 15 sentences, with no sentence exceeding eight lookup
  units.

All five continue to satisfy their level sentence ranges and lookup-unit
ceilings. Their generated data passes the complete story contract test.

## Moderate-story implementations

The eight stories originally rated Moderate were revised without changing
their levels, source credits or selected story arcs:

- `ari-to-hato` now separates the accident, rescue and repayment into scenes,
  establishes the hunter before he aims at the dove, and has the ant recognise
  its rescuer before acting. It has 15 sentences.
- `lion-to-nezumi` now gives the lion a direct response to the mouse's rescue
  and closes on their changed relationship rather than switching to a generic
  moral. It has 14 sentences.
- `ookami-ga-kita` now gives the repeated lie a visible consequence: the
  scattered flock requires the villagers' help, the boy apologises, and trust
  returns only through later honest work. It has 25 sentences.
- `goldilocks` now motivates the food, chair and bed sequence through hunger
  and tiredness, lets Baby Bear react to the damage, and earns reconciliation
  through an apology and a shared repair. It has 38 sentences.
- `cinderella` now connects the fairy to Cinderella's mother, turns the
  slipper search into a scene with resistance from the stepfamily, and gives
  Cinderella an active choice about her future and education. It has 40
  sentences.
- `bijoto-yajuu` now develops friendship through reading, conversation and
  repeated dinners, establishes the Beast's curse before its resolution, and
  makes Belle's delayed return a choice with emotional consequences. It has
  54 sentences.
- `aladdin-to-mahou-no-lamp` now establishes Aladdin and the princess's first
  meeting, explains the king's palace condition and the servant's accidental
  exchange of the hidden lamp, and carries the couple's plans for public works
  through to concrete action. It has 89 sentences.
- `pinocchio` now gives Geppetto evidence and a reason to cross the sea,
  prepares both the whale encounter and Pinocchio's pursuit, and uses the blue
  bird's interrupted monthly visits to foreshadow the fairy's illness. It has
  98 sentences.

All eight remain within their level sentence ranges and all applicable
lookup-unit ceilings. Their generated data passes the complete story contract
test.

## Dracula implementation

The revised Dracula uses eleven scene-based paragraphs and 120 sentences
instead of six equal paragraphs and 60 sentences. It now:

- establishes Jonathan's reason for accepting the danger;
- establishes the village inn before its guests warn Jonathan about the Count;
- makes the mirror incident explicit about who acts, why Dracula reacts, and
  why that incident increases Jonathan's suspicions;
- places the locked exits and sheer drop before Jonathan concludes that he is
  a prisoner;
- gives the three coerced letters their contents and dates, then explains how
  they would conceal his disappearance and why 29 June becomes his deadline;
- connects the castle's earth boxes directly to the ship at Whitby;
- shows what Mina sees and why Lucy's decline becomes suspicious;
- introduces Arthur, Quincey and Renfield before their actions matter;
- explains the vampire's dependence on native earth and the hunters' plan;
- gives Mina an active role in assembling records and tracking Dracula;
- makes the attack, retreat, pursuit and final fight causally continuous; and
- corrects the origin of Mina's forehead mark and the method of Dracula's
  death.

It remains one standalone L6 story for now because linked episode navigation
is still Phase 9 work. The internal paragraph breaks therefore carry the scene
structure. Once serialization is implemented, the natural episode boundaries
are Jonathan at the castle, Dracula's arrival and Lucy's death, the London
hunt, and the pursuit back to Transylvania.
