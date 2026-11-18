/**
 * Credential declarations: `credentials.ts` at the root of a workspace source directory names the
 * saved credentials its workflows use, each by the provider it is for. Never a token: connect one
 * with `sim credentials connect <provider> --name "<display name>"`.
 *
 * ```ts
 * // @sim-sdk 1
 * import { defineCredentials } from '@sim/workflow-sdk/workspace'
 *
 * export default defineCredentials({
 *   slack: { provider: 'slack' },
 *   gmail: { provider: 'google-email', name: 'Support inbox' },
 * })
 * ```
 *
 * A workflow uses one as `credential('slack')`, which type-checks against these keys. An apply
 * binds each key to a credential of this workspace: the one bound to it already; else the only
 * credential of the provider no other declared key holds, narrowed to the display name `name`
 * when given. A key nothing binds to, or several credentials could bind to, is reported, and a
 * workflow using it is held back while the rest of the apply goes ahead. Applying the same
 * directory to another workspace binds each key to that workspace's own credential. Removing a key
 * unbinds it only with `--allow-delete`; the credential itself is never deleted.
 */

/** One declared credential. */
export interface CredentialDeclaration {
  /** The provider the credential is for (`slack`, `google-email`, …). */
  provider: string
  /** The display name that picks one of several credentials of the provider. */
  name?: string
}

/** Declares the workspace's credentials by key. Its default export is the whole file. */
export declare function defineCredentials<const T extends Record<string, CredentialDeclaration>>(
  credentials: T
): T

/**
 * The credential keys a `credentials.ts` declaration adds, each with its provider, as
 * `workspace.d.ts` merges them into `credential('…')`.
 */
export type DeclaredCredentials<T> = {
  [K in keyof T]: T[K] extends { provider: infer P } ? { provider: P } : never
}
