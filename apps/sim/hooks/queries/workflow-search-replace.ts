import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import type { KnowledgeBaseData } from '@/lib/api/contracts/knowledge'
import type { Credential } from '@/lib/oauth'
import { stableStringifyWorkflowSearchValue } from '@/lib/workflows/search-replace/resource-resolvers'
import type {
  WorkflowSearchMatch,
  WorkflowSearchReplacementOption,
} from '@/lib/workflows/search-replace/types'
import {
  fetchKnowledgeBase,
  fetchKnowledgeBases,
  knowledgeKeys,
} from '@/hooks/queries/kb/knowledge'
import {
  fetchOAuthCredentialDetail,
  fetchOAuthCredentials,
} from '@/hooks/queries/oauth/oauth-credentials'
import { getSelectorDefinition } from '@/hooks/selectors/registry'
import type { SelectorKey, SelectorOption } from '@/hooks/selectors/types'

export interface WorkflowSearchResolvedResource {
  matchRawValue: string
  resourceGroupKey?: string
  label: string
  resolved: boolean
  inaccessible: boolean
}

export const workflowSearchReplaceKeys = {
  all: ['workflow-search-replace'] as const,
  resourceDetails: () => [...workflowSearchReplaceKeys.all, 'resource-detail'] as const,
  oauthDetails: (workflowId?: string) =>
    [...workflowSearchReplaceKeys.resourceDetails(), 'oauth', workflowId ?? ''] as const,
  oauthDetail: (credentialId?: string, workflowId?: string) =>
    [...workflowSearchReplaceKeys.oauthDetails(workflowId), credentialId ?? ''] as const,
  replacementOptions: () => [...workflowSearchReplaceKeys.all, 'replacement-options'] as const,
  oauthReplacementOptions: (providerId?: string, workspaceId?: string, workflowId?: string) =>
    [
      ...workflowSearchReplaceKeys.replacementOptions(),
      'oauth',
      providerId ?? '',
      workspaceId ?? '',
      workflowId ?? '',
    ] as const,
  knowledgeDetails: () => [...workflowSearchReplaceKeys.resourceDetails(), 'knowledge'] as const,
  knowledgeDetail: (knowledgeBaseId?: string) =>
    [...workflowSearchReplaceKeys.knowledgeDetails(), knowledgeBaseId ?? ''] as const,
  knowledgeReplacementOptions: (workspaceId?: string) =>
    [...workflowSearchReplaceKeys.replacementOptions(), 'knowledge', workspaceId ?? ''] as const,
  selectorDetails: () => [...workflowSearchReplaceKeys.resourceDetails(), 'selector'] as const,
  selectorDetail: (selectorKey?: string, contextKey?: string, value?: string) =>
    [
      ...workflowSearchReplaceKeys.selectorDetails(),
      selectorKey ?? '',
      contextKey ?? '',
      value ?? '',
    ] as const,
  selectorReplacementOptions: (selectorKey?: string, contextKey?: string) =>
    [
      ...workflowSearchReplaceKeys.replacementOptions(),
      'selector',
      selectorKey ?? '',
      contextKey ?? '',
    ] as const,
}

function uniqueMatches(
  matches: WorkflowSearchMatch[],
  kind: WorkflowSearchMatch['kind']
): WorkflowSearchMatch[] {
  const seen = new Set<string>()
  return matches.filter((match) => {
    if (match.kind !== kind || !match.rawValue || seen.has(match.rawValue)) return false
    seen.add(match.rawValue)
    return true
  })
}

function selectorContextKey(match: WorkflowSearchMatch): string {
  return stableStringifyWorkflowSearchValue(match.resource?.selectorContext ?? {})
}

function uniqueSelectorDetailMatches(matches: WorkflowSearchMatch[]): WorkflowSearchMatch[] {
  const seen = new Set<string>()
  return matches.filter((match) => {
    const selectorKey = match.resource?.selectorKey
    if (!selectorKey || !match.rawValue) return false

    const key = `${selectorKey}:${selectorContextKey(match)}:${match.rawValue}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function uniqueSelectorOptionGroups(matches: WorkflowSearchMatch[]): WorkflowSearchMatch[] {
  const seen = new Set<string>()
  return matches.filter((match) => {
    const selectorKey = match.resource?.selectorKey
    if (!selectorKey) return false

    const key = `${match.kind}:${selectorKey}:${selectorContextKey(match)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function useWorkflowSearchOAuthCredentialDetails(
  matches: WorkflowSearchMatch[],
  workflowId?: string
) {
  const oauthMatches = useMemo(() => uniqueMatches(matches, 'oauth-credential'), [matches])

  return useQueries({
    queries: oauthMatches.map((match) => ({
      queryKey: workflowSearchReplaceKeys.oauthDetail(match.rawValue, workflowId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchOAuthCredentialDetail(match.rawValue, workflowId, signal),
      enabled: Boolean(match.rawValue),
      staleTime: 60 * 1000,
      select: (credentials: Credential[]): WorkflowSearchResolvedResource => {
        const credential = credentials[0]
        return {
          matchRawValue: match.rawValue,
          resourceGroupKey: match.resource?.resourceGroupKey,
          label: credential?.name ?? `OAuth credential ${match.rawValue.slice(0, 8)}`,
          resolved: Boolean(credential?.name),
          inaccessible: credentials.length === 0,
        }
      },
    })),
  })
}

export function useWorkflowSearchKnowledgeBaseDetails(matches: WorkflowSearchMatch[]) {
  const knowledgeMatches = useMemo(() => uniqueMatches(matches, 'knowledge-base'), [matches])

  return useQueries({
    queries: knowledgeMatches.map((match) => ({
      queryKey: workflowSearchReplaceKeys.knowledgeDetail(match.rawValue),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchKnowledgeBase(match.rawValue, signal),
      enabled: Boolean(match.rawValue),
      staleTime: 60 * 1000,
      select: (knowledgeBase: KnowledgeBaseData): WorkflowSearchResolvedResource => ({
        matchRawValue: match.rawValue,
        resourceGroupKey: match.resource?.resourceGroupKey,
        label: knowledgeBase.name,
        resolved: true,
        inaccessible: false,
      }),
    })),
  })
}

export function useWorkflowSearchSelectorDetails(matches: WorkflowSearchMatch[]) {
  const selectorMatches = useMemo(() => uniqueSelectorDetailMatches(matches), [matches])

  return useQueries({
    queries: selectorMatches.map((match) => {
      const selectorKey = match.resource?.selectorKey as SelectorKey
      const context = match.resource?.selectorContext ?? {}
      const contextKey = selectorContextKey(match)
      const definition = getSelectorDefinition(selectorKey)
      const queryArgs = { key: selectorKey, context, detailId: match.rawValue }
      const baseEnabled = definition.enabled ? definition.enabled(queryArgs) : true

      return {
        queryKey: workflowSearchReplaceKeys.selectorDetail(selectorKey, contextKey, match.rawValue),
        queryFn: async ({ signal }: { signal: AbortSignal }): Promise<SelectorOption | null> => {
          if (definition.fetchById) {
            return definition.fetchById({ ...queryArgs, signal })
          }

          const options = await definition.fetchList({ key: selectorKey, context, signal })
          return options.find((option) => option.id === match.rawValue) ?? null
        },
        enabled: Boolean(selectorKey && match.rawValue && baseEnabled),
        staleTime: definition.staleTime ?? 60 * 1000,
        select: (option: SelectorOption | null): WorkflowSearchResolvedResource => ({
          matchRawValue: match.rawValue,
          resourceGroupKey: match.resource?.resourceGroupKey,
          label: option?.label ?? match.rawValue,
          resolved: Boolean(option),
          inaccessible: false,
        }),
      }
    }),
  })
}

export function useWorkflowSearchOAuthReplacementOptions(
  matches: WorkflowSearchMatch[],
  workspaceId?: string,
  workflowId?: string
) {
  const providerIds = useMemo(() => {
    const ids = new Set<string>()
    matches.forEach((match) => {
      if (match.kind === 'oauth-credential' && match.resource?.providerId) {
        ids.add(match.resource.providerId)
      }
    })
    return [...ids].sort()
  }, [matches])

  return useQueries({
    queries: providerIds.map((providerId) => ({
      queryKey: workflowSearchReplaceKeys.oauthReplacementOptions(
        providerId,
        workspaceId,
        workflowId
      ),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchOAuthCredentials({ providerId, workspaceId, workflowId }, signal),
      enabled: Boolean(providerId && workspaceId),
      staleTime: 60 * 1000,
      select: (credentials: Credential[]): WorkflowSearchReplacementOption[] =>
        credentials.map((credential) => ({
          kind: 'oauth-credential',
          value: credential.id,
          label: credential.name,
          providerId,
          serviceId: providerId,
        })),
    })),
  })
}

export function useWorkflowSearchKnowledgeReplacementOptions(workspaceId?: string) {
  return useQueries({
    queries: [
      {
        queryKey: workflowSearchReplaceKeys.knowledgeReplacementOptions(workspaceId),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          fetchKnowledgeBases(workspaceId, 'active', signal),
        enabled: Boolean(workspaceId),
        staleTime: 60 * 1000,
        placeholderData: (previous: KnowledgeBaseData[] | undefined) => previous,
        select: (knowledgeBases: KnowledgeBaseData[]): WorkflowSearchReplacementOption[] =>
          knowledgeBases.map((knowledgeBase) => ({
            kind: 'knowledge-base',
            value: knowledgeBase.id,
            label: knowledgeBase.name,
          })),
      },
    ],
  })
}

export function useWorkflowSearchSelectorReplacementOptions(matches: WorkflowSearchMatch[]) {
  const selectorGroups = useMemo(() => uniqueSelectorOptionGroups(matches), [matches])

  return useQueries({
    queries: selectorGroups.map((match) => {
      const selectorKey = match.resource?.selectorKey as SelectorKey
      const context = match.resource?.selectorContext ?? {}
      const contextKey = selectorContextKey(match)
      const definition = getSelectorDefinition(selectorKey)
      const queryArgs = { key: selectorKey, context }
      const baseEnabled = definition.enabled ? definition.enabled(queryArgs) : true

      return {
        queryKey: workflowSearchReplaceKeys.selectorReplacementOptions(selectorKey, contextKey),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          definition.fetchList({ ...queryArgs, signal }),
        enabled: Boolean(selectorKey && baseEnabled),
        staleTime: definition.staleTime ?? 60 * 1000,
        select: (options: SelectorOption[]): WorkflowSearchReplacementOption[] =>
          options.map((option) => ({
            kind: match.kind,
            value: option.id,
            label: option.label,
            selectorKey,
            selectorContext: context,
            resourceGroupKey: match.resource?.resourceGroupKey,
          })),
      }
    }),
  })
}

export function flattenWorkflowSearchReplacementOptions(
  optionGroups: Array<{ data?: WorkflowSearchReplacementOption[] }>
): WorkflowSearchReplacementOption[] {
  return optionGroups.flatMap((group) => group.data ?? [])
}

export { knowledgeKeys }
