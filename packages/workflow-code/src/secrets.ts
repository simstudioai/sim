/**
 * Secrets in password fields. The printer never writes a password field's literal text into
 * source (it prints `stored()`), and print and compile both flag such a value with
 * `W_LITERAL_SECRET`, since a key written into the workflow travels with every copy of it where
 * an env reference would not.
 */
import { findWorkflowReferenceTokens } from '@sim/utils/workflow-references'
import type { Value } from './model'

/**
 * A value in a password field that holds literal text: anything but `null`, `''` or text made
 * only of reference and `{{ENV}}` tokens.
 */
export function isLiteralSecret(value: Value): boolean {
  if (value === null || value === '') return false
  if (typeof value !== 'string') return true
  let rest = value
  for (const token of findWorkflowReferenceTokens(value).reverse()) {
    rest = rest.slice(0, token.start) + rest.slice(token.end)
  }
  return rest.trim() !== ''
}

/** The message and hint of `W_LITERAL_SECRET` for the param written as `name`. */
export function literalSecretFinding(name: string): { message: string; hint: string } {
  return {
    message: `${name} holds a literal secret; use env.NAME.`,
    hint: `Store the secret as a workspace or personal env variable and write ${name}: env.NAME, so the key never sits in the workflow.`,
  }
}
