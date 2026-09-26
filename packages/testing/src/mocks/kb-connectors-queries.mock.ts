import { vi } from 'vitest'
import { createMutationResultMock, createQueryResultMock } from './react-query.mock'

type MockResourceScope =
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'organization'; organizationId: string }

function resourceScopeKey(scope: MockResourceScope): string {
  return scope.kind === 'workspace'
    ? `workspace:${scope.workspaceId}`
    : `organization:${scope.organizationId}`
}

const knowledgeDetailKey = (knowledgeBaseId?: string) =>
  ['knowledge', 'detail', knowledgeBaseId ?? ''] as const

const connectorKeys = {
  all: (knowledgeBaseId?: string) =>
    [...knowledgeDetailKey(knowledgeBaseId), 'connectors'] as const,
  lists: (knowledgeBaseId?: string) => [...connectorKeys.all(knowledgeBaseId), 'list'] as const,
  details: (knowledgeBaseId?: string) => [...connectorKeys.all(knowledgeBaseId), 'detail'] as const,
  detail: (knowledgeBaseId?: string, connectorId?: string) =>
    [...connectorKeys.details(knowledgeBaseId), connectorId ?? ''] as const,
  progress: (knowledgeBaseId?: string, connectorId?: string, scope?: MockResourceScope) =>
    [
      ...connectorKeys.progresses(knowledgeBaseId, connectorId),
      scope ? resourceScopeKey(scope) : '',
    ] as const,
  progresses: (knowledgeBaseId?: string, connectorId?: string) =>
    [...connectorKeys.detail(knowledgeBaseId, connectorId), 'progress'] as const,
}

const searchIndexKeys = {
  all: ['search-index'] as const,
  details: () => [...searchIndexKeys.all, 'detail'] as const,
  detail: (scope: MockResourceScope) =>
    [...searchIndexKeys.details(), resourceScopeKey(scope)] as const,
}

const connectorDocumentKeys = {
  all: (knowledgeBaseId?: string, connectorId?: string) =>
    [...connectorKeys.detail(knowledgeBaseId, connectorId), 'documents'] as const,
  lists: (knowledgeBaseId?: string, connectorId?: string) =>
    [...connectorDocumentKeys.all(knowledgeBaseId, connectorId), 'list'] as const,
  list: (knowledgeBaseId?: string, connectorId?: string, options?: unknown) =>
    [...connectorDocumentKeys.lists(knowledgeBaseId, connectorId), options] as const,
}

const queryHook = () => vi.fn((..._args: unknown[]): unknown => createQueryResultMock())
const mutationHook = () => vi.fn((..._args: unknown[]): unknown => createMutationResultMock())

/**
 * Controllable mock functions for `@/hooks/queries/kb/connectors`.
 *
 * - `mockIsConnectorSyncingOrPending` is the real predicate (`status` `pending`/`syncing`, or
 *   `memberSyncStatus` `pending`/`running`).
 * - Query hooks (`useConnectorList`, `useConnectorDetail`, `useSearchIndex`,
 *   `useSearchSourceOverview`, `useOrganizationSearchOverview`, `useSearchSources`,
 *   `useConnectorDocuments`) return a fresh {@link createQueryResultMock} (`data: undefined`,
 *   `isPending: true`).
 * - Every mutation hook returns a fresh {@link createMutationResultMock} (`idle`, no-op
 *   `mutate`/`reset`, `mutateAsync` resolves `undefined`, `submittedAt: 0`). To assert on `mutate`,
 *   give the hook a stable return with `mockReturnValue`.
 *
 * @example
 * ```ts
 * import { kbConnectorsQueriesMockFns } from '@sim/testing/mocks/kb-connectors-queries.mock'
 *
 * kbConnectorsQueriesMockFns.mockUseUpdateConnector.mockReturnValue({ mutate, isPending: false })
 * ```
 */
export const kbConnectorsQueriesMockFns = {
  mockIsConnectorSyncingOrPending: vi.fn(
    (connector: { status: string; memberSyncStatus?: string | null }): boolean =>
      connector.status === 'pending' ||
      connector.status === 'syncing' ||
      connector.memberSyncStatus === 'pending' ||
      connector.memberSyncStatus === 'running'
  ),
  mockUseConnectorList: queryHook(),
  mockUseConnectorDetail: queryHook(),
  mockUseCreateConnector: mutationHook(),
  mockUseUpdateConnector: mutationHook(),
  mockUseSearchIndex: queryHook(),
  mockUseSearchSourceOverview: queryHook(),
  mockUseOrganizationSearchOverview: queryHook(),
  mockUseSearchSources: queryHook(),
  mockUseStartConnectorMemberEnrollment: mutationHook(),
  mockUseUpdateConnectorAccess: mutationHook(),
  mockUseDeleteConnector: mutationHook(),
  mockUseTriggerSync: mutationHook(),
  mockUseConnectorDocuments: queryHook(),
  mockUseExcludeConnectorDocument: mutationHook(),
  mockUseRestoreConnectorDocument: mutationHook(),
  mockUseConnectSimSearchConnector: mutationHook(),
  mockUsePrepareSearchSource: mutationHook(),
}

/**
 * Static mock module for `@/hooks/queries/kb/connectors`. Covers every runtime export; the stale
 * times, `CONNECTOR_SYNC_POLL_INTERVAL_MS`, and the `connectorKeys` / `searchIndexKeys` /
 * `connectorDocumentKeys` factories carry the real values (`connectorKeys` is rooted at the real
 * `knowledgeKeys.detail(id)` = `['knowledge', 'detail', id]`).
 *
 * @example
 * ```ts
 * vi.mock('@/hooks/queries/kb/connectors', () => kbConnectorsQueriesMock)
 * ```
 */
export const kbConnectorsQueriesMock = {
  CONNECTOR_LIST_STALE_TIME: 30 * 1000,
  CONNECTOR_DETAIL_STALE_TIME: 30 * 1000,
  CONNECTOR_DOCUMENT_LIST_STALE_TIME: 30 * 1000,
  CONNECTOR_SYNC_POLL_INTERVAL_MS: 3000,
  connectorKeys,
  searchIndexKeys,
  connectorDocumentKeys,
  isConnectorSyncingOrPending: kbConnectorsQueriesMockFns.mockIsConnectorSyncingOrPending,
  useConnectorList: kbConnectorsQueriesMockFns.mockUseConnectorList,
  useConnectorDetail: kbConnectorsQueriesMockFns.mockUseConnectorDetail,
  useCreateConnector: kbConnectorsQueriesMockFns.mockUseCreateConnector,
  useUpdateConnector: kbConnectorsQueriesMockFns.mockUseUpdateConnector,
  useSearchIndex: kbConnectorsQueriesMockFns.mockUseSearchIndex,
  useSearchSourceOverview: kbConnectorsQueriesMockFns.mockUseSearchSourceOverview,
  useOrganizationSearchOverview: kbConnectorsQueriesMockFns.mockUseOrganizationSearchOverview,
  useSearchSources: kbConnectorsQueriesMockFns.mockUseSearchSources,
  useStartConnectorMemberEnrollment:
    kbConnectorsQueriesMockFns.mockUseStartConnectorMemberEnrollment,
  useUpdateConnectorAccess: kbConnectorsQueriesMockFns.mockUseUpdateConnectorAccess,
  useDeleteConnector: kbConnectorsQueriesMockFns.mockUseDeleteConnector,
  useTriggerSync: kbConnectorsQueriesMockFns.mockUseTriggerSync,
  useConnectorDocuments: kbConnectorsQueriesMockFns.mockUseConnectorDocuments,
  useExcludeConnectorDocument: kbConnectorsQueriesMockFns.mockUseExcludeConnectorDocument,
  useRestoreConnectorDocument: kbConnectorsQueriesMockFns.mockUseRestoreConnectorDocument,
  useConnectSimSearchConnector: kbConnectorsQueriesMockFns.mockUseConnectSimSearchConnector,
  usePrepareSearchSource: kbConnectorsQueriesMockFns.mockUsePrepareSearchSource,
}
