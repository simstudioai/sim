import { useMemo } from 'react'
import type { SubBlockConfig } from '@/blocks/types'
import { resolveSelectorForSubBlock } from '@/hooks/selectors/resolution'
import type { SelectorKey } from '@/hooks/selectors/types'
import {
  useSelectorOptionDetail,
  useSelectorOptionMap,
  useSelectorOptions,
} from '@/hooks/selectors/use-selector-query'

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
  const detailId = typeof value === 'string' && value.length > 0 ? value : undefined

  const resolution = useMemo(() => {
    if (!subBlock || !detailId) return null
    return resolveSelectorForSubBlock(subBlock, {
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
    })
  }, [
    subBlock,
    detailId,
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
  const enabled = Boolean(key && detailId)
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
  const displayName = detailId ? (optionMap.get(detailId)?.label ?? null) : null

  return {
    displayName: enabled ? displayName : null,
    isLoading: enabled ? listLoading || detailLoading : false,
  }
}
