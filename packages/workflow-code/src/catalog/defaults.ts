/**
 * The editor defaults of a block: the value canvas creation writes into each subBlock of a new
 * block (`createBlockFromParams` with no inputs, which `MaterializeHooks.initBlock` wraps). A
 * param omitted in source means this value (DESIGN.md "Defaults"), and the printer omits a stored
 * value equal to it.
 *
 * Creation seeds each subBlock id once, from its first declaration: a visible, editable field
 * gets its `value()` thunk's result for a block with no values (`valueDefault.constant`, or a
 * computed thunk's `initial`); a hidden field gets its `defaultValue`; a read-only field gets
 * nothing. A thunk that mints a fresh value per call (a webhook token) has no static default;
 * a block created from source keeps the value `initBlock` minted (`mintsFreshValue`). Every
 * registry default is a string, number or boolean; anything else is not treated as a default, so
 * it always prints.
 *
 * Creation here means creation with no permission group, as `initBlock` creates. The editor also
 * seeds an agent's `model` from the caller's permission group default, a per-caller value no
 * catalog can carry. A block created from source gets only the model its source states, and a
 * stored group default prints like any other value that is not an editor default.
 */

import type { Json, SubBlockId } from '../model'
import type { CatalogBlock, CatalogSubBlock } from './types'

export type EditorDefault = string | number | boolean

const defaultsByBlock = new WeakMap<CatalogBlock, ReadonlyMap<SubBlockId, EditorDefault>>()

function scalar(value: Json | undefined): EditorDefault | undefined {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : undefined
}

/** The value creation seeds through this declaration, if any (`editorDefaults` applies first-wins). */
export function subBlockEditorDefault(subBlock: CatalogSubBlock): EditorDefault | undefined {
  if (subBlock.hidden) return scalar(subBlock.defaultValue)
  if (subBlock.readOnly) return undefined
  const thunk = subBlock.valueDefault
  if (!thunk) return undefined
  return scalar('constant' in thunk ? thunk.constant : thunk.initial)
}

/**
 * Whether creation seeds this declaration with a value computed per creation (a `value()` thunk
 * with no stable `initial`, such as a webhook token): it has no editor default, so source cannot
 * state it, and a block created from source keeps the value `MaterializeHooks.initBlock` computed,
 * exactly as a canvas-created block does.
 */
export function mintsFreshValue(subBlock: CatalogSubBlock): boolean {
  if (subBlock.hidden || subBlock.readOnly) return false
  const thunk = subBlock.valueDefault
  return thunk !== undefined && 'computed' in thunk && thunk.initial === undefined
}

/** Every subBlock id of `block` that creation seeds, with the value it seeds. */
export function editorDefaults(block: CatalogBlock): ReadonlyMap<SubBlockId, EditorDefault> {
  const cached = defaultsByBlock.get(block)
  if (cached) return cached
  const defaults = new Map<SubBlockId, EditorDefault>()
  const seen = new Set<SubBlockId>()
  for (const subBlock of block.subBlocks) {
    if (seen.has(subBlock.id)) continue
    seen.add(subBlock.id)
    const value = subBlockEditorDefault(subBlock)
    if (value !== undefined) defaults.set(subBlock.id, value)
  }
  defaultsByBlock.set(block, defaults)
  return defaults
}
