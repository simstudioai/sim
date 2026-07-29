/**
 * Bounds and defaults for local-filesystem tool calls.
 *
 * These are a wire agreement, not a preference. The main process authorizes a
 * request by RESOLVING the model's tool args itself and comparing the result
 * to the request for exact equality — so if the renderer and the shell
 * disagree about what an omitted `maxResults` means, a legitimate call is
 * silently DENIED rather than failing loudly. Three copies of this table
 * existed and two had already drifted on the read limit.
 *
 * Only the values the authorizer compares live here. Caps that each side
 * applies to its own output (glob result limits, scan budgets) are genuinely
 * independent and stay local — hoisting them would assert a coupling that does
 * not exist.
 *
 * Changing a value here is a shell-compatibility change. Each side compiles
 * its own copy, so a continuously-deployed web app carrying a new default
 * still faces installed shells authorizing against the old one. Treat an edit
 * the way you would a bridge signature change: additive, or floored by
 * `MIN_DESKTOP_VERSION`.
 */

/** Ceiling on an explicit `read` limit, and the value used when it is absent. */
export const MAX_READ_LINES = 2_000
export const DEFAULT_READ_LINES = MAX_READ_LINES

/** Ceiling on an explicit `grep` maxResults, and the value used when absent. */
export const MAX_GREP_RESULTS = 200
export const DEFAULT_GREP_RESULTS = 50

/** Ceiling on explicit `grep` context lines, and the value used when absent. */
export const MAX_GREP_CONTEXT = 20
export const DEFAULT_GREP_CONTEXT = 0
