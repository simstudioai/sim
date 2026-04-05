import { useCallback, useMemo } from 'react'
import type { CanonicalModeOverrides } from '@/lib/workflows/subblocks/visibility'
import { buildCanonicalIndex, resolveDependencyValue } from '@/lib/workflows/subblocks/visibility'
import type { SubBlockConfig } from '@/blocks/types'
import { useWorkspaceCredential } from '@/hooks/queries/credentials'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

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
  canonicalModeOverrides?: CanonicalModeOverrides
): Set<string> {
  const reactiveSubBlock = useMemo(() => subBlocks.find((sb) => sb.reactiveCondition), [subBlocks])
  const reactiveCond = reactiveSubBlock?.reactiveCondition

  const canonicalIndex = useMemo(() => buildCanonicalIndex(subBlocks), [subBlocks])

  // Resolve watchFields through canonical index to get the active credential value
  const watchedCredentialId = useSubBlockStore(
    useCallback(
      (state) => {
        if (!reactiveCond || !activeWorkflowId) return ''
        const blockValues = state.workflowValues[activeWorkflowId]?.[blockId] ?? {}
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
    if (!reactiveSubBlock || !reactiveCond) return hidden

    const conditionMet = credential?.type === reactiveCond.requiredType
    if (!conditionMet) {
      hidden.add(reactiveSubBlock.id)
    }
    return hidden
  }, [reactiveSubBlock, reactiveCond, credential?.type])
}
