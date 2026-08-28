import { useMemo } from 'react'
import type { SelectorKey } from '@/lib/selectors/manifest'
import { summarizeNames } from '@/lib/workflows/subblocks/display'
import type { SubBlockConfig } from '@/blocks/types'
import {
  type SelectorClientContext,
  useSelectorOptionDetail,
  useSelectorOptionMap,
  useSelectorOptions,
} from '@/hooks/queries/selectors'

interface SelectorDisplayNameArgs {
  subBlock?: SubBlockConfig
  value: unknown
  workflowId?: string
  oauthCredential?: string
  domain?: string
  projectId?: string
  planId?: string
  teamId?: string
  knowledgeBaseId?: string
  baseId?: string
  datasetId?: string
  serviceDeskId?: string
  siteId?: string
  collectionId?: string
  spreadsheetId?: string
  fileId?: string
}

export function useSelectorDisplayName({
  subBlock,
  value,
  workflowId,
  oauthCredential,
  domain,
  projectId,
  planId,
  teamId,
  knowledgeBaseId,
  baseId,
  datasetId,
  serviceDeskId,
  siteId,
  collectionId,
  spreadsheetId,
  fileId,
}: SelectorDisplayNameArgs) {
  /*
   * A `multiSelect` selector stores an array. This used to read only a lone
   * string, so a multi-select channel or folder resolved to nothing and the card
   * fell through to the `-` sentinel — visible both in its field row and, once
   * sentences landed, mid-prose.
   */
  const selectedIds = useMemo(() => {
    if (typeof value === 'string') return value.length > 0 ? [value] : []
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    }
    return []
  }, [value])

  /* The detail endpoint fetches one option, so it only helps a single selection;
     a multi-selection resolves out of the list the query already returns. */
  const detailId = selectedIds.length === 1 ? selectedIds[0] : undefined
  const hasSelection = selectedIds.length > 0

  const resolution = useMemo(() => {
    if (!subBlock?.selectorKey || !hasSelection) return null
    const context: SelectorClientContext = {
      workflowId,
      oauthCredential,
      domain,
      projectId,
      planId,
      teamId,
      knowledgeBaseId,
      baseId,
      datasetId,
      serviceDeskId,
      siteId,
      collectionId,
      spreadsheetId,
      fileId,
      mimeType: subBlock.mimeType,
    }
    return { key: subBlock.selectorKey, context }
  }, [
    subBlock,
    hasSelection,
    workflowId,
    oauthCredential,
    domain,
    projectId,
    planId,
    teamId,
    knowledgeBaseId,
    baseId,
    datasetId,
    serviceDeskId,
    siteId,
    collectionId,
    spreadsheetId,
    fileId,
  ])

  const key = resolution?.key
  const context = resolution?.context ?? {}
  const enabled = Boolean(key && hasSelection)
  const resolvedKey: SelectorKey = (key ?? 'slack.channels') as SelectorKey
  const resolvedContext = enabled ? context : {}

  const { data: options = [], isFetching: listLoading } = useSelectorOptions(resolvedKey, {
    context: resolvedContext,
    enabled,
  })

  const { data: detailOption, isLoading: detailLoading } = useSelectorOptionDetail(resolvedKey, {
    context: resolvedContext,
    detailId: enabled ? detailId : undefined,
    enabled,
  })

  const optionMap = useSelectorOptionMap(options, detailOption ?? undefined)

  /* All or nothing: a partial resolution would silently drop selections, and the
     caller's raw-value fallback at least shows every id. */
  const labels = selectedIds.map((id) => optionMap.get(id)?.label)
  const displayName =
    hasSelection && labels.every((label): label is string => Boolean(label))
      ? summarizeNames(labels)
      : null

  return {
    displayName: enabled ? displayName : null,
    isLoading: enabled ? listLoading || detailLoading : false,
  }
}
