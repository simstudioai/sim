/**
 * Sub-block types whose editor honours `SubBlockConfig.password` by concealing
 * the stored value until the field is focused.
 *
 * @remarks
 * `password` lives on the shared `SubBlockConfig` type, so it is assignable to
 * every sub-block type but only has an effect where a renderer reads it. Setting
 * it on a type outside this list is a silent no-op that leaves a secret in
 * plaintext, so a new usage must teach that renderer to mask rather than rely on
 * the flag alone. `apps/sim/blocks/password-masking.test.ts` enforces this.
 */
export const PASSWORD_MASKED_SUBBLOCK_TYPES = [
  'short-input',
  'long-input',
  'code',
  'table',
] as const

/** Glyph substituted for each concealed character. */
const MASK_CHARACTER = '•'

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
