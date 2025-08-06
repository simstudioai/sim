/**
 * Knowledge base and document constants
 */

// Tag slot configuration by field type
// Each field type maps to specific database columns
export const TAG_SLOT_CONFIG = {
  text: {
    slots: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7'] as const,
    maxSlots: 7,
  },
  // Future field types would be added here with their own database columns
  // date: {
  //   slots: ['tag8', 'tag9'] as const,
  //   maxSlots: 2,
  // },
  // number: {
  //   slots: ['tag10', 'tag11'] as const,
  //   maxSlots: 2,
  // },
} as const

// Currently supported field types
export const SUPPORTED_FIELD_TYPES = Object.keys(TAG_SLOT_CONFIG) as Array<
  keyof typeof TAG_SLOT_CONFIG
>

// All tag slots (for backward compatibility)
export const TAG_SLOTS = TAG_SLOT_CONFIG.text.slots

// Maximum number of tag slots for text type (for backward compatibility)
export const MAX_TAG_SLOTS = TAG_SLOT_CONFIG.text.maxSlots

// Type for tag slot names
export type TagSlot = (typeof TAG_SLOTS)[number]

// Helper function to get available slots for a field type
export function getSlotsForFieldType(fieldType: string): readonly string[] {
  const config = TAG_SLOT_CONFIG[fieldType as keyof typeof TAG_SLOT_CONFIG]
  if (!config) {
    return [] // Return empty array for unsupported field types - system will naturally handle this
  }
  return config.slots
}

// Helper function to get max slots for a field type
export function getMaxSlotsForFieldType(fieldType: string): number {
  const config = TAG_SLOT_CONFIG[fieldType as keyof typeof TAG_SLOT_CONFIG]
  if (!config) {
    return 0 // Return 0 for unsupported field types
  }
  return config.maxSlots
}
