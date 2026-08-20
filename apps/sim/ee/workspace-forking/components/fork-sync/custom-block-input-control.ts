import { subBlockTypeForField } from '@/blocks/custom/build-config'

/**
 * Which control the sync modal renders for a repointed custom block's input.
 *
 * Derived from `subBlockTypeForField` — the same function that decides what the field becomes
 * on the canvas — rather than re-reading the raw field type. The modal cannot reuse the canvas
 * sub-block renderer (that one is bound to the workflow store, by workflow and block id), so it
 * draws its own controls; taking the field's KIND from one place is what stops the two drifting
 * when a field type is added. Re-deriving it is how `file[]` came to render as a text box.
 *
 * `unsupported` is a real outcome, not a fallback: a `file[]` input is an upload on the canvas,
 * and there is nothing meaningful to type for it here. A text box would write a plain string
 * into a field that expects file references.
 */
export type CustomBlockInputControl = 'switch' | 'textarea' | 'input' | 'unsupported'

export function customBlockInputControl(fieldType: string | undefined): CustomBlockInputControl {
  switch (subBlockTypeForField(fieldType ?? '')) {
    // Stored as a real boolean on the canvas, so it must be toggled rather than typed — a text
    // field would persist the string `'true'`.
    case 'switch':
      return 'switch'
    // A JSON editor on the canvas. The modal has no editor, but the value is the same JSON
    // string either way and the executor parses it before the child receives it.
    case 'code':
      return 'textarea'
    case 'file-upload':
      return 'unsupported'
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

/**
 * The unset value. Distinct from `false`: it means the sync writes no value at all, so the
 * target workflow's Start field keeps whatever default it declares.
 */
export const CUSTOM_BLOCK_BOOLEAN_UNSET = ''

const BOOLEAN_VALUE_OPTIONS = [
  { value: CUSTOM_BLOCK_BOOLEAN_TRUE, label: 'True' },
  { value: CUSTOM_BLOCK_BOOLEAN_FALSE, label: 'False' },
] as const

const BOOLEAN_OPTIONAL_OPTIONS = [
  ...BOOLEAN_VALUE_OPTIONS,
  // Trails the two real values: choosing one is the common action, returning to the default
  // is the escape hatch. Without it a single click would permanently pin an optional flag,
  // since a two-segment switch has no transition back to "nothing selected".
  { value: CUSTOM_BLOCK_BOOLEAN_UNSET, label: 'Default' },
] as const

/**
 * Segments for a boolean input. An OPTIONAL field gets a third `Default` segment so the user
 * can stop overriding the child workflow's declared default; a REQUIRED one does not, because
 * the Sync gate demands a value and "unset" is not a state it can end in.
 */
export function customBlockBooleanOptions(required: boolean) {
  return required ? BOOLEAN_VALUE_OPTIONS : BOOLEAN_OPTIONAL_OPTIONS
}

/** Shown in place of a control for a field the sync modal cannot configure. */
export const CUSTOM_BLOCK_UNSUPPORTED_HINT = 'Set in the workflow — files cannot be configured here'
