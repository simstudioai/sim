import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { mustClassifyContent } from '@/lib/core/application'
import { type FileReadReceipt, recheckFileReadReceipt } from '@/lib/workspace-files/read-receipt'

/**
 * Recheck current application authority and byte identities before publishing; dispose rejected
 * streams. Only a classified principal gets the delivered files' current provenance back: no other
 * caller's admission reads it.
 *
 * An unclassified caller receiving bytes derived from `fileId` alone skips the recheck: the request
 * already authorized that read, the bytes come from the revision it authorized, and admission never
 * depends on provenance, so a recheck could only race a concurrent revocation or edit. Bytes that
 * embed other files are always rechecked.
 */
export async function finishFileDelivery(input: {
  principal: Principal
  fileId: string
  authorize(): Promise<void>
  receipt: FileReadReceipt
  stream?: ReadableStream<Uint8Array>
}) {
  const classified = mustClassifyContent(input.principal)
  if (!classified && input.receipt.files.every((file) => file.id === input.fileId)) return undefined
  try {
    await input.authorize()
    return await db.transaction(
      (tx) => recheckFileReadReceipt(tx, input.receipt, { readProvenance: classified }),
      { isolationLevel: 'repeatable read', accessMode: 'read only' }
    )
  } catch (error) {
    await input.stream?.cancel(error).catch(() => undefined)
    throw error
  }
}
