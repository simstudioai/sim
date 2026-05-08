import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { KnowledgeBaseData } from '@/lib/api/contracts/knowledge'
import {
  type DiscoverMcpToolsResponse,
  discoverMcpToolsContract,
  type ListMcpServersResponse,
  listMcpServersContract,
} from '@/lib/api/contracts/mcp'
import {
  type GetTableResponse,
  getTableContract,
  type ListTablesResponse,
  listTablesContract,
} from '@/lib/api/contracts/tables'
import {
  type ListWorkspaceFilesResponse,
  listWorkspaceFilesContract,
} from '@/lib/api/contracts/workspace-files'
import { createMcpToolId } from '@/lib/mcp/shared'
import type { Credential } from '@/lib/oauth'
import {
  getWorkflowSearchMatchResourceGroupKey,
  stableStringifyWorkflowSearchValue,
} from '@/lib/workflows/search-replace/resources'
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
  tableDetails: () => [...workflowSearchReplaceKeys.resourceDetails(), 'table'] as const,
  tableDetail: (workspaceId?: string, tableId?: string) =>
    [...workflowSearchReplaceKeys.tableDetails(), workspaceId ?? '', tableId ?? ''] as const,
  tableReplacementOptions: (workspaceId?: string) =>
    [...workflowSearchReplaceKeys.replacementOptions(), 'table', workspaceId ?? ''] as const,
  fileDetails: () => [...workflowSearchReplaceKeys.resourceDetails(), 'file'] as const,
  fileListDetails: (workspaceId?: string) =>
    [...workflowSearchReplaceKeys.fileDetails(), 'list', workspaceId ?? ''] as const,
  fileReplacementOptions: (workspaceId?: string) =>
    [...workflowSearchReplaceKeys.replacementOptions(), 'file', workspaceId ?? ''] as const,
  mcpServerDetails: () => [...workflowSearchReplaceKeys.resourceDetails(), 'mcp-server'] as const,
  mcpServerListDetails: (workspaceId?: string) =>
    [...workflowSearchReplaceKeys.mcpServerDetails(), 'list', workspaceId ?? ''] as const,
  mcpServerReplacementOptions: (workspaceId?: string) =>
    [...workflowSearchReplaceKeys.replacementOptions(), 'mcp-server', workspaceId ?? ''] as const,
  mcpToolDetails: () => [...workflowSearchReplaceKeys.resourceDetails(), 'mcp-tool'] as const,
  mcpToolListDetails: (workspaceId?: string) =>
    [...workflowSearchReplaceKeys.mcpToolDetails(), 'list', workspaceId ?? ''] as const,
  mcpToolReplacementOptions: (workspaceId?: string) =>
    [...workflowSearchReplaceKeys.replacementOptions(), 'mcp-tool', workspaceId ?? ''] as const,
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

function uniqueResourceOptionGroups(
  matches: WorkflowSearchMatch[],
  kind: WorkflowSearchMatch['kind'],
  predicate?: (match: WorkflowSearchMatch) => boolean
): WorkflowSearchMatch[] {
  const seen = new Set<string>()
  return matches.filter((match) => {
    if (match.kind !== kind || predicate?.(match) === false) return false

    const key = getWorkflowSearchMatchResourceGroupKey(match)
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

export function useWorkflowSearchTableDetails(
  matches: WorkflowSearchMatch[],
  workspaceId?: string
) {
  const tableMatches = useMemo(() => uniqueMatches(matches, 'table'), [matches])

  return useQueries({
    queries: tableMatches.map((match) => ({
      queryKey: workflowSearchReplaceKeys.tableDetail(workspaceId, match.rawValue),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        requestJson(getTableContract, {
          params: { tableId: match.rawValue },
          query: { workspaceId: workspaceId as string },
          signal,
        }),
      enabled: Boolean(workspaceId && match.rawValue),
      staleTime: 60 * 1000,
      select: (response: GetTableResponse): WorkflowSearchResolvedResource => ({
        matchRawValue: match.rawValue,
        resourceGroupKey: match.resource?.resourceGroupKey,
        label: response.data.table.name,
        resolved: true,
        inaccessible: false,
      }),
    })),
  })
}

export function useWorkflowSearchFileDetails(matches: WorkflowSearchMatch[], workspaceId?: string) {
  const fileMatches = useMemo(
    () =>
      uniqueMatches(
        matches.filter((match) => !match.resource?.selectorKey),
        'file'
      ),
    [matches]
  )

  const filesQuery = useQuery({
    queryKey: workflowSearchReplaceKeys.fileListDetails(workspaceId),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      requestJson(listWorkspaceFilesContract, {
        params: { id: workspaceId as string },
        query: { scope: 'active' },
        signal,
      }),
    enabled: Boolean(workspaceId && fileMatches.length > 0),
    staleTime: 60 * 1000,
  })

  return useMemo(
    () =>
      fileMatches.map((match) => {
        const file = filesQuery.data?.files.find((item) =>
          [item.id, item.key, item.path, item.name].includes(match.rawValue)
        )
        return {
          data: filesQuery.data
            ? {
                matchRawValue: match.rawValue,
                resourceGroupKey: match.resource?.resourceGroupKey,
                label: file?.name ?? match.rawValue,
                resolved: Boolean(file),
                inaccessible: false,
              }
            : undefined,
        }
      }),
    [fileMatches, filesQuery.data]
  )
}

export function useWorkflowSearchMcpServerDetails(
  matches: WorkflowSearchMatch[],
  workspaceId?: string
) {
  const serverMatches = useMemo(() => uniqueMatches(matches, 'mcp-server'), [matches])

  const serversQuery = useQuery({
    queryKey: workflowSearchReplaceKeys.mcpServerListDetails(workspaceId),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      requestJson(listMcpServersContract, {
        query: { workspaceId: workspaceId as string },
        signal,
      }),
    enabled: Boolean(workspaceId && serverMatches.length > 0),
    staleTime: 60 * 1000,
  })

  return useMemo(
    () =>
      serverMatches.map((match) => {
        const server = serversQuery.data?.data.servers.find((item) => item.id === match.rawValue)
        return {
          data: serversQuery.data
            ? {
                matchRawValue: match.rawValue,
                resourceGroupKey: match.resource?.resourceGroupKey,
                label: server?.name ?? match.rawValue,
                resolved: Boolean(server),
                inaccessible: false,
              }
            : undefined,
        }
      }),
    [serverMatches, serversQuery.data]
  )
}

export function useWorkflowSearchMcpToolDetails(
  matches: WorkflowSearchMatch[],
  workspaceId?: string
) {
  const toolMatches = useMemo(() => uniqueMatches(matches, 'mcp-tool'), [matches])

  const toolsQuery = useQuery({
    queryKey: workflowSearchReplaceKeys.mcpToolListDetails(workspaceId),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      requestJson(discoverMcpToolsContract, {
        query: { workspaceId: workspaceId as string },
        signal,
      }),
    enabled: Boolean(workspaceId && toolMatches.length > 0),
    staleTime: 60 * 1000,
  })

  return useMemo(
    () =>
      toolMatches.map((match) => {
        const tool = toolsQuery.data?.data.tools.find(
          (item) => createMcpToolId(item.serverId, item.name) === match.rawValue
        )
        return {
          data: toolsQuery.data
            ? {
                matchRawValue: match.rawValue,
                resourceGroupKey: match.resource?.resourceGroupKey,
                label: tool ? `${tool.serverName}: ${tool.name}` : match.rawValue,
                resolved: Boolean(tool),
                inaccessible: false,
              }
            : undefined,
        }
      }),
    [toolMatches, toolsQuery.data]
  )
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

export function useWorkflowSearchKnowledgeReplacementOptions(
  matches: WorkflowSearchMatch[],
  workspaceId?: string
) {
  const knowledgeGroups = useMemo(
    () => uniqueResourceOptionGroups(matches, 'knowledge-base'),
    [matches]
  )

  return useQueries({
    queries: [
      {
        queryKey: workflowSearchReplaceKeys.knowledgeReplacementOptions(workspaceId),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          fetchKnowledgeBases(workspaceId, 'active', signal),
        enabled: Boolean(workspaceId && knowledgeGroups.length > 0),
        staleTime: 60 * 1000,
        placeholderData: (previous: KnowledgeBaseData[] | undefined) => previous,
        select: (knowledgeBases: KnowledgeBaseData[]): WorkflowSearchReplacementOption[] =>
          knowledgeGroups.flatMap((match) =>
            knowledgeBases.map((knowledgeBase) => ({
              kind: 'knowledge-base',
              value: knowledgeBase.id,
              label: knowledgeBase.name,
              resourceGroupKey: match.resource?.resourceGroupKey,
            }))
          ),
      },
    ],
  })
}

export function useWorkflowSearchTableReplacementOptions(
  matches: WorkflowSearchMatch[],
  workspaceId?: string
) {
  const tableGroups = useMemo(() => uniqueResourceOptionGroups(matches, 'table'), [matches])

  return useQueries({
    queries: [
      {
        queryKey: workflowSearchReplaceKeys.tableReplacementOptions(workspaceId),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          requestJson(listTablesContract, {
            query: { workspaceId: workspaceId as string, scope: 'active' },
            signal,
          }),
        enabled: Boolean(workspaceId && tableGroups.length > 0),
        staleTime: 60 * 1000,
        select: (response: ListTablesResponse): WorkflowSearchReplacementOption[] =>
          tableGroups.flatMap((match) =>
            response.data.tables.map((table) => ({
              kind: 'table',
              value: table.id,
              label: table.name,
              resourceGroupKey: match.resource?.resourceGroupKey,
            }))
          ),
      },
    ],
  })
}

export function useWorkflowSearchFileReplacementOptions(
  matches: WorkflowSearchMatch[],
  workspaceId?: string
) {
  const fileGroups = useMemo(
    () => uniqueResourceOptionGroups(matches, 'file', (match) => !match.resource?.selectorKey),
    [matches]
  )

  return useQueries({
    queries: [
      {
        queryKey: workflowSearchReplaceKeys.fileReplacementOptions(workspaceId),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          requestJson(listWorkspaceFilesContract, {
            params: { id: workspaceId as string },
            query: { scope: 'active' },
            signal,
          }),
        enabled: Boolean(workspaceId && fileGroups.length > 0),
        staleTime: 60 * 1000,
        select: (response: ListWorkspaceFilesResponse): WorkflowSearchReplacementOption[] =>
          fileGroups.flatMap((match) =>
            response.files.map((file) => ({
              kind: 'file',
              value: JSON.stringify({
                name: file.name,
                path: file.path,
                key: file.key,
                size: file.size,
                type: file.type,
              }),
              label: file.name,
              resourceGroupKey: match.resource?.resourceGroupKey,
            }))
          ),
      },
    ],
  })
}

export function useWorkflowSearchMcpServerReplacementOptions(
  matches: WorkflowSearchMatch[],
  workspaceId?: string
) {
  const serverGroups = useMemo(() => uniqueResourceOptionGroups(matches, 'mcp-server'), [matches])

  return useQueries({
    queries: [
      {
        queryKey: workflowSearchReplaceKeys.mcpServerReplacementOptions(workspaceId),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          requestJson(listMcpServersContract, {
            query: { workspaceId: workspaceId as string },
            signal,
          }),
        enabled: Boolean(workspaceId && serverGroups.length > 0),
        staleTime: 60 * 1000,
        select: (response: ListMcpServersResponse): WorkflowSearchReplacementOption[] =>
          serverGroups.flatMap((match) =>
            response.data.servers.map((server) => ({
              kind: 'mcp-server',
              value: server.id,
              label: server.name,
              resourceGroupKey: match.resource?.resourceGroupKey,
            }))
          ),
      },
    ],
  })
}

export function buildWorkflowSearchMcpToolReplacementOptions(
  toolGroups: WorkflowSearchMatch[],
  tools: DiscoverMcpToolsResponse['data']['tools']
): WorkflowSearchReplacementOption[] {
  return toolGroups.flatMap((match) => {
    const serverId = match.resource?.selectorContext?.mcpServerId
    return tools
      .filter((tool) => !serverId || tool.serverId === serverId)
      .map((tool) => ({
        kind: 'mcp-tool',
        value: createMcpToolId(tool.serverId, tool.name),
        label: `${tool.serverName}: ${tool.name}`,
        resourceGroupKey: match.resource?.resourceGroupKey,
      }))
  })
}

export function useWorkflowSearchMcpToolReplacementOptions(
  matches: WorkflowSearchMatch[],
  workspaceId?: string
) {
  const toolGroups = useMemo(() => uniqueResourceOptionGroups(matches, 'mcp-tool'), [matches])

  return useQueries({
    queries: [
      {
        queryKey: workflowSearchReplaceKeys.mcpToolReplacementOptions(workspaceId),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          requestJson(discoverMcpToolsContract, {
            query: { workspaceId: workspaceId as string },
            signal,
          }),
        enabled: Boolean(workspaceId && toolGroups.length > 0),
        staleTime: 60 * 1000,
        select: (response: DiscoverMcpToolsResponse): WorkflowSearchReplacementOption[] =>
          buildWorkflowSearchMcpToolReplacementOptions(toolGroups, response.data.tools),
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
