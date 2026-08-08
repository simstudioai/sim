import { Badge, Loader } from '@sim/emcn'
import { CircleAlert } from '@sim/emcn/icons'
import { format } from 'date-fns'
import { ALL_TAG_SLOTS, type AllTagSlot, getFieldTypeForSlot } from '@/lib/knowledge/constants'
import type { DocumentData } from '@/lib/knowledge/types'
import type { TagDefinition } from '@/hooks/kb/use-knowledge-base-tag-definitions'

const AnimatedLoader = ({ className }: { className?: string }) => (
  <Loader className={className} animate />
)

/** One resolved tag on a document: which slot it came from, and how it reads. */
export interface TagValue {
  slot: AllTagSlot
  displayName: string
  value: string
}

/** Processing/enabled state of a document, as the status column renders it. */
export function getStatusBadge(doc: DocumentData) {
  switch (doc.processingStatus) {
    case 'pending':
      return (
        <Badge variant='gray' size='sm'>
          Pending
        </Badge>
      )
    case 'processing':
      return (
        <Badge variant='purple' size='sm' icon={AnimatedLoader}>
          Processing
        </Badge>
      )
    case 'failed':
      return doc.processingError ? (
        <Badge variant='red' size='sm' icon={CircleAlert}>
          Failed
        </Badge>
      ) : (
        <Badge variant='red' size='sm'>
          Failed
        </Badge>
      )
    case 'completed':
      return doc.enabled ? (
        <Badge variant='green' size='sm'>
          Enabled
        </Badge>
      ) : (
        <Badge variant='gray' size='sm'>
          Disabled
        </Badge>
      )
    default:
      return (
        <Badge variant='gray' size='sm'>
          Unknown
        </Badge>
      )
  }
}

/**
 * Resolves a document's populated tag slots into display values, formatting each
 * by the field type its definition declares (falling back to the slot's own
 * type, then to text).
 */
export function getDocumentTags(doc: DocumentData, definitions: TagDefinition[]): TagValue[] {
  const result: TagValue[] = []
  const defsBySlot = new Map(definitions.map((d) => [d.tagSlot, d]))

  for (const slot of ALL_TAG_SLOTS) {
    const raw = doc[slot]
    if (raw == null) continue

    const def = defsBySlot.get(slot)
    const fieldType = def?.fieldType || getFieldTypeForSlot(slot) || 'text'

    let value: string
    if (fieldType === 'date') {
      try {
        value = format(new Date(raw as string), 'MMM d, yyyy')
      } catch {
        value = String(raw)
      }
    } else if (fieldType === 'boolean') {
      value = raw ? 'Yes' : 'No'
    } else if (fieldType === 'number' && typeof raw === 'number') {
      value = raw.toLocaleString()
    } else {
      value = String(raw)
    }

    if (value) {
      result.push({ slot, displayName: def?.displayName || slot, value })
    }
  }

  return result
}
