import { describe, expect, it } from 'vitest';

import { detectRankChanges } from './rank-changes';

function ranked(id: string, rank: number) {
  return { id, rank };
}

describe('detectRankChanges', () => {
  it('marks every row as new when there is no previous ranking', () => {
    const changes = detectRankChanges(null, [ranked('a', 1), ranked('b', 2)]);

    expect(changes.get('a')).toBe('new');
    expect(changes.get('b')).toBe('new');
  });

  it('marks rows as same when ranks are unchanged', () => {
    const previous = [ranked('a', 1), ranked('b', 2)];
    const current = [ranked('a', 1), ranked('b', 2)];

    const changes = detectRankChanges(previous, current);

    expect(changes.get('a')).toBe('same');
    expect(changes.get('b')).toBe('same');
  });

  it('detects a row moving up', () => {
    const previous = [ranked('a', 1), ranked('b', 2)];
    const current = [ranked('b', 1), ranked('a', 2)];

    const changes = detectRankChanges(previous, current);

    expect(changes.get('b')).toBe('up');
    expect(changes.get('a')).toBe('down');
  });

  it('handles a mixed batch of up/down/same/new in one pass', () => {
    const previous = [
      ranked('leader', 1),
      ranked('riser', 3),
      ranked('faller', 2),
      ranked('stable', 4),
    ];
    const current = [
      ranked('riser', 1),
      ranked('leader', 2),
      ranked('newcomer', 3),
      ranked('stable', 4),
    ];

    const changes = detectRankChanges(previous, current);

    expect(changes.get('riser')).toBe('up');
    expect(changes.get('leader')).toBe('down');
    expect(changes.get('newcomer')).toBe('new');
    expect(changes.get('stable')).toBe('same');
    // faller dropped off the visible board entirely - nothing to animate.
    expect(changes.has('faller')).toBe(false);
  });

  it('returns an empty map for an empty current board', () => {
    const changes = detectRankChanges([ranked('a', 1)], []);

    expect(changes.size).toBe(0);
  });

  it('is independent of input array order (lookup by id)', () => {
    const changes = detectRankChanges(
      [ranked('a', 2), ranked('b', 1)],
      [ranked('b', 1), ranked('a', 2)]
    );

    expect(changes.get('b')).toBe('same');
    expect(changes.get('a')).toBe('same');
  });
});
