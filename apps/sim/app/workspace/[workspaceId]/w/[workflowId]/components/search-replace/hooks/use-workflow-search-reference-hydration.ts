import { useMemo } from 'react'
import { getWorkflowSearchMatchResourceGroupKey } from '@/lib/workflows/search-replace/resource-resolvers'
import type { WorkflowSearchMatch } from '@/lib/workflows/search-replace/types'
import { usePersonalEnvironment, useWorkspaceEnvironment } from '@/hooks/queries/environment'
import {
  useWorkflowSearchKnowledgeBaseDetails,
  useWorkflowSearchOAuthCredentialDetails,
  useWorkflowSearchSelectorDetails,
} from '@/hooks/queries/workflow-search-replace'

export interface HydratedWorkflowSearchMatch extends WorkflowSearchMatch {
  displayLabel: string
  resolved: boolean
  inaccessible: boolean
}

interface UseWorkflowSearchReferenceHydrationOptions {
  matches: WorkflowSearchMatch[]
  workspaceId?: string
  workflowId?: string
}

export function useWorkflowSearchReferenceHydration({
  matches,
  workspaceId,
  workflowId,
}: UseWorkflowSearchReferenceHydrationOptions) {
  const oauthDetails = useWorkflowSearchOAuthCredentialDetails(matches, workflowId)
  const knowledgeDetails = useWorkflowSearchKnowledgeBaseDetails(matches)
  const selectorDetails = useWorkflowSearchSelectorDetails(matches)
  const { data: personalEnvironment } = usePersonalEnvironment()
  const { data: workspaceEnvironment } = useWorkspaceEnvironment(workspaceId ?? '')

  return useMemo<HydratedWorkflowSearchMatch[]>(() => {
    const labelByRawValue = new Map<
      string,
      { label: string; resolved: boolean; inaccessible: boolean }
    >()
    const labelByResourceValue = new Map<
      string,
      { label: string; resolved: boolean; inaccessible: boolean }
    >()

    const setResolvedLabel = (query: (typeof oauthDetails)[number]) => {
      if (!query.data) return
      const value = {
        label: query.data.label,
        resolved: query.data.resolved,
        inaccessible: query.data.inaccessible,
      }
      labelByRawValue.set(query.data.matchRawValue, value)
      if (query.data.resourceGroupKey) {
        labelByResourceValue.set(
          `${query.data.resourceGroupKey}:${query.data.matchRawValue}`,
          value
        )
      }
    }

    oauthDetails.forEach(setResolvedLabel)
    knowledgeDetails.forEach(setResolvedLabel)
    selectorDetails.forEach(setResolvedLabel)

    const personalKeys = new Set(Object.keys(personalEnvironment ?? {}))
    const workspaceKeys = new Set(Object.keys(workspaceEnvironment?.workspace ?? {}))

    return matches.map((match) => {
      if (match.kind === 'text') {
        return {
          ...match,
          displayLabel: match.rawValue,
          resolved: true,
          inaccessible: false,
        }
      }

      if (match.kind === 'environment') {
        const key = match.resource?.key ?? match.searchText
        return {
          ...match,
          displayLabel: `{{${key}}}`,
          resolved: personalKeys.has(key) || workspaceKeys.has(key),
          inaccessible: false,
        }
      }

      const resourceValueKey = `${getWorkflowSearchMatchResourceGroupKey(match)}:${match.rawValue}`
      const resolved =
        labelByResourceValue.get(resourceValueKey) ??
        (match.resource?.selectorKey ? undefined : labelByRawValue.get(match.rawValue))
      return {
        ...match,
        displayLabel: resolved?.label ?? match.rawValue,
        resolved: resolved?.resolved ?? false,
        inaccessible: resolved?.inaccessible ?? false,
      }
    })
  }, [
    knowledgeDetails,
    matches,
    oauthDetails,
    personalEnvironment,
    selectorDetails,
    workspaceEnvironment,
  ])
}
