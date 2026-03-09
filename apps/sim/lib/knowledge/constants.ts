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
