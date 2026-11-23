/**
 * Credentials: `credentials.ts` names the saved credentials workflows use (`credential('<key>')`)
 * by the provider each is for, never a token. An apply binds each key to this workspace's
 * credential: the one the key is bound to already, else the only credential of that provider no
 * other declared key holds (narrowed to the display name `name` when given). A key nothing binds
 * to, or that several credentials could bind to, is reported, and a workflow using it is held back
 * while the rest of the apply goes ahead. Copying the directory to another workspace binds each key
 * to that workspace's own credential.
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
 */

import type { ResourceFingerprint } from '../base'
import { type DeclFields, stringField } from '../declaration/field-table'
import type { KindCodec } from '../kind'
import { isResourceKey } from '../layout'
import { entryCodec, entryFingerprint } from './entries'

/** One credential as `credentials.ts` declares it. */
export interface CredentialDecl {
  /** The provider the credential is for (`slack`, `google-email`). */
  provider: string
  /** The display name that picks one of several credentials of the provider. */
  name?: string
}

/** Every credential `credentials.ts` declares, by key. */
export type CredentialsDecl = Record<string, CredentialDecl>

/** A credential's fields; an undeclared `name` fingerprints as none. */
const CREDENTIAL_FIELDS: DeclFields<CredentialDecl> = {
  provider: stringField({ required: true }),
  name: stringField({}, (name) => name ?? null),
}

/** Reads and prints `credentials.ts`. */
export const credentialCodec: KindCodec<CredentialsDecl> = entryCodec<CredentialDecl>({
  kind: 'credential',
  callee: 'defineCredentials',
  fields: CREDENTIAL_FIELDS,
  checkKey(key, pointer, report) {
    if (isResourceKey(key)) return true
    report(
      'E_KEY_INVALID',
      pointer,
      `"${key}" is not a valid key.`,
      'A key is lowercase letters, digits, `-` and `_`, starting with a letter, at most 64 characters.'
    )
    return false
  },
  refused: Object.fromEntries(
    ['token', 'accessToken', 'apiKey', 'secret', 'password', 'value'].map((field) => [
      field,
      'credentials.ts never holds a token. Remove it and connect the credential with `sim credentials connect <provider> --name "<display name>"`.',
    ])
  ),
  complete: ({ provider, ...rest }) => (provider === undefined ? undefined : { provider, ...rest }),
})

/** The fingerprint of one declared credential, as the base records it. */
export function credentialFingerprint(entry: CredentialDecl): ResourceFingerprint {
  return entryFingerprint(CREDENTIAL_FIELDS, entry)
}
