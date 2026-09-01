/**
 * The only bounds secret provenance is allowed to have.
 *
 * Provenance describes which configured secrets a value carries. Its information content is
 * therefore the size of the workspace's secret catalog — not the size of the thing described. A
 * bound on the envelope is legitimate; a bound on rows, cells, files, chunks, or attachments is
 * not, because exceeding it says nothing about the data and everything about our encoding.
 *
 * That distinction was not academic. The same two numbers were copied into seven modules under
 * fourteen names, and several of the copies had drifted into counting inputs rather than output: a
 * 25-column table insert lost provenance for every row past 400, a knowledge response gave up past
 * 100 rows, and a Function block that exported 21 files threw. Each looked local and defensible.
 *
 * So: bound the serialized envelope, and bound the distinct secrets it can name. Nothing else. A
 * new limit on how much work a provenance path will do is the signal that the path needs to fold
 * incrementally or page, not that it needs a number.
 */

/**
 * Ceiling on one serialized provenance envelope.
 *
 * Matches the platform's other single-payload ceilings (`LARGE_VALUE_THRESHOLD_BYTES`, the Redis
 * single-write bound) so a provenance envelope is never the first thing to fail on a payload the
 * rest of the system would carry.
 */
export const PROVENANCE_MAX_SERIALIZED_BYTES = 8 * 1024 * 1024

/**
 * Ceiling on the distinct secrets one envelope can name.
 *
 * Counts entries after they are folded by encrypted value, so it scales with a workspace's secret
 * catalog rather than with how many records mention those secrets. A page of a thousand rows
 * sharing eleven secrets carries eleven entries, not eleven thousand.
 */
export const PROVENANCE_MAX_ENTRIES = 10_000
