// The first two stories predate the repeatable story builder. Their original
// compact authoring files were not committed, so their already hand-checked
// token arrays remain the source of truth while the new attribution fields
// are added here. The builder still revalidates every token and link.

import { STORY as MOMOTARO } from '../../src/data/story-momotaro-1.js';
import { STORY as USAGI } from '../../src/data/story-usagi-to-kame.js';

function credit(story) {
  const note = story.source.notes.replace(/ Retelling and English translation by Claude Opus 5\.0\.$/, '');
  return {
    ...story,
    source: {
      ...story.source,
      by: 'Claude Opus 5.0',
      credit: 'Retold by',
      notes: `${note} Retelling and English translation by Claude Opus 5.0.`,
    },
  };
}

export const STORY_SOURCES = [credit(MOMOTARO), credit(USAGI)];
