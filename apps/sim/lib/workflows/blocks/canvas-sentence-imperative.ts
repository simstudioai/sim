/**
 * The imperative form of the verb a card sentence leads with.
 *
 * Card sentences read as commands — `Send ⟨a subject⟩ to ⟨a recipient⟩` — so the
 * leading verb is the plain base form, matching the operation title the card
 * heading already shows (`Send Email`). Third person (`Sends …`) describes the
 * block to a reader; the imperative names the action, which is what a card is.
 *
 * This is one function used two ways: it rewrote the fleet, and the CI check
 * calls it on every declared sentence to keep a new one from drifting back —
 * a lead is imperative exactly when rewriting it changes nothing.
 */

/**
 * Adverbs and qualifiers a sentence may open with, ahead of its verb.
 *
 * Only these license looking past the first word. Scanning further would find
 * the plural noun in an already-imperative lead and "correct" it — `Set labels`
 * would become `Set label`.
 */
const LEADING_MODIFIERS = new Set(['permanently', 'bulk', 'batch', 'full-text'])

/**
 * Suffixes where third-person `-es` attaches to a base that does not end in `e`.
 *
 * `-zes` is deliberately absent: it is almost always a base already ending in
 * `e` (`Analyzes` → `Analyze`, `Summarizes` → `Summarize`), and only the
 * doubled `-zzes` takes the `-es` ending.
 */
const ES_SUFFIXES = ['sses', 'shes', 'ches', 'xes', 'zzes', 'oes']

/**
 * Whether a word is a third-person singular verb form.
 *
 * The `-ss`/`-us` exclusion is what keeps a base form that already ends in `s`
 * from being "corrected" into a non-word: `Process` and `Focus` are imperatives,
 * and no third-person form ends either way — that would need a base ending in
 * `s` or `u`.
 */
function isThirdPersonSingular(word: string): boolean {
  const lower = word.toLowerCase()
  if (!lower.endsWith('s')) return false
  return !lower.endsWith('ss') && !lower.endsWith('us')
}

/** The base form of a third-person singular verb, or the word unchanged. */
function toImperative(verb: string): string {
  if (!isThirdPersonSingular(verb)) return verb
  const lower = verb.toLowerCase()
  /* `-ies` reverts to `-y` only past the three-letter stems (`ties`, `dies`),
     where the `e` belongs to the base rather than the inflection. */
  if (lower.endsWith('ies') && lower.length > 4) return `${verb.slice(0, -3)}y`
  if (ES_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return verb.slice(0, -2)
  return verb.slice(0, -1)
}

/**
 * A sentence's leading copy with its verb in the imperative.
 *
 * Returns the fragment unchanged when it already leads with one, which is what
 * makes this usable as the check: `toImperativeLead(copy) === copy`.
 */
export function toImperativeLead(text: string): string {
  const parts = text.split(/(\s+)/)
  for (let i = 0; i < parts.length && i <= 2; i += 2) {
    const word = parts[i]
    if (!word) break
    if (isThirdPersonSingular(word)) {
      parts[i] = toImperative(word)
      return parts.join('')
    }
    if (!LEADING_MODIFIERS.has(word.toLowerCase())) break
  }
  return text
}
