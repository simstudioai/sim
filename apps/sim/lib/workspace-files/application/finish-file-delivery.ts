import { db } from '@sim/db'
import { type FileReadReceipt, recheckFileReadReceipt } from '@/lib/workspace-files/read-receipt'

/** Recheck current application authority and byte identities before publishing; dispose rejected streams. */
export async function finishFileDelivery(input: {
  authorize(): Promise<void>
  receipt: FileReadReceipt
  stream?: ReadableStream<Uint8Array>
}) {
  try {
    await input.authorize()
    return await db.transaction((tx) => recheckFileReadReceipt(tx, input.receipt))
  } catch (error) {
    await input.stream?.cancel(error).catch(() => undefined)
    throw error
  }
}
