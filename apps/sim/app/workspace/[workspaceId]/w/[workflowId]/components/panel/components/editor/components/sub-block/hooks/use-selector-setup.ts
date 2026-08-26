'use client'

import { useMemo } from 'react'
import { generateShortId } from '@sim/utils/id'
import { useParams } from 'next/navigation'
import type { SubBlockConfig } from '@/blocks/types'
import { usePersonalEnvironment } from '@/hooks/queries/environment'
import {
  applySelectorDependenciesToContext,
  resolveSelectorDependencyValues,
} from '@/hooks/selectors/context-resolution'
import { getSelectorDefinition } from '@/hooks/selectors/registry'
import type { SelectorContext, SelectorKey } from '@/hooks/selectors/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useDependsOnGate } from './use-depends-on-gate'
import { useSubBlockValue } from './use-sub-block-value'

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
  const params = useParams()
  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId)
  const workflowId = (params?.workflowId as string) || activeWorkflowId || ''
  const workspaceId = (params?.workspaceId as string) || ''

  const { data: envVariables = {} } = usePersonalEnvironment()

  const selectorKey = (subBlock.selectorKey ?? null) as SelectorKey | null
  const serverResolvedContextFields = useMemo(
    () =>
      new Set<keyof SelectorContext>(
        selectorKey ? (getSelectorDefinition(selectorKey).serverResolvedContextFields ?? []) : []
      ),
    [selectorKey]
  )

  const { finalDisabled, dependencyValues, canonicalIndex } = useDependsOnGate(
    blockId,
    subBlock,
    opts
  )

  const [impersonateUserEmail] = useSubBlockValue<string | null>(blockId, 'impersonateUserEmail')

  const selectorCacheScope = useMemo(
    () => generateShortId(),
    [blockId, subBlock.id, selectorKey, dependencyValues]
  )

  const resolvedDependencyValues = useMemo(() => {
    return resolveSelectorDependencyValues({
      dependencyValues,
      personalEnvironment: envVariables,
      canonicalIndex,
      serverResolvedContextFields,
    })
  }, [dependencyValues, envVariables, canonicalIndex, serverResolvedContextFields])

  const selectorContext = useMemo<SelectorContext>(() => {
    const context: SelectorContext = {
      workflowId,
      workspaceId: workspaceId || undefined,
      selectorCacheScope,
      mimeType: subBlock.mimeType,
    }

    applySelectorDependenciesToContext({
      context,
      dependencyValues: resolvedDependencyValues,
      canonicalIndex,
    })

    if (context.oauthCredential && impersonateUserEmail) {
      context.impersonateUserEmail = impersonateUserEmail
    }

    return context
  }, [
    resolvedDependencyValues,
    canonicalIndex,
    workflowId,
    workspaceId,
    selectorCacheScope,
    subBlock.mimeType,
    impersonateUserEmail,
  ])

  return {
    selectorKey,
    selectorContext,
    allowSearch: subBlock.selectorAllowSearch ?? true,
    disabled: finalDisabled || !subBlock.selectorKey,
    dependencyValues: resolvedDependencyValues,
  }
}
