'use client'

import { useMemo } from 'react'
import {
  buildSelectorContextFromValues,
  getSelectorContextSubBlocks,
} from '@/lib/selectors/context'
import type { SelectorKey } from '@/lib/selectors/manifest'
import { useWorkflowScope } from '@/app/workspace/[workspaceId]/providers/workflow-scope-provider'
import type { SubBlockConfig } from '@/blocks/types'
import type { SelectorClientContext } from '@/hooks/queries/selectors'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useDependsOnGate } from './use-depends-on-gate'

const EMPTY_SELECTOR_VALUES: Record<string, unknown> = {}

/**
 * Resolves all selector configuration from a sub-block's declarative properties.
 *
 * Builds a `SelectorContext` by mapping each `dependsOn` entry through the
 * canonical index to its `canonicalParamId`, which maps directly to
 * `SelectorContext` field names (e.g. `siteId`, `teamId`, `oauthCredential`).
 *
 * @param blockId - The block containing the selector sub-block
 * @param subBlock - The sub-block config (must have `selectorKey` set)
 * @param opts - Standard disabled/preview/previewContextValues options
 * @returns Everything `SelectorCombobox` needs: key, context, disabled, allowSearch, plus raw dependency values
 */
export function useSelectorSetup(
  blockId: string,
  subBlock: SubBlockConfig,
  opts?: { disabled?: boolean; isPreview?: boolean; previewContextValues?: Record<string, any> }
) {
  const scope = useWorkflowScope()
  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId)
  const workflowId = scope.workflowId ?? activeWorkflowId ?? ''
  const workspaceId = scope.workspaceId

  const {
    finalDisabled,
    dependencyValues,
    canonicalIndex,
    contextConfigs,
    canonicalModeOverrides,
    triggerSurface,
    dependsOn,
  } = useDependsOnGate(blockId, subBlock, opts)
  const liveValues = useSubBlockStore((state) =>
    activeWorkflowId
      ? (state.workflowValues[activeWorkflowId]?.[blockId] ?? EMPTY_SELECTOR_VALUES)
      : EMPTY_SELECTOR_VALUES
  )
  const selectorValues = opts?.previewContextValues ?? liveValues

  const selectorKey = (subBlock.selectorKey ?? null) as SelectorKey | null
  const selectorContext = useMemo<SelectorClientContext>(() => {
    if (!selectorKey) return { workflowId, workspaceId: workspaceId || undefined }
    const activeConfigs = getSelectorContextSubBlocks(
      contextConfigs,
      selectorValues,
      triggerSurface
    )
    return {
      ...buildSelectorContextFromValues({
        selectorKey,
        contextConfigs: activeConfigs,
        values: selectorValues,
        dependsOn,
        canonicalIndex,
        canonicalModes: canonicalModeOverrides,
        staticContext: { mimeType: subBlock.mimeType },
      }),
      workflowId,
      workspaceId: workspaceId || undefined,
    }
  }, [
    selectorKey,
    contextConfigs,
    canonicalIndex,
    canonicalModeOverrides,
    dependsOn,
    selectorValues,
    workflowId,
    workspaceId,
    subBlock.mimeType,
    triggerSurface,
  ])

  return {
    selectorKey,
    selectorContext,
    allowSearch: subBlock.selectorAllowSearch ?? true,
    disabled: finalDisabled || !subBlock.selectorKey,
    dependencyValues,
  }
}
