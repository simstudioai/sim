export const TAG_SLOT_CONFIG = {
  text: {
    slots: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7'] as const,
    maxSlots: 7,
  },
  number: {
    slots: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7'] as const,
    maxSlots: 7,
  },
  date: {
    slots: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7'] as const,
    maxSlots: 7,
  },
  boolean: {
    slots: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7'] as const,
    maxSlots: 7,
  },
} as const

export const SUPPORTED_FIELD_TYPES = Object.keys(TAG_SLOT_CONFIG) as Array<
  keyof typeof TAG_SLOT_CONFIG
>

export const TAG_SLOTS = TAG_SLOT_CONFIG.text.slots

export const MAX_TAG_SLOTS = TAG_SLOT_CONFIG.text.maxSlots

export type TagSlot = (typeof TAG_SLOTS)[number]

export function getSlotsForFieldType(fieldType: string): readonly string[] {
  const config = TAG_SLOT_CONFIG[fieldType as keyof typeof TAG_SLOT_CONFIG]
  if (!config) {
    return []
  }
  return config.slots
}

export const FIELD_TYPE_METADATA = {
  text: {
    label: 'Text',
    description: 'Free-form text content',
    placeholder: 'Enter text',
    validate: (value: string): { isValid: boolean; error?: string } => {
      return { isValid: true }
    },
    format: (value: string): string => value.trim(),
  },
  number: {
    label: 'Number',
    description: 'Numeric values (integers or decimals)',
    placeholder: 'Enter number',
    validate: (value: string): { isValid: boolean; error?: string } => {
      if (!value.trim()) return { isValid: true }
      const num = Number(value.trim())
      if (Number.isNaN(num) || !Number.isFinite(num)) {
        return { isValid: false, error: 'Must be a valid number' }
      }
      return { isValid: true }
    },
    format: (value: string): string => {
      if (!value.trim()) return ''
      const num = Number(value.trim())
      return Number.isNaN(num) ? value : num.toString()
    },
  },
  date: {
    label: 'Date',
    description: 'Date and time values',
    placeholder: 'mm/dd/yyyy',
    validate: (value: string): { isValid: boolean; error?: string } => {
      if (!value.trim()) return { isValid: true }
      const date = new Date(value.trim())
      if (Number.isNaN(date.getTime())) {
        return { isValid: false, error: 'Must be a valid date' }
      }
      return { isValid: true }
    },
    format: (value: string): string => {
      if (!value.trim()) return ''
      const date = new Date(value.trim())
      return Number.isNaN(date.getTime()) ? value : date.toISOString()
    },
  },
  boolean: {
    label: 'Boolean',
    description: 'True/false values',
    placeholder: 'true or false',
    validate: (value: string): { isValid: boolean; error?: string } => {
      if (!value.trim()) return { isValid: true }
      const lower = value.trim().toLowerCase()
      if (!['true', 'false', '1', '0', 'yes', 'no'].includes(lower)) {
        return { isValid: false, error: 'Must be true, false, yes, no, 1, or 0' }
      }
      return { isValid: true }
    },
    format: (value: string): string => {
      if (!value.trim()) return ''
      const lower = value.trim().toLowerCase()
      if (['true', '1', 'yes'].includes(lower)) return 'true'
      if (['false', '0', 'no'].includes(lower)) return 'false'
      return value
    },
  },
} as const

export function validateFieldValue(
  fieldType: string,
  value: string
): { isValid: boolean; error?: string } {
  const metadata = FIELD_TYPE_METADATA[fieldType as keyof typeof FIELD_TYPE_METADATA]
  if (!metadata) {
    return { isValid: false, error: `Unknown field type: ${fieldType}` }
  }
  return metadata.validate(value)
}

export function formatFieldValue(fieldType: string, value: string): string {
  const metadata = FIELD_TYPE_METADATA[fieldType as keyof typeof FIELD_TYPE_METADATA]
  if (!metadata) {
    return value
  }
  return metadata.format(value)
}
