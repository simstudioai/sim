/**
 * Secrets: `secrets.ts` names the workspace secrets workflows read (`env.NAME`), each with what it
 * is for. Only names and descriptions: a secret's value never appears in source, and an apply never
 * creates, sets or deletes one. A name the workspace holds no value for is reported, and a
 * workflow using it is held back while the rest of the apply goes ahead.
 *
 * ```ts
 * // @sim-sdk 1
 * import { defineSecrets } from '@sim/workflow-sdk/workspace'
 *
 * export default defineSecrets({
 *   OPENAI_API_KEY: { description: 'Support bot model access' },
 *   STRIPE_KEY: {},
 * })
 * ```
 */

import type { ResourceFingerprint } from '../base'
import { type DeclFields, stringField } from '../declaration/field-table'
import { isDeclarableKey } from '../declaration/read'
import type { KindCodec } from '../kind'
import { isSecretName } from '../layout'
import { entryCodec, entryFingerprint } from './entries'

/** One secret as `secrets.ts` declares it: what it is for, never its value. */
export interface SecretDecl {
  description?: string
}

/** Every secret `secrets.ts` declares, by name. */
export type SecretsDecl = Record<string, SecretDecl>

/** Mirrors the secret description limit (`setSecretContract` in apps/sim). */
const SECRET_DESCRIPTION_MAX_LENGTH = 500

/** A secret's fields; an empty description fingerprints as none, as the server stores it. */
const SECRET_FIELDS: DeclFields<SecretDecl> = {
  description: stringField(
    { maxLength: SECRET_DESCRIPTION_MAX_LENGTH },
    (description) => description || null
  ),
}

/**
 * Whether `secrets.ts` can declare the secret `name`. The server may hold a secret named
 * `__proto__`, which the declaration reader refuses as a key, so a get leaves it out
 * (`.sim/skipped.json`) rather than print a `secrets.ts` that no longer applies.
 */
export function isDeclarableSecret(name: string): boolean {
  return isSecretName(name) && isDeclarableKey(name)
}

/** Reads and prints `secrets.ts`. */
export const secretCodec: KindCodec<SecretsDecl> = entryCodec<SecretDecl>({
  kind: 'secret',
  callee: 'defineSecrets',
  fields: SECRET_FIELDS,
  checkKey(key, pointer, report) {
    if (isSecretName(key)) return true
    report(
      'E_SECRET_NAME',
      pointer,
      `"${key}" is not a secret name.`,
      'A secret name is letters, digits and `_`, at most 255 characters.'
    )
    return false
  },
  refused: {
    value:
      'secrets.ts never holds a value. Remove it and set the value with `sim secrets set <NAME> --scope workspace`.',
  },
  complete: (read) => read,
})

/** The fingerprint of one declared secret, as the base records it. */
export function secretFingerprint(entry: SecretDecl): ResourceFingerprint {
  return entryFingerprint(SECRET_FIELDS, entry)
}
