import type { ForkDependentReconfig } from '@/lib/api/contracts/workspace-fork'
import { subBlockTypeForValueType } from '@/tools/param-shape'

/**
 * Which control the sync modal renders for a repointed custom block's input.
 *
 * Derived from `subBlockTypeForValueType` — the same function that decides what the field becomes
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
  switch (subBlockTypeForValueType(fieldType ?? '')) {
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

/**
 * Shown in place of a control for a field the sync modal cannot configure. States what the
 * sync does rather than what the modal can't: the target's uploaded files are carried across
 * untouched (see `replaceCustomBlockInputs`), so the field is safe to leave alone.
 */
export const CUSTOM_BLOCK_UNSUPPORTED_HINT = 'Uploaded in the workflow — kept as configured there'

/**
 * Whether the sync modal can actually put a value in this field.
 *
 * The Sync gate demands a value for every REQUIRED dependent, which is right for a field the
 * user can fill and a deadlock for one they cannot: a required `file[]` renders as a disabled
 * control, so the gate could never be satisfied and Sync stayed off forever — with the hint
 * telling the user to go set it in a workflow they could not reach.
 *
 * Excluding it is safe because the sync no longer clears it. The target keeps whatever it has
 * (see `replaceCustomBlockInputs`), and a genuinely missing value is still caught by the
 * block's own required-field validation at run/deploy time — the same fallback every other
 * unconfigured required field relies on.
 */
export function isForkSyncConfigurableField(
  field: Pick<ForkDependentReconfig, 'parentKind' | 'fieldType' | 'selectorKey'>
): boolean {
  return forkDependentControl(field) !== 'unsupported'
}

/**
 * The control the sync modal renders for one dependent field.
 *
 * `fieldType` means two different things depending on where the field came from, so the two
 * are classified separately rather than by one lookup that happens to agree:
 *  - a **custom-block input** declares a Start FIELD type (`string`, `boolean`, `file[]`),
 *    which {@link customBlockInputControl} maps through the canvas's own mapping;
 *  - every other no-selector dependent is a canvas SUB-BLOCK, whose own type says it.
 */
export function forkDependentControl(
  field: Pick<ForkDependentReconfig, 'parentKind' | 'fieldType' | 'selectorKey'>
): CustomBlockInputControl | 'selector' {
  if (field.selectorKey) return 'selector'
  if (field.parentKind === 'custom-block') return customBlockInputControl(field.fieldType)
  return field.fieldType === 'long-input' ? 'textarea' : 'input'
}
