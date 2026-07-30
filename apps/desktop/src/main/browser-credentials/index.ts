import { join } from 'node:path'
import type {
  BrowserCredentialConflictPolicy,
  BrowserCredentialMetadata,
} from '@sim/desktop-bridge'
import { app, clipboard } from 'electron'
import { FillCoordinator, type FillCoordinatorDeps } from '@/main/browser-credentials/fill'
import { authorizeForSecret, revokeSecretAuthorization } from '@/main/browser-credentials/os-auth'
import { CredentialVault } from '@/main/browser-credentials/vault'
import { clearSites } from '@/main/browser-sites'

/** How long a copied password may sit on the clipboard before Sim clears it. */
const CLIPBOARD_CLEAR_MS = 30_000

/**
 * Composition root for saved passwords: one vault and one fill coordinator for
 * the whole app. The IPC layer talks to this module and nothing deeper, so the
 * vault instance is never handed to a renderer-facing surface.
 */

let vaultInstance: CredentialVault | null = null
let coordinatorInstance: FillCoordinator | null = null

export function credentialVault(): CredentialVault {
  if (!vaultInstance) {
    vaultInstance = new CredentialVault(join(app.getPath('userData'), 'browser-credentials.json'))
  }
  return vaultInstance
}

/** Creates the coordinator once the browser session can report its active tab. */
export function initFillCoordinator(deps: Omit<FillCoordinatorDeps, 'vault'>): FillCoordinator {
  coordinatorInstance = new FillCoordinator({ ...deps, vault: credentialVault() })
  return coordinatorInstance
}

export function fillCoordinator(): FillCoordinator | null {
  return coordinatorInstance
}

export function credentialsAvailable(): boolean {
  return credentialVault().isAvailable()
}

export function listCredentials(): Promise<BrowserCredentialMetadata[]> {
  return credentialVault().list()
}

export async function forgetCredential(id: string): Promise<BrowserCredentialMetadata[]> {
  const vault = credentialVault()
  await vault.delete(id)
  revokeSecretAuthorization(id)
  // A forgotten credential can remove the last match for the open page.
  await coordinatorInstance?.refreshAvailability()
  return vault.list()
}

export async function importCredentials(
  candidates: Parameters<CredentialVault['importCredentials']>[0],
  policy: BrowserCredentialConflictPolicy
): ReturnType<CredentialVault['importCredentials']> {
  const outcome = await credentialVault().importCredentials(candidates, policy)
  revokeSecretAuthorization()
  await coordinatorInstance?.refreshAvailability()
  return outcome
}

/**
 * Deletes every saved password at the user's request.
 *
 * Distinct from {@link clearCredentials}, which runs as part of sign-out
 * teardown: this one is a deliberate action from the password manager, so it
 * resolves the resulting list for the UI to render.
 */
export async function forgetAllCredentials(): Promise<BrowserCredentialMetadata[]> {
  await clearCredentials()
  return []
}

/**
 * Reveals one saved password to the settings UI, after the user proves they
 * are present.
 *
 * This is the single path by which password plaintext reaches the Sim
 * renderer, and it exists only because a password manager the user cannot read
 * is not a password manager. Everything else about it is deliberately narrow:
 * one credential per call, a fresh proof of presence, and nothing logged.
 */
export async function revealCredential(id: string): Promise<string | null> {
  const authorized = await authorizeForSecret({
    credentialId: id,
    operation: 'reveal',
    reason: 'show a saved password',
    action: 'Show password',
  })
  if (!authorized) return null
  return credentialVault().revealPassword(id)
}

/**
 * Copies one saved password to the clipboard without it passing through the
 * renderer at all, then clears the clipboard again.
 *
 * The clipboard is only cleared if it still holds this password — overwriting
 * whatever the user copied in the meantime would be its own small betrayal.
 */
export async function copyCredential(id: string): Promise<boolean> {
  const authorized = await authorizeForSecret({
    credentialId: id,
    operation: 'copy',
    reason: 'copy a saved password',
    action: 'Copy password',
  })
  if (!authorized) return false
  const password = await credentialVault().revealPassword(id)
  if (password === null) return false

  clipboard.writeText(password)
  setTimeout(() => {
    if (clipboard.readText() === password) clipboard.clear()
  }, CLIPBOARD_CLEAR_MS).unref?.()
  return true
}

/**
 * Destroys every saved credential. Sim sign-out runs this so the next account
 * on this machine cannot inherit the previous user's passwords.
 */
export async function clearCredentials(): Promise<void> {
  // Revoked first, and unconditionally. Both deletions below can reject on a
  // file the OS will not let us unlink, and the sign-out caller only logs
  // that — so a revoke sequenced after them would be skipped while sign-out
  // still reported success, leaving the previous user's OS-auth grant live
  // for whoever signs in next. Dropping the grant early only ever fails safe.
  revokeSecretAuthorization()
  try {
    // Both attempted regardless of each other. Sequencing them in one `try`
    // made the second conditional on the first, so a vault file the OS would
    // not let us unlink also left the imported site directory — hostnames and
    // visit counts from the user's other browser — behind after sign-out.
    const outcomes = await Promise.allSettled([credentialVault().clear(), clearSites()])
    const failure = outcomes.find((outcome) => outcome.status === 'rejected')
    if (failure) throw failure.reason
  } finally {
    await coordinatorInstance?.refreshAvailability()
  }
}
