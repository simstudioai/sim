/**
 * Secret declarations: `secrets.ts` at the root of a workspace source directory names the
 * workspace secrets its workflows read, by name and what each is for. Never a value: set one with
 * `sim secrets set <NAME> --scope workspace`, or in the workspace's secrets settings.
 *
 * ```ts
 * // @sim-sdk 1
 * import { defineSecrets } from '@sim/workflow-sdk/workspace'
 *
 * export default defineSecrets({
 *   ANTHROPIC_API_KEY: { description: 'Model access for the support agent' },
 *   STRIPE_KEY: {},
 * })
 * ```
 *
 * A workflow reads one as `env.NAME`, which type-checks against these names. An apply sets only
 * descriptions: a name the workspace holds no value for is reported, and a workflow using it is
 * held back (not written) while the rest of the apply goes ahead. Removing a name changes nothing
 * on the server.
 */

/** One declared secret. */
export interface SecretDeclaration {
  /** What the secret is for, shown to teammates (at most 500 characters). */
  description?: string
}

/** Declares the workspace's secrets by name. Its default export is the whole file. */
export declare function defineSecrets<const T extends Record<string, SecretDeclaration>>(
  secrets: T
): T

/** The env names a `secrets.ts` declaration adds, as `workspace.d.ts` merges them into `env`. */
export type DeclaredSecretNames<T> = { [K in keyof T]: true }
