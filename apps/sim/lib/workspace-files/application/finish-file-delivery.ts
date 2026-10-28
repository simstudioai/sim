import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { mustClassifyContent } from '@/lib/core/application'
import {
  assertFileReadReceiptCurrent,
  type FileReadReceipt,
  recheckFileReadReceipt,
} from '@/lib/workspace-files/read-receipt'

/**
 * Recheck current application authority and byte identities before publishing; dispose rejected
 * streams. Only a classified principal gets the delivered files' current provenance back: no other
 * caller's admission reads it.
 */
export async function finishFileDelivery(input: {
  principal: Principal
  authorize(): Promise<void>
  receipt: FileReadReceipt
  stream?: ReadableStream<Uint8Array>
}) {
  try {
    const classified = mustClassifyContent(input.principal)
    await input.authorize()
    return await db.transaction(
      async (tx) => {
        if (classified) return recheckFileReadReceipt(tx, input.receipt)
        await assertFileReadReceiptCurrent(tx, input.receipt)
        return undefined
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' }
    )
  } catch (error) {
    await input.stream?.cancel(error).catch(() => undefined)
    throw error
  }
}
