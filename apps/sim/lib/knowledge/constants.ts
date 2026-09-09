import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'

/** Max character length for a knowledge base description, enforced at every layer (UI, internal API, v1 API). */
export const KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH = 10_000

/** Hard bound for path-indexed knowledge folder trees and recursive cascades. */
export const MAX_KNOWLEDGE_FOLDERS_PER_WORKSPACE = MAX_FOLDERS_PER_WORKSPACE

/**
 * Maximum items a knowledge bulk request may address by identifier. Lives here
 * rather than in the application batch policy so the boundary contracts can
 * bound their id arrays without pulling a server-only module into client code.
 */
export const MAX_KNOWLEDGE_BATCH_ITEMS = 100
/** Maximum documents accepted by one internal bulk-create command. */
export const MAX_KNOWLEDGE_DOCUMENTS_PER_CREATE = 100
/** Maximum connector documents mutated atomically by one command. */
export const MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_MUTATION_ITEMS = 100
/** Default and maximum bounded connector-document list page sizes. */
export const DEFAULT_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE = 100
export const MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE = 200

/**
 * Chunking a knowledge base gets when its creator names no configuration.
 *
 * Applied in `lib/knowledge/orchestration` so the UI, the v1 and v2 APIs, and
 * the copilot agent all index identical input identically. Previously each
 * caller carried its own literal and the agent's `minSize` was 1, so the same
 * document chunked differently depending on who uploaded it.
 */
export const DEFAULT_CHUNKING_CONFIG = {
  maxSize: 1024,
  minSize: 100,
  overlap: 200,
} as const

export const TAG_SLOT_CONFIG = {
  text: {
    slots: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7'] as const,
    maxSlots: 7,
  },
  number: {
    slots: ['number1', 'number2', 'number3', 'number4', 'number5'] as const,
    maxSlots: 5,
  },
  date: {
    slots: ['date1', 'date2'] as const,
    maxSlots: 2,
  },
  boolean: {
    slots: ['boolean1', 'boolean2', 'boolean3'] as const,
    maxSlots: 3,
  },
} as const

export const SUPPORTED_FIELD_TYPES = Object.keys(TAG_SLOT_CONFIG) as Array<
  keyof typeof TAG_SLOT_CONFIG
>

/** Text tag slots (for backwards compatibility) */
export const TAG_SLOTS = TAG_SLOT_CONFIG.text.slots

/** All tag slots across all field types */
export const ALL_TAG_SLOTS = [
  ...TAG_SLOT_CONFIG.text.slots,
  ...TAG_SLOT_CONFIG.number.slots,
  ...TAG_SLOT_CONFIG.date.slots,
  ...TAG_SLOT_CONFIG.boolean.slots,
] as const

export const MAX_TAG_SLOTS = TAG_SLOT_CONFIG.text.maxSlots

/** Type for text tag slots (for backwards compatibility) */
export type TagSlot = (typeof TAG_SLOTS)[number]

/** Type for all tag slots */
export type AllTagSlot = (typeof ALL_TAG_SLOTS)[number]

/**
 * Max character length for a tag display name, enforced on every write path (UI,
 * create API, bulk document API, copilot tools).
 */
export const KNOWLEDGE_TAG_DISPLAY_NAME_MAX_LENGTH = 100

/** Type for number tag slots */
export type NumberTagSlot = (typeof TAG_SLOT_CONFIG.number.slots)[number]

/** Type for date tag slots */
export type DateTagSlot = (typeof TAG_SLOT_CONFIG.date.slots)[number]

/** Type for boolean tag slots */
export type BooleanTagSlot = (typeof TAG_SLOT_CONFIG.boolean.slots)[number]

/**
 * Get the available slots for a field type
 */
export function getSlotsForFieldType(fieldType: string): readonly string[] {
  const config = TAG_SLOT_CONFIG[fieldType as keyof typeof TAG_SLOT_CONFIG]
  if (!config) {
    return []
  }
  return config.slots
}

/**
 * Get the field type for a tag slot
 */
export function getFieldTypeForSlot(tagSlot: string): keyof typeof TAG_SLOT_CONFIG | null {
  for (const [fieldType, config] of Object.entries(TAG_SLOT_CONFIG)) {
    if ((config.slots as readonly string[]).includes(tagSlot)) {
      return fieldType as keyof typeof TAG_SLOT_CONFIG
    }
  }
  return null
}

/**
 * Check if a slot is valid for a given field type
 */
export function isValidSlotForFieldType(tagSlot: string, fieldType: string): boolean {
  const config = TAG_SLOT_CONFIG[fieldType as keyof typeof TAG_SLOT_CONFIG]
  if (!config) {
    return false
  }
  return (config.slots as readonly string[]).includes(tagSlot)
}

/**
 * Display labels for field types
 */
export const FIELD_TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  boolean: 'Boolean',
}

/**
 * Allocate tag slots for a set of tag definitions, avoiding already-used slots.
 * Returns a mapping of semantic IDs to slot names and a list of skipped tag names.
 */
export function allocateTagSlots(
  tagDefinitions: Array<{ id: string; displayName: string; fieldType: string }>,
  usedSlots: Set<string>
): { mapping: Record<string, string>; skipped: string[] } {
  const mapping: Record<string, string> = {}
  const skipped: string[] = []
  const claimed = new Set(usedSlots)

  for (const td of tagDefinitions) {
    const slots = getSlotsForFieldType(td.fieldType)
    const available = slots.find((s) => !claimed.has(s))

    if (!available) {
      skipped.push(td.displayName)
      continue
    }
    claimed.add(available)
    mapping[td.id] = available
  }

  return { mapping, skipped }
}

/**
 * Get placeholder text for value input based on field type
 */
export function getPlaceholderForFieldType(fieldType: string): string {
  switch (fieldType) {
    case 'boolean':
      return 'true or false'
    case 'number':
      return 'Enter number'
    case 'date':
      return 'YYYY-MM-DD'
    default:
      return 'Enter value'
  }
}

/**
 * Minimum time the client waits before asking the server to classify an active
 * document-processing run as dead.
 *
 * Lives here so the client does not import server configuration. The server
 * derives its authoritative threshold from the configured task
 * duration and retry budget and may require longer. Keeping the client at the
 * same 45-minute floor prevents the default UI from racing a legitimate run.
 */
export const KNOWLEDGE_DOCUMENT_PROCESSING_STALE_THRESHOLD_MS = 45 * 60 * 1000

/** Bundle layout version written to `manifest.json`; an importer refuses any other. */
export const KNOWLEDGE_BUNDLE_VERSION = 1
/** Documents one export bundle may carry, so every produced bundle stays importable. */
export const MAX_KNOWLEDGE_BUNDLE_DOCUMENTS = 2_000
/**
 * Characters one exported chunk may hold. Wider than the manual-chunk API cap
 * because the processor's largest chunking config emits chunks past 10k.
 */
export const MAX_KNOWLEDGE_BUNDLE_CHUNK_CONTENT_LENGTH = 100_000
