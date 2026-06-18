'use client'

const PENDING_DRIVE_EXPORT_KEY = 'sim.files-pending-drive-export'

/** A Drive export the user started but paused to connect an account. */
export interface PendingDriveExport {
  fileIds: string[]
  fileNames: string[]
  /**
   * Credential ids visible when the user left to connect a new account. On
   * resume the account not in this list is the freshly-connected one, so it can
   * be auto-selected even when several accounts now exist.
   */
  priorCredentialIds: string[]
}

/**
 * Persist an in-progress Drive export before the OAuth connect redirect leaves
 * the page, so the export can be resumed when the user returns to Files.
 */
export function writePendingDriveExport(target: PendingDriveExport) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(PENDING_DRIVE_EXPORT_KEY, JSON.stringify(target))
}

/** Read and clear any paused Drive export. Returns `null` when none is stored. */
export function consumePendingDriveExport(): PendingDriveExport | null {
  if (typeof window === 'undefined') return null
  const raw = window.sessionStorage.getItem(PENDING_DRIVE_EXPORT_KEY)
  if (!raw) return null
  window.sessionStorage.removeItem(PENDING_DRIVE_EXPORT_KEY)
  try {
    const parsed = JSON.parse(raw) as PendingDriveExport
    if (Array.isArray(parsed.fileIds) && Array.isArray(parsed.fileNames)) {
      return { ...parsed, priorCredentialIds: parsed.priorCredentialIds ?? [] }
    }
  } catch {}
  return null
}

/**
 * Discard any paused export. Called when the user dismisses the export flow
 * without completing OAuth, so a cancelled connect never reopens the modal on a
 * later Files visit. (A real OAuth redirect unloads the page before this runs,
 * so the resume token survives the round-trip it is meant for.)
 */
export function clearPendingDriveExport() {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(PENDING_DRIVE_EXPORT_KEY)
}
