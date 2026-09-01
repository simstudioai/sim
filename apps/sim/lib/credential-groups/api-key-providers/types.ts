import { createHash } from 'node:crypto'
import type { CredentialGroupApiKeyProvider } from '@/lib/credential-groups/providers'

/**
 * What a service could establish about a key its owner pasted.
 *
 * The OAuth enrollment path always proves identity: the consenting account's address is
 * matched against the invitation, and a mismatch is refused. An API key can only be matched
 * that way when the service exposes an endpoint naming the key's owner. Where it does not,
 * the binding rests on possession of the invitation link alone.
 *
 * That difference is modelled rather than smoothed over: a missing address is `unproven`,
 * not an absent field, so every new verifier has to answer the question and every surface
 * can show which bindings are proven.
 */
export type CredentialGroupApiKeyVerification =
  | { identity: 'verified'; subjectId: string; displayName: string; email: string }
  | { identity: 'unproven'; subjectId: string; displayName: string }

/**
 * Stand-in subject for a service that cannot name a key's owner.
 *
 * `credential.providerSubjectId` is required for every managed credential, and for an
 * unproven binding the only thing that distinguishes one grant from another is the credential
 * itself. A digest over every field, key-sorted so field order cannot change it, gives a
 * stable non-reversible identifier that changes when any part is rotated — which is correct,
 * since a replacement credential is a new grant. The prefix keeps it from being mistaken for
 * something the provider issued.
 */
export function unprovenApiKeySubjectId(fields: Record<string, string>): string {
  const canonical = Object.keys(fields)
    .sort()
    .map((key) => `${key}\u0000${fields[key]}`)
    .join('\u0001')
  return `unproven:${createHash('sha256').update(canonical).digest('hex')}`
}

export class CredentialGroupApiKeyVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CredentialGroupApiKeyVerificationError'
  }
}

export interface CredentialGroupApiKeyVerifier {
  provider: CredentialGroupApiKeyProvider
  /**
   * Proves the credential works, and names its owner where the service can.
   *
   * Receives every field the provider declares, keyed by field id, already trimmed and
   * length-checked. Throws {@link CredentialGroupApiKeyVerificationError} with a message safe
   * to show the invited person when the credential is rejected. This runs while they are still
   * on the page, so a typo is caught at collection instead of surfacing later as a failing
   * workflow.
   */
  verify(fields: Record<string, string>): Promise<CredentialGroupApiKeyVerification>
}
