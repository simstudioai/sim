import { createLogger } from '@sim/logger'
import { dialog, systemPreferences } from 'electron'

const logger = createLogger('BrowserCredentialAuth')

/**
 * How long proving presence for one credential stands before Sim asks again.
 *
 * Matches the reveal window in the settings UI, so the prompt comes back at
 * the same moment an on-screen password re-masks. Within the window the user
 * has already proven they are at the keyboard, and the plaintext they proved
 * their way to is typically still on screen — asking a second time to put that
 * same string on the clipboard is friction that buys nothing, and teaches
 * people to approve prompts without reading them.
 */
const AUTH_GRACE_MS = 30_000

/**
 * What a grant was proven for.
 *
 * Neither operation dominates the other, so a grant satisfies only its own.
 * `reveal` hands the plaintext to the Sim renderer; `copy` publishes it to the
 * macOS pasteboard, which every process on the machine can read, which
 * clipboard managers persist to disk beyond the 30s `clipboard.clear()`, and
 * which Universal Clipboard syncs to the user's other devices. Ordering them
 * either way lets one consent authorize an exposure the prompt never described.
 */
export type SecretOperation = 'reveal' | 'copy'

/**
 * Proof of presence per credential AND operation.
 *
 * Nested rather than one scalar per credential: a single slot would be
 * overwritten on each grant, so reveal → copy → reveal prompts three times
 * inside one window even though each was already proven. Nesting also keeps
 * revoke-by-credential a single delete, so a third operation added later cannot
 * be left behind by a revoke that forgot to enumerate it.
 */
const provenUntil = new Map<string, Map<SecretOperation, number>>()

export interface SecretAuthRequest {
  /**
   * The credential the grant covers. Proving presence for one saved password
   * says nothing about any other, so grants never widen past the id they were
   * granted for.
   */
  credentialId: string
  /**
   * What the caller is about to do. Required, because a grant that did not
   * record it let the weaker consent stand in for the stronger one: approving
   * a "Copy password?" prompt silently authorized a plaintext reveal to the
   * renderer for the rest of the window, with no second prompt and a label
   * that described something else.
   */
  operation: SecretOperation
  /** Completes "Sim is about to ..." in the prompt. */
  reason: string
  /** Confirm-button label and title for the non-biometric fallback. */
  action: string
}

function hasFreshProof(credentialId: string, operation: SecretOperation): boolean {
  const grants = provenUntil.get(credentialId)
  const expiry = grants?.get(operation)
  if (expiry === undefined) return false
  // Also lapsed when the remaining time exceeds the whole window, which is what
  // a backwards clock step looks like — otherwise a corrected clock would leave
  // a grant standing far longer than it was granted for.
  const remaining = expiry - Date.now()
  if (remaining <= 0 || remaining > AUTH_GRACE_MS) {
    grants?.delete(operation)
    return false
  }
  return true
}

/**
 * Drops standing grants, so a re-import or a delete cannot leave a grant
 * attached to an id that now means something else.
 *
 * Called with no id, it revokes everything.
 */
export function revokeSecretAuthorization(credentialId?: string): void {
  if (credentialId === undefined) provenUntil.clear()
  else provenUntil.delete(credentialId)
}

/**
 * The authorization step in front of revealing or copying a saved password.
 *
 * Showing a password is the one place where plaintext leaves the main process
 * for the Sim renderer, so it is not enough that the page asked nicely — the
 * person at the keyboard has to prove they are there, in a surface the
 * renderer cannot drive or fake.
 *
 * Touch ID is used when the machine has it. Where it does not (a Mac mini
 * without a Touch ID keyboard, or a user who has not enrolled), the fallback
 * is a native modal that the main process owns. That is genuinely weaker than
 * biometric auth — it proves presence, not identity — so it is a deliberate,
 * documented trade rather than a silent one, and it still cannot be triggered
 * without a real click in the page.
 *
 * A grant lapses on its own after {@link AUTH_GRACE_MS}; it never removes the
 * user-gesture requirement the IPC layer enforces, so it shortens the prompt
 * for a present user rather than opening a path for an absent one.
 */
export async function authorizeForSecret({
  credentialId,
  operation,
  reason,
  action,
}: SecretAuthRequest): Promise<boolean> {
  if (hasFreshProof(credentialId, operation)) return true
  if (!(await promptForSecret(reason, action))) return false
  const grants = provenUntil.get(credentialId) ?? new Map<SecretOperation, number>()
  grants.set(operation, Date.now() + AUTH_GRACE_MS)
  provenUntil.set(credentialId, grants)
  return true
}

async function promptForSecret(reason: string, action: string): Promise<boolean> {
  if (process.platform === 'darwin' && systemPreferences.canPromptTouchID?.()) {
    try {
      await systemPreferences.promptTouchID(reason)
      return true
    } catch {
      // A cancelled or failed prompt is a refusal, not an error to report.
      return false
    }
  }

  try {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Cancel', action],
      defaultId: 1,
      cancelId: 0,
      message: `${action}?`,
      detail: `Sim is about to ${reason}. Make sure nobody can see your screen.`,
      noLink: true,
    })
    return response === 1
  } catch (error) {
    // Fail closed: if the confirmation cannot be shown, nothing is revealed.
    logger.warn('Could not present the credential confirmation')
    return false
  }
}
