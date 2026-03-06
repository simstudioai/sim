'use client'

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import type { SubBlockConfig } from '@/blocks/types'
import type { SelectorContext, SelectorKey } from '@/hooks/selectors/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useDependsOnGate } from './use-depends-on-gate'

/**
 * Resolves all selector configuration from a sub-block's declarative properties.
 *
 * Builds a `SelectorContext` by mapping each `dependsOn` entry through the
 * canonical index to its `canonicalParamId`, which maps directly to
 * `SelectorContext` field names (e.g. `siteId`, `teamId`, `collectionId`).
 * The one special case is `oauthCredential` which maps to `credentialId`.
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

  const { finalDisabled, dependencyValues, canonicalIndex } = useDependsOnGate(
    blockId,
    subBlock,
    opts
  )

  const selectorContext = useMemo<SelectorContext>(() => {
    const context: SelectorContext = {
      workflowId,
      mimeType: subBlock.mimeType,
    }

    for (const [depKey, value] of Object.entries(dependencyValues)) {
      if (value === null || value === undefined) continue
      const strValue = String(value)
      if (!strValue) continue

      const canonicalParamId = canonicalIndex.canonicalIdBySubBlockId[depKey] ?? depKey

      if (canonicalParamId === 'oauthCredential') {
        context.credentialId = strValue
      } else {
        const contextField = CANONICAL_TO_CONTEXT[canonicalParamId]
        if (contextField) {
          context[contextField] = strValue
        }
      }
    }

    return context
  }, [dependencyValues, canonicalIndex, workflowId, subBlock.mimeType])

  return {
    selectorKey: (subBlock.selectorKey ?? null) as SelectorKey | null,
    selectorContext,
    allowSearch: subBlock.selectorAllowSearch ?? true,
    disabled: finalDisabled || !subBlock.selectorKey,
    dependencyValues,
  }
}

/**
 * Maps canonical param IDs to SelectorContext field names.
 *
 * Most canonical param IDs match their SelectorContext field directly (e.g. `siteId` → `siteId`).
 * Aliased entries handle cases where `canonicalParamId` was prefixed with `selected_` to avoid
 * clashing with a subBlock `id` of the same name.
 */
const CANONICAL_TO_CONTEXT: Record<string, keyof SelectorContext> = {
  credentialId: 'credentialId',
  domain: 'domain',
  teamId: 'teamId',
  projectId: 'projectId',
  knowledgeBaseId: 'knowledgeBaseId',
  planId: 'planId',
  siteId: 'siteId',
  collectionId: 'collectionId',
  spreadsheetId: 'spreadsheetId',
  fileId: 'fileId',
  baseId: 'baseId',
  datasetId: 'datasetId',
  serviceDeskId: 'serviceDeskId',
  selected_baseId: 'baseId',
  selected_datasetId: 'datasetId',
  selected_serviceDeskId: 'serviceDeskId',
  selected_planId: 'planId',
}
