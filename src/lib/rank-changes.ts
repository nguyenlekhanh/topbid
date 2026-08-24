/**
 * Rank-change detection for the live leaderboard (Task 5.5).
 *
 * Pure and deterministic: given the previously rendered ranking and the current one,
 * returns per-bid movement used purely for visual animation. Ranking correctness always
 * comes from the authoritative query order - these labels never influence ordering.
 */
export type RankDirection = 'up' | 'down' | 'same' | 'new';

export type RankedRow = {
  id: string;
  rank: number;
};

export function detectRankChanges(
  previous: RankedRow[] | null | undefined,
  current: RankedRow[]
): Map<string, RankDirection> {
  const previousRanks = new Map<string, number>();

  for (const row of previous ?? []) {
    previousRanks.set(row.id, row.rank);
  }

  const changes = new Map<string, RankDirection>();

  for (const row of current) {
    const before = previousRanks.get(row.id);

    if (before === undefined) {
      changes.set(row.id, 'new');
    } else if (row.rank === before) {
      changes.set(row.id, 'same');
    } else if (row.rank < before) {
      // Lower rank number = higher position on the board.
      changes.set(row.id, 'up');
    } else {
      changes.set(row.id, 'down');
    }
  }

  return changes;
}
