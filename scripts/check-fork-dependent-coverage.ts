/**
 * Fails when a sub-block that a workspace-fork sync can invalidate has no way to be
 * reconfigured at sync time.
 *
 * `clearDependentsOnRemap` wipes every transitive dependent of a remapped parent, and a
 * credential mapped between environments changes value on EVERY sync — so a dependent the
 * sync modal cannot offer is re-emptied on every push, and setting it in the target does not
 * survive. That was the state of 36 fields before this check existed.
 *
 * A dependent is covered when it is one of:
 *   - `selectorKey`      — a registered selector, browsable against the target's parent
 *   - a canonical pair member whose basic side is a selector — verbatim by policy
 *   - a preserved name-based type — the remap deliberately keeps it
 *   - `short-input` / `long-input` — the modal renders a text field
 *
 * There is no baseline: the set is empty today and must stay empty. Adding a `dependsOn`
 * under a credential/KB/table anchor now means choosing one of the four.
 */

import { getAllBlocks } from '../apps/sim/blocks/registry'
import { getTransitiveSubBlockDependents } from '../apps/sim/lib/workflows/subblocks/dependencies'

/** Sub-block types a fork mapping entry is anchored on. Mirrors `PARENT_ANCHORS`. */
const ANCHOR_TYPES = new Set(['oauth-input', 'knowledge-base-selector', 'table-selector'])

/** Mirrors `PRESERVED_NAME_BASED_DEPENDENT_TYPES` in `remap-references.ts`. */
const PRESERVED_TYPES = new Set(['knowledge-tag-filters', 'document-tag-entry'])

/** Mirrors `TEXT_DEPENDENT_TYPES` in `dependent-reconfigs.ts`. */
const TEXT_TYPES = new Set(['short-input', 'long-input'])

interface Uncovered {
  block: string
  subBlock: string
  type: string
  anchor: string
}

function main(): void {
  const uncovered = new Map<string, Uncovered>()
  let covered = 0

  for (const block of getAllBlocks()) {
    const subBlocks = (block.subBlocks ?? []) as Array<Record<string, any>>
    const byId = new Map(subBlocks.filter((sub) => sub.id).map((sub) => [sub.id as string, sub]))
    const canonicalWithSelector = new Set(
      subBlocks
        .filter((sub) => sub.canonicalParamId && sub.selectorKey)
        .map((sub) => sub.canonicalParamId as string)
    )

    for (const anchor of subBlocks) {
      if (!ANCHOR_TYPES.has(anchor.type) || !anchor.id) continue
      for (const dependent of getTransitiveSubBlockDependents(subBlocks as any, [anchor.id])) {
        const config = byId.get(dependent.subBlockId)
        if (!config?.id) continue
        if (
          config.selectorKey ||
          (config.canonicalParamId && canonicalWithSelector.has(config.canonicalParamId)) ||
          PRESERVED_TYPES.has(config.type) ||
          TEXT_TYPES.has(config.type)
        ) {
          covered++
          continue
        }
        uncovered.set(`${block.type}.${config.id}`, {
          block: block.type,
          subBlock: config.id,
          type: config.type,
          anchor: anchor.id,
        })
      }
    }
  }

  if (uncovered.size === 0) {
    console.log(`Fork dependent coverage: ${covered} dependents, all reconfigurable at sync time.`)
    return
  }

  console.error(
    `Fork dependent coverage: ${uncovered.size} sub-block(s) a fork sync clears with no way to reconfigure them.\n`
  )
  for (const entry of uncovered.values()) {
    console.error(`  ${entry.block}.${entry.subBlock} (${entry.type}) depends on ${entry.anchor}`)
  }
  console.error(
    [
      '',
      'Each needs one of:',
      "  - selectorKey: '<key>'   register the list in hooks/selectors/ (the usual answer for a picker)",
      '  - a canonical pair whose basic member is a selector (the manual member is verbatim)',
      '  - type short-input / long-input, which the sync modal renders as a text field',
      '  - a preserved name-based type in PRESERVED_NAME_BASED_DEPENDENT_TYPES',
      '',
      'Otherwise the field is wiped on every sync and cannot be set anywhere that sticks.',
    ].join('\n')
  )
  process.exit(1)
}

main()
