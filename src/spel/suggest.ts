/** "Did you mean …?" helper based on edit distance. */

function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i++) {
    const current = [i];
    for (let j = 1; j < cols; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost));
    }
    previous = current;
  }
  return previous[cols - 1] ?? 0;
}

export function suggest(name: string, candidates: readonly string[]): string | undefined {
  const lower = name.toLowerCase();
  const caseOnly = candidates.find((candidate) => candidate.toLowerCase() === lower);
  if (caseOnly) return caseOnly;
  const maxDistance = Math.max(1, Math.floor(name.length / 3));
  const ranked = candidates
    .map((candidate) => ({ candidate, distance: editDistance(lower, candidate.toLowerCase()) }))
    .filter((entry) => entry.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance);
  return ranked[0]?.candidate;
}
