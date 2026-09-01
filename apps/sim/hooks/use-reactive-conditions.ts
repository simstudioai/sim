import { useCallback, useMemo } from 'react'
import type { CanonicalModeOverrides } from '@/lib/workflows/subblocks/visibility'
import {
  buildCanonicalIndexForSurface,
  resolveDependencyValue,
} from '@/lib/workflows/subblocks/visibility'
import type { SubBlockConfig } from '@/blocks/types'
import { useWorkspaceCredential } from '@/hooks/queries/credentials'
import { EMPTY_BLOCK_SUBBLOCK_VALUES, useSubBlockStore } from '@/stores/workflows/subblock/store'

/**
 * Evaluates reactive conditions for subblocks. Always calls the same hooks
 * regardless of whether a reactive condition exists (Rules of Hooks).
 *
 * Returns a Set of subblock IDs that should be hidden.
 */
export function useReactiveConditions(
  subBlocks: SubBlockConfig[],
  blockId: string,
  activeWorkflowId: string | null,
  canonicalModeOverrides?: CanonicalModeOverrides,
  triggerSurface = false
): Set<string> {
  const reactiveSubBlocks = useMemo(
    () => subBlocks.filter((subBlock) => subBlock.reactiveCondition),
    [subBlocks]
  )
  const reactiveCond = reactiveSubBlocks[0]?.reactiveCondition

  for (const subBlock of reactiveSubBlocks) {
    if (
      subBlock.reactiveCondition &&
      reactiveCond &&
      subBlock.reactiveCondition.watchFields.join('\0') !== reactiveCond.watchFields.join('\0')
    ) {
      throw new Error('Reactive subblocks on the same block must watch identical credential fields')
    }
  }

  /**
   * Scoped so a trigger-mode block watches its own credential. The only shipped reactive
   * condition (`SERVICE_ACCOUNT_SUBBLOCKS`) watches `oauthCredential`, which on Gmail, Drive,
   * Sheets, Forms and Calendar spans both surfaces under different ids — unscoped, trigger mode
   * resolves it to the dormant action credential and fetches the wrong one.
   */
  const canonicalIndex = useMemo(
    () => buildCanonicalIndexForSurface(subBlocks, triggerSurface),
    [subBlocks, triggerSurface]
  )

  // Resolve watchFields through canonical index to get the active credential value
  const watchedCredentialId = useSubBlockStore(
    useCallback(
      (state) => {
        if (!reactiveCond || !activeWorkflowId) return ''
        const blockValues =
          state.workflowValues[activeWorkflowId]?.[blockId] ?? EMPTY_BLOCK_SUBBLOCK_VALUES
        for (const field of reactiveCond.watchFields) {
          const val = resolveDependencyValue(
            field,
            blockValues,
            canonicalIndex,
            canonicalModeOverrides
          )
          if (val && typeof val === 'string') return val
        }
        return ''
      },
      [reactiveCond, activeWorkflowId, blockId, canonicalIndex, canonicalModeOverrides]
    )
  )

  // Always call useWorkspaceCredential (stable hook count), disable when not needed
  const { data: credential } = useWorkspaceCredential(
    watchedCredentialId || undefined,
    Boolean(reactiveCond && watchedCredentialId)
  )

  return useMemo(() => {
    const hidden = new Set<string>()
    if (!reactiveCond) return hidden

    for (const subBlock of reactiveSubBlocks) {
      if (credential?.type !== subBlock.reactiveCondition?.requiredType) {
        hidden.add(subBlock.id)
      }
    }
    return hidden
  }, [reactiveSubBlocks, reactiveCond, credential?.type])
}
