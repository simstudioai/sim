export const TAG_SLOT_CONFIG = {
  text: {
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
