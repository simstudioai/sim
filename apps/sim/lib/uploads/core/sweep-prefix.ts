import type { OutboxEventContext } from '@/lib/core/outbox/service'
import type { StorageContext } from '@/lib/uploads/config'
import {
  deleteStorageKeysUnderPrefix,
  listStorageKeyPage,
  outboxDeadlineNear,
} from '@/lib/uploads/core/prefix-sweep'

/**
 * One outbox run's step of deleting every object under `prefix`: deletes one listing page's
 * objects, re-listing from the prefix start on the next step. A provider (Azure Blob, GCS,
 * S3-compatibles) may return a short or empty page that is not the last, so only `page.done` ends
 * the sweep; a non-final page that removes nothing is followed to the next one within the step, so
 * objects behind it are still reached. `continue` after a step that removed something with more
 * left; `stalled` when no page removed anything before the listing stopped advancing or the
 * deadline neared.
 */
export async function sweepStoragePrefix(
  prefix: string,
  context: StorageContext,
  outbox: Pick<OutboxEventContext, 'signal' | 'deadlineAt'>
): Promise<'done' | 'continue' | 'stalled'> {
  let pageToken: string | undefined
  for (;;) {
    const page = await listStorageKeyPage(prefix, context, outbox.signal, pageToken)
    const { deleted, complete } = await deleteStorageKeysUnderPrefix(
      prefix,
      context,
      page.keys,
      outbox
    )
    if (complete && page.done) return 'done'
    if (deleted > 0) return 'continue'
    const advanced = page.nextPageToken !== undefined && page.nextPageToken !== pageToken
    if (!complete || !advanced || outboxDeadlineNear(outbox)) return 'stalled'
    pageToken = page.nextPageToken
  }
}
