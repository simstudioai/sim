/**
 * Which control the sync modal renders for a repointed custom block's input, derived from the
 * field type its Start block declares.
 *
 * Mirrors `subBlockTypeForField` in `@/blocks/custom/build-config`, which decides the same thing
 * for the canvas — a field the user configures here must read and behave the way it will once
 * the block is open in the editor.
 */
export type CustomBlockInputControl = 'switch' | 'textarea' | 'input'

export function customBlockInputControl(fieldType: string | undefined): CustomBlockInputControl {
  switch (fieldType) {
    // Stored as a real boolean on the canvas (its sub-block is a `switch`), so it must be
    // toggled here rather than typed — a text field would persist the string `'true'`.
    case 'boolean':
      return 'switch'
    // Authored as JSON and parsed by the executor before the child receives it.
    case 'object':
    case 'array':
      return 'textarea'
    default:
      return 'input'
  }
}

/**
 * The two string values a boolean input round-trips through the string-valued dependent store.
 * `replaceCustomBlockInputs` turns them back into a real boolean on apply, because the canvas
 * stores a `switch` sub-block as one.
 */
export const CUSTOM_BLOCK_BOOLEAN_TRUE = 'true'
export const CUSTOM_BLOCK_BOOLEAN_FALSE = 'false'

/** Segments for a boolean input, in the order a switch reads them. */
export const CUSTOM_BLOCK_BOOLEAN_OPTIONS = [
  { value: CUSTOM_BLOCK_BOOLEAN_TRUE, label: 'True' },
  { value: CUSTOM_BLOCK_BOOLEAN_FALSE, label: 'False' },
] as const
