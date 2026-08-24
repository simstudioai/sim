import { isRecordLike } from '@sim/utils/object'

/**
 * Walkers over Photon's slim content tree.
 *
 * Two surfaces read the same message: the webhook handler, which builds trigger outputs, and the
 * Get Message tool. A workflow that reads `text` or `attachments` must see the same thing from
 * either, so there is one implementation rather than a copy per surface with a comment asking the
 * next reader to keep them aligned.
 */

export interface PhotonAttachmentSummary {
  id: string | null
  name: string | null
  mimeType: string | null
  size: number | null
}

const asNullableString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null

/** A group item is either a `{ content }` wrapper or the content node itself. */
const itemContent = (item: Record<string, unknown>): unknown => item.content ?? item

/**
 * The human-readable text of a content tree. A reply carries its own inner content and a group
 * carries N items, so the text a workflow wants is not always at the top level. Every non-empty
 * text in a group contributes, joined by newlines; `''` means the message carries no text.
 */
export function collectPhotonText(content: unknown): string {
  if (!isRecordLike(content)) {
    return ''
  }

  switch (content.type) {
    case 'text':
      return typeof content.text === 'string' ? content.text : ''
    case 'reply':
      return collectPhotonText(content.content)
    case 'group': {
      const items = Array.isArray(content.items) ? content.items : []
      return items
        .map((item) => (isRecordLike(item) ? collectPhotonText(itemContent(item)) : ''))
        .filter(Boolean)
        .join('\n')
    }
    default:
      return ''
  }
}

/**
 * Attachment metadata for every media node in a content tree. A native voice memo is its own
 * content arm carrying the same id/name/mimeType, and both feed the Download Attachment operation.
 *
 * Only metadata: bytes stay behind the platform and are fetched on demand, which a webhook payload
 * cannot do.
 */
export function collectPhotonAttachments(content: unknown): PhotonAttachmentSummary[] {
  if (!isRecordLike(content)) {
    return []
  }

  switch (content.type) {
    case 'attachment':
    case 'voice':
      return [
        {
          id: asNullableString(content.id),
          name: asNullableString(content.name),
          mimeType: asNullableString(content.mimeType),
          size: typeof content.size === 'number' ? content.size : null,
        },
      ]
    case 'reply':
      return collectPhotonAttachments(content.content)
    case 'group': {
      const items = Array.isArray(content.items) ? content.items : []
      return items.flatMap((item) =>
        isRecordLike(item) ? collectPhotonAttachments(itemContent(item)) : []
      )
    }
    default:
      return []
  }
}
