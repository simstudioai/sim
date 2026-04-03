'use client'

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { SELECTOR_CONTEXT_FIELDS } from '@/lib/workflows/subblocks/context'
import type { SubBlockConfig } from '@/blocks/types'
import { extractEnvVarName, isEnvVarReference, isReference } from '@/executor/constants'
import type { SelectorContext, SelectorKey } from '@/hooks/selectors/types'
import { useEnvironmentStore } from '@/stores/settings/environment'
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

  const envVariables = useEnvironmentStore((s) => s.variables)

  const { finalDisabled, dependencyValues, canonicalIndex } = useDependsOnGate(
    blockId,
    subBlock,
    opts
  )

  const [impersonateUserEmail] = useSubBlockValue<string | null>(blockId, 'impersonateUserEmail')

  const resolvedDependencyValues = useMemo(() => {
    const resolved: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(dependencyValues)) {
      if (value === null || value === undefined) {
        resolved[key] = value
        continue
      }
      const str = String(value)
      if (isEnvVarReference(str)) {
        const varName = extractEnvVarName(str)
        resolved[key] = envVariables[varName]?.value || undefined
      } else {
        resolved[key] = value
      }
    }
    return resolved
  }, [dependencyValues, envVariables])

  const selectorContext = useMemo<SelectorContext>(() => {
    const context: SelectorContext = {
      workflowId,
      mimeType: subBlock.mimeType,
    }

    for (const [depKey, value] of Object.entries(resolvedDependencyValues)) {
      if (value === null || value === undefined) continue
      const strValue = String(value)
      if (!strValue) continue
      if (isReference(strValue)) continue

      const canonicalParamId = canonicalIndex.canonicalIdBySubBlockId[depKey] ?? depKey
      if (SELECTOR_CONTEXT_FIELDS.has(canonicalParamId as keyof SelectorContext)) {
        context[canonicalParamId as keyof SelectorContext] = strValue
      }
    }

    if (context.oauthCredential && impersonateUserEmail) {
      context.impersonateUserEmail = impersonateUserEmail
    }

    return context
  }, [
    resolvedDependencyValues,
    canonicalIndex,
    workflowId,
    subBlock.mimeType,
    impersonateUserEmail,
  ])

  return {
    selectorKey: (subBlock.selectorKey ?? null) as SelectorKey | null,
    selectorContext,
    allowSearch: subBlock.selectorAllowSearch ?? true,
    disabled: finalDisabled || !subBlock.selectorKey,
    dependencyValues: resolvedDependencyValues,
  }
}
