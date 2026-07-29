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

/** Credential id to the moment its proof of presence lapses. */
const provenUntil = new Map<string, number>()

export interface SecretAuthRequest {
  /**
   * The credential the grant covers. Proving presence for one saved password
   * says nothing about any other, so grants never widen past the id they were
   * granted for.
   */
  credentialId: string
  /** Completes "Sim is about to ..." in the prompt. */
  reason: string
  /** Confirm-button label and title for the non-biometric fallback. */
  action: string
}

function hasFreshProof(credentialId: string): boolean {
  const expiry = provenUntil.get(credentialId)
  if (expiry === undefined) return false
  if (Date.now() >= expiry) {
    provenUntil.delete(credentialId)
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
  reason,
  action,
}: SecretAuthRequest): Promise<boolean> {
  if (hasFreshProof(credentialId)) return true
  if (!(await promptForSecret(reason, action))) return false
  provenUntil.set(credentialId, Date.now() + AUTH_GRACE_MS)
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
