/** Glyph substituted for each concealed character. */
const MASK_CHARACTER = '•'

/** Inputs to the single reveal policy shared by every masking renderer. */
interface SecretMaskDecision {
  /** Whether `SubBlockConfig.password` is set on the field being rendered. */
  password?: boolean
  /** Whether the field — or, for a table, the individual cell — currently holds focus. */
  isFocused: boolean
}

/**
 * The one place that decides whether a `password`-flagged value is concealed.
 *
 * @remarks
 * Focus is the only reveal gesture. Putting the caret in the field is a
 * deliberate act by the person who owns the screen, and it is required anyway to
 * edit the value, so it costs nothing and reveals nothing the user did not ask
 * for.
 *
 * An active workflow-search match deliberately does **not** reveal. The search
 * index is built client-side from values the browser already holds, so
 * unmasking on a match leaks no privilege the caller lacks — but masking never
 * defended against the authenticated user. It defends against incidental
 * display: screenshares, recordings, and onlookers. Workflow search keeps focus
 * in its own input while merely scrolling the matched field into view, so a
 * search-driven reveal paints a private key somewhere the user is not even
 * looking, triggered by keystrokes typed into an unrelated box. That is exactly
 * the exposure the flag exists to prevent, and a guessable query makes it
 * repeatable. Navigation still works: the match scrolls into view masked, and
 * one click reveals it.
 *
 * Every masking renderer derives its decision from this function rather than
 * re-deriving a predicate, so the renderers cannot drift apart.
 *
 * @param decision - The field's password flag and current focus state
 * @returns Whether the value must be replaced with mask glyphs
 */
export function shouldMaskSecretValue({ password, isFocused }: SecretMaskDecision): boolean {
  return Boolean(password) && !isFocused
}

/**
 * Conceals every character of a secret behind {@link MASK_CHARACTER}, leaving
 * line breaks intact so a masked multi-line value keeps the shape — and the
 * line count, gutter, and scroll extent — of the value it replaces.
 *
 * @param value - The plaintext value to conceal
 * @returns The value with every non-newline character replaced
 */
export function maskSecretText(value: string): string {
  return value.replace(/[^\n]/g, MASK_CHARACTER)
}
