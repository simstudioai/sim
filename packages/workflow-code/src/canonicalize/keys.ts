import {
  type BlockState,
  isReservedWorkflowBlockName,
  normalizeWorkflowBlockName,
  type Variable,
} from '@sim/workflow-types/workflow'
import type { CanonicalizeDiagnosticCode } from '../diagnostics/codes'
import { diagnostic } from '../diagnostics/factory'
import type { Diagnostic } from '../diagnostics/frame'
import type { BlockKey, VarKey } from '../model'
import type { VariableEntry } from './context'

interface BlockKeys {
  keyById: Map<string, BlockKey>
  /** The normalized names references resolve by: each is its winning block's key. */
  referenceableKeys: Set<BlockKey>
}

function smallestFreeSuffix(base: string, taken: ReadonlySet<string>): string {
  let n = 2
  while (taken.has(`${base}~${n}`)) n++
  return `${base}~${n}`
}

/**
 * Block keys. The key is the normalized name. When two stored
 * names normalize alike, the block the resolver binds the name to keeps the key: blocks are walked
 * in stored order and a newcomer takes over only from an incumbent whose name contains a dot
 * (`BlockResolver`). Every other block in the group becomes
 * `key~n` (smallest free n ≥ 2) with `E_CANON_LEGACY_NAME_COLLISION`.
 */
export function assignBlockKeys(
  blocks: Record<string, BlockState>,
  diagnostics: Diagnostic<CanonicalizeDiagnosticCode>[]
): BlockKeys {
  const entries = Object.entries(blocks)
  const winnerByName = new Map<string, string>()
  for (const [id, block] of entries) {
    const normalized = normalizeWorkflowBlockName(block.name)
    const incumbent = winnerByName.get(normalized)
    if (incumbent === undefined || blocks[incumbent].name.includes('.')) {
      winnerByName.set(normalized, id)
    }
  }

  const keyById = new Map<string, BlockKey>()
  const taken = new Set<string>(winnerByName.keys())
  for (const [id, block] of entries) {
    const normalized = normalizeWorkflowBlockName(block.name)
    if (winnerByName.get(normalized) === id) {
      keyById.set(id, normalized)
      if (isReservedWorkflowBlockName(normalized)) {
        diagnostics.push(
          diagnostic(
            'W_CANON_RESERVED_NAME',
            `Block name "${block.name}" normalizes to the reserved reference prefix "${normalized}"`,
            {
              blockKey: normalized,
            }
          )
        )
      }
      continue
    }
    const key = smallestFreeSuffix(normalized, taken)
    taken.add(key)
    keyById.set(id, key)
    diagnostics.push(
      diagnostic(
        'E_CANON_LEGACY_NAME_COLLISION',
        `Block name "${block.name}" normalizes to "${normalized}", which "${blocks[winnerByName.get(normalized) ?? id].name}" already resolves to; keyed "${key}" until renamed`,
        {
          blockKey: key,
        }
      )
    )
  }

  return { keyById, referenceableKeys: new Set(winnerByName.keys()) }
}

/**
 * Variable keys: the normalized variable name, with the same `~n` rule for a collision (the
 * first stored variable keeps the key, as the workflow resolver matches the first by name).
 */
export function assignVariableKeys(
  variables: Record<string, Variable>,
  diagnostics: Diagnostic<CanonicalizeDiagnosticCode>[]
): VariableEntry[] {
  const entries: VariableEntry[] = []
  const firstNames = new Set<string>()
  for (const variable of Object.values(variables)) {
    firstNames.add(normalizeWorkflowBlockName(variable.name))
  }
  const taken = new Set<string>(firstNames)
  const claimed = new Set<string>()
  for (const variable of Object.values(variables)) {
    const normalizedName = normalizeWorkflowBlockName(variable.name)
    let key: VarKey = normalizedName
    if (claimed.has(normalizedName)) {
      key = smallestFreeSuffix(normalizedName, taken)
      taken.add(key)
      diagnostics.push(
        diagnostic(
          'E_CANON_LEGACY_NAME_COLLISION',
          `Variable name "${variable.name}" normalizes to "${normalizedName}", which another variable already uses; keyed "${key}" until renamed`
        )
      )
    }
    claimed.add(normalizedName)
    entries.push({ id: variable.id, key, normalizedName })
  }
  return entries
}
