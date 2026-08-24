/**
 * Prototype-safe record lookup (Task 9.1).
 *
 * Plain-object literal maps inherit keys like '__proto__', 'constructor' and
 * 'toString' from Object.prototype - indexing them returns inherited values that are
 * truthy, so naive `map[key] ?? fallback` patterns cannot be relied upon for
 * attacker-influenced strings (e.g. search parameters). This helper only accepts
 * own enumerable properties and otherwise returns the caller's fallback.
 *
 * Pure and deterministic.
 */
export function lookupRecordValue<T>(
  record: Record<string, T>,
  key: string | null | undefined,
  fallback: T
): T {
  if (typeof key === 'string' && key !== '' && Object.prototype.hasOwnProperty.call(record, key)) {
    return record[key];
  }

  return fallback;
}
