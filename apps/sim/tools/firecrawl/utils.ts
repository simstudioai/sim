/**
 * Coerce a Firecrawl numeric request param that may not arrive as a number.
 *
 * These params are `user-or-llm`, so a model can emit `limit: "ten"` and a
 * block short-input always hands over a string. `"ten"` is truthy, `Number()`
 * turns it into `NaN`, and `JSON.stringify` writes `"limit": null` — which
 * Firecrawl's schema (`integer, minimum: 1`) rejects with a 400. Dropping the
 * param instead lets Firecrawl apply its own documented default, which is the
 * better failure.
 *
 * Returns `undefined` for an absent, empty, or non-finite value, preserving the
 * truthiness filter the request builders already applied.
 */
export function finiteNumber(value: unknown): number | undefined {
  if (!value) return undefined
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : undefined
}
