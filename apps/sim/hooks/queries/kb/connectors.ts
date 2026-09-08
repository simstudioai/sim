import {
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type ConnectorData,
  type ConnectorDetailData,
  type ConnectorDocumentsData,
  type ConnectorMemberSummary,
  type ConnectSimSearchConnectorBody,
  connectSimSearchConnectorContract,
  createKnowledgeConnectorContract,
  deleteKnowledgeConnectorContract,
  getKnowledgeConnectorContract,
  listKnowledgeConnectorDocumentsContract,
  listKnowledgeConnectorsContract,
  listSearchSourcesContract,
  listWorkspaceMemberConnectorsContract,
  type MemberSyncLogData,
  patchKnowledgeConnectorDocumentsContract,
  type SearchSourceSummary,
  type StartKnowledgeConnectorMemberEnrollmentData,
  type SyncLogData,
  startKnowledgeConnectorMemberEnrollmentContract,
  triggerKnowledgeConnectorSyncContract,
  type UpdateConnectorAccessBody,
  updateKnowledgeConnectorAccessContract,
  updateKnowledgeConnectorContract,
  type ViewerConnectorMembership,
  type WorkspaceMemberConnector,
} from '@/lib/api/contracts/knowledge'
import {
  type ConnectorAccessMode,
  type PrepareSearchSourceBody,
  prepareSearchSourceContract,
  readSearchIndexContract,
} from '@/lib/api/contracts/knowledge/connectors'
import {
  type ResourceScope,
  resourceScopeFields,
  resourceScopeFromOwner,
  resourceScopeKey,
} from '@/lib/core/resource-scope'
import { MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE } from '@/lib/knowledge/constants'
import { organizationAccountsKeys } from '@/hooks/queries/organization-accounts'
import { credentialGroupKeys } from '@/hooks/queries/utils/credential-group-queries'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'
import { searchIntegrationKeys } from '@/hooks/queries/utils/search-integration-keys'

export type {
  SearchSourceSummary,
  ViewerConnectorMembership,
  WorkspaceMemberConnector,
  ConnectorData,
  ConnectorDetailData,
  ConnectorMemberSummary,
  MemberSyncLogData,
  SyncLogData,
  UpdateConnectorAccessBody,
}

export const CONNECTOR_LIST_STALE_TIME = 30 * 1000
export const CONNECTOR_DETAIL_STALE_TIME = 30 * 1000
export const CONNECTOR_DOCUMENT_LIST_STALE_TIME = 30 * 1000

/**
 * A knowledge base has exactly one connector list, so `lists` is both the
 * prefix and the query's own key — there is no per-parameter leaf below it.
 */
export const connectorKeys = {
  all: (knowledgeBaseId?: string) =>
    [...knowledgeKeys.detail(knowledgeBaseId), 'connectors'] as const,
  lists: (knowledgeBaseId?: string) => [...connectorKeys.all(knowledgeBaseId), 'list'] as const,
  details: (knowledgeBaseId?: string) => [...connectorKeys.all(knowledgeBaseId), 'detail'] as const,
  detail: (knowledgeBaseId?: string, connectorId?: string) =>
    [...connectorKeys.details(knowledgeBaseId), connectorId ?? ''] as const,
}

async function fetchConnectors(
  knowledgeBaseId: string,
  signal?: AbortSignal
): Promise<ConnectorData[]> {
  const result = await requestJson(listKnowledgeConnectorsContract, {
    params: { id: knowledgeBaseId },
    signal,
  })

  return result.data
}

async function fetchConnectorDetail(
  knowledgeBaseId: string,
  connectorId: string,
  signal?: AbortSignal
): Promise<ConnectorDetailData> {
  const result = await requestJson(getKnowledgeConnectorContract, {
    params: { id: knowledgeBaseId, connectorId },
    signal,
  })

  return result.data
}

export const CONNECTOR_SYNC_POLL_INTERVAL_MS = 3000

/**
 * Whether a sync is queued or running for this connector.
 *
 * Reads server state only. The server writes `pending` the moment a sync is
 * queued and `syncing` once a worker takes the lock, so there is no window to
 * infer and no clock to compare against — an earlier version guessed from
 * `createdAt`, which was wrong under queue backlog and under client clock skew.
 */
export function isConnectorSyncingOrPending(connector: {
  status: ConnectorData['status']
  memberSyncStatus?: ConnectorData['memberSyncStatus']
}): boolean {
  return (
    connector.status === 'pending' ||
    connector.status === 'syncing' ||
    connector.memberSyncStatus === 'pending' ||
    connector.memberSyncStatus === 'running'
  )
}

export function useConnectorList(knowledgeBaseId?: string) {
  return useQuery({
    queryKey: connectorKeys.lists(knowledgeBaseId),
    queryFn: ({ signal }) => fetchConnectors(knowledgeBaseId as string, signal),
    enabled: Boolean(knowledgeBaseId),
    staleTime: CONNECTOR_LIST_STALE_TIME,
    refetchInterval: (query) => {
      const connectors = query.state.data
      if (!connectors?.length) return false
      return connectors.some(isConnectorSyncingOrPending) ? CONNECTOR_SYNC_POLL_INTERVAL_MS : false
    },
  })
}

export function useConnectorDetail(knowledgeBaseId?: string, connectorId?: string) {
  return useQuery({
    queryKey: connectorKeys.detail(knowledgeBaseId, connectorId),
    queryFn: ({ signal }) =>
      fetchConnectorDetail(knowledgeBaseId as string, connectorId as string, signal),
    enabled: Boolean(knowledgeBaseId && connectorId),
    staleTime: CONNECTOR_DETAIL_STALE_TIME,
    placeholderData: keepPreviousData,
    /**
     * The sync history this query carries is the thing a user watches during a
     * sync, so it tracks the list's cadence instead of going stale behind an
     * animating spinner.
     */
    refetchInterval: (query) => {
      const connector = query.state.data
      if (!connector) return false
      return isConnectorSyncingOrPending(connector) ? CONNECTOR_SYNC_POLL_INTERVAL_MS : false
    },
  })
}

/**
 * Writes the status into both caches that render it.
 *
 * The detail query drives its own sync poll off its own copy of `status`, so
 * patching only the list would leave an already-expanded card reading `active`,
 * never starting that poll, and showing stale sync history behind the list's
 * spinner.
 */
type ConnectorStatusPatch = Pick<ConnectorData, 'status'> | Pick<ConnectorData, 'memberSyncStatus'>

function setCachedConnectorStatus(
  queryClient: QueryClient,
  knowledgeBaseId: string,
  connectorId: string,
  patch: ConnectorStatusPatch
) {
  queryClient.setQueryData<ConnectorData[]>(connectorKeys.lists(knowledgeBaseId), (connectors) =>
    connectors?.map((connector) =>
      connector.id === connectorId ? { ...connector, ...patch } : connector
    )
  )
  queryClient.setQueryData<ConnectorDetailData>(
    connectorKeys.detail(knowledgeBaseId, connectorId),
    (detail) => (detail ? { ...detail, ...patch } : detail)
  )
}

/**
 * Applies an optimistic status to one connector and returns the status it had,
 * which is all `onError` needs to undo it — the mutation variables already
 * carry the ids.
 *
 * The pause and resume mutations share this write instead of each keeping a
 * local `Set` of in-flight ids alongside it — that duplicated the server's own
 * state and could not survive a remount.
 *
 * Deliberately not a snapshot of the whole array: two connectors can be in
 * flight at once, and restoring a whole-list snapshot would roll the other
 * one's optimistic write back along with this one's — or resurrect a status it
 * had already moved past.
 */
function optimisticallySetConnectorStatus(
  queryClient: QueryClient,
  knowledgeBaseId: string,
  connectorId: string,
  status: ConnectorData['status']
) {
  const previousStatus = queryClient
    .getQueryData<ConnectorData[]>(connectorKeys.lists(knowledgeBaseId))
    ?.find((connector) => connector.id === connectorId)?.status

  setCachedConnectorStatus(queryClient, knowledgeBaseId, connectorId, { status })

  return previousStatus
}

/**
 * The optimistic "queued" write for a sync trigger, on whichever engine the
 * connector runs: a members connector queues a member run, so its content
 * status must not flip. The Search surface reads the same member sync status
 * from the workspace member-connector list, so that cache is queued too; it
 * has no poll to reconcile it, and the write cannot stop one, so it is patched
 * rather than refetched. Returns what to restore if the trigger is refused.
 */
function optimisticallyQueueSync(
  queryClient: QueryClient,
  knowledgeBaseId: string,
  connectorId: string
): ConnectorStatusPatch | undefined {
  const cached = queryClient
    .getQueryData<ConnectorData[]>(connectorKeys.lists(knowledgeBaseId))
    ?.find((connector) => connector.id === connectorId)
  if (!cached) return undefined
  if (cached.accessMode === 'members') {
    setCachedConnectorStatus(queryClient, knowledgeBaseId, connectorId, {
      memberSyncStatus: 'pending',
    })
    queryClient.setQueriesData<WorkspaceMemberConnector[]>(
      { queryKey: memberConnectorKeys.lists() },
      (connectors) =>
        connectors?.map((connector) =>
          connector.connectorId === connectorId
            ? { ...connector, memberSyncStatus: 'pending' }
            : connector
        )
    )
    return { memberSyncStatus: cached.memberSyncStatus }
  }
  setCachedConnectorStatus(queryClient, knowledgeBaseId, connectorId, { status: 'pending' })
  return { status: cached.status }
}

interface CreateConnectorParams {
  knowledgeBaseId: string
  connectorType: string
  credentialId?: string
  apiKey?: string
  sourceConfig: Record<string, unknown>
  syncIntervalMinutes?: number
  accessMode?: ConnectorAccessMode
  credentialGroupId?: string
  credentialGroupOptionId?: string
}

async function createConnector({
  knowledgeBaseId,
  ...body
}: CreateConnectorParams): Promise<ConnectorData> {
  const result = await requestJson(createKnowledgeConnectorContract, {
    params: { id: knowledgeBaseId },
    body,
  })

  return result.data
}

function invalidateConnectorAccounts(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: credentialGroupKeys.workspaces() }),
    queryClient.invalidateQueries({ queryKey: credentialGroupKeys.details() }),
    queryClient.invalidateQueries({ queryKey: organizationAccountsKeys.details() }),
  ])
}

export function useCreateConnector() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createConnector,
    /**
     * Only the connector list gains a row — a new connector has no documents
     * yet, so the base's own totals do not move here. They move when the first
     * sync lands, which `base.tsx` picks up on the syncing-to-idle transition.
     */
    onSettled: (_data, _error, { knowledgeBaseId }) => {
      queryClient.invalidateQueries({ queryKey: connectorKeys.all(knowledgeBaseId) })
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.lists() })
      queryClient.invalidateQueries({ queryKey: memberConnectorKeys.lists() })
      queryClient.invalidateQueries({ queryKey: searchSourceKeys.lists() })
      queryClient.invalidateQueries({ queryKey: searchIntegrationKeys.lists() })
      void invalidateConnectorAccounts(queryClient)
    },
  })
}

interface UpdateConnectorParams {
  knowledgeBaseId: string
  connectorId: string
  updates: {
    sourceConfig?: Record<string, unknown>
    syncIntervalMinutes?: number
    status?: 'active' | 'paused'
  }
}

async function updateConnector({
  knowledgeBaseId,
  connectorId,
  updates,
}: UpdateConnectorParams): Promise<ConnectorData> {
  const result = await requestJson(updateKnowledgeConnectorContract, {
    params: { id: knowledgeBaseId, connectorId },
    body: updates,
  })

  return result.data
}

export function useUpdateConnector() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateConnector,
    onMutate: async ({ knowledgeBaseId, connectorId, updates }) => {
      if (!updates.status) return undefined
      await queryClient.cancelQueries({ queryKey: connectorKeys.all(knowledgeBaseId) })
      return optimisticallySetConnectorStatus(
        queryClient,
        knowledgeBaseId,
        connectorId,
        updates.status
      )
    },
    onError: (_error, { knowledgeBaseId, connectorId }, previousStatus) => {
      if (previousStatus) {
        setCachedConnectorStatus(queryClient, knowledgeBaseId, connectorId, {
          status: previousStatus,
        })
      }
    },
    onSettled: (_data, _error, { knowledgeBaseId }) => {
      queryClient.invalidateQueries({ queryKey: connectorKeys.all(knowledgeBaseId) })
      queryClient.invalidateQueries({ queryKey: searchSourceKeys.lists() })
      queryClient.invalidateQueries({ queryKey: searchIntegrationKeys.lists() })
    },
  })
}

interface UpdateConnectorAccessParams {
  knowledgeBaseId: string
  connectorId: string
  access: UpdateConnectorAccessBody
}

async function updateConnectorAccess({
  knowledgeBaseId,
  connectorId,
  access,
}: UpdateConnectorAccessParams): Promise<ConnectorData> {
  const result = await requestJson(updateKnowledgeConnectorAccessContract, {
    params: { id: knowledgeBaseId, connectorId },
    body: access,
  })

  return result.data
}

interface StartConnectorMemberEnrollmentParams {
  knowledgeBaseId: string
  connectorId: string
}

async function startConnectorMemberEnrollment({
  knowledgeBaseId,
  connectorId,
}: StartConnectorMemberEnrollmentParams): Promise<StartKnowledgeConnectorMemberEnrollmentData> {
  const response = await requestJson(startKnowledgeConnectorMemberEnrollmentContract, {
    params: { id: knowledgeBaseId, connectorId },
  })
  return response.data
}

export const searchSourceKeys = {
  all: ['search-sources'] as const,
  lists: () => [...searchSourceKeys.all, 'list'] as const,
  list: (scope?: string | ResourceScope) =>
    [
      ...searchSourceKeys.lists(),
      typeof scope === 'string'
        ? scope
        : scope?.kind === 'workspace'
          ? scope.workspaceId
          : scope
            ? resourceScopeKey(scope)
            : '',
    ] as const,
}

export const searchIndexKeys = {
  all: ['search-index'] as const,
  details: () => [...searchIndexKeys.all, 'detail'] as const,
  detail: (scope: ResourceScope) =>
    [...searchIndexKeys.details(), resourceScopeKey(scope)] as const,
}

export function useSearchIndex(scope: ResourceScope, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: searchIndexKeys.detail(scope),
    queryFn: async ({ signal }) =>
      (await requestJson(readSearchIndexContract, { query: resourceScopeFields(scope), signal }))
        .data,
    enabled: options?.enabled ?? true,
    staleTime: CONNECTOR_LIST_STALE_TIME,
  })
}

export function useSearchSources(owner?: string | ResourceScope, options?: { enabled?: boolean }) {
  const scope =
    typeof owner === 'string'
      ? owner
        ? { kind: 'workspace' as const, workspaceId: owner }
        : undefined
      : owner
  return useQuery({
    queryKey: searchSourceKeys.list(scope),
    queryFn: async ({ signal }): Promise<SearchSourceSummary[]> =>
      (
        await requestJson(listSearchSourcesContract, {
          query: scope ? resourceScopeFields(scope) : {},
          signal,
        })
      ).data,
    enabled: Boolean(scope) && (options?.enabled ?? true),
    staleTime: CONNECTOR_LIST_STALE_TIME,
    refetchInterval: (query) =>
      query.state.data?.some((source) => source.isSyncing)
        ? CONNECTOR_SYNC_POLL_INTERVAL_MS
        : false,
  })
}

export const memberConnectorKeys = {
  all: ['member-connectors'] as const,
  lists: () => [...memberConnectorKeys.all, 'list'] as const,
  list: (workspaceId?: string) => [...memberConnectorKeys.lists(), workspaceId ?? ''] as const,
}

export const WORKSPACE_MEMBER_CONNECTORS_STALE_TIME = 30 * 1000
/** While a connected source is still indexing for the viewer, its state is worth asking for again. */
const WORKSPACE_MEMBER_CONNECTORS_INDEXING_POLL_MS = 5 * 1000

async function fetchWorkspaceMemberConnectors(
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkspaceMemberConnector[]> {
  const response = await requestJson(listWorkspaceMemberConnectorsContract, {
    query: { workspaceId },
    signal,
  })
  return response.data
}

/** Workspace sources that let the viewer connect their own account. */
export function useWorkspaceMemberConnectors(
  workspaceId?: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: memberConnectorKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchWorkspaceMemberConnectors(workspaceId as string, signal),
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    staleTime: WORKSPACE_MEMBER_CONNECTORS_STALE_TIME,
    refetchInterval: (query) =>
      query.state.data?.some(
        (connector) =>
          connector.viewerMembership === 'connected' &&
          (connector.memberSyncStatus === 'pending' || connector.memberSyncStatus === 'running')
      )
        ? WORKSPACE_MEMBER_CONNECTORS_INDEXING_POLL_MS
        : false,
    placeholderData: keepPreviousData,
  })
}

/** Mints the viewer's enrollment link for a per-member connector; the caller navigates to it. */
export function useStartConnectorMemberEnrollment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: startConnectorMemberEnrollment,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: credentialGroupKeys.details() }),
        queryClient.invalidateQueries({ queryKey: searchSourceKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: searchIntegrationKeys.lists() }),
      ]),
  })
}

/**
 * Moves a connector between workspace and members mode. The switch rewrites
 * document access, so everything under the base is refetched: the connector
 * list and detail for the new mode and member state, and the document lists
 * and per-document caches whose rows and chunks may have become hidden or
 * visible.
 */
export function useUpdateConnectorAccess() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateConnectorAccess,
    onSettled: (_data, _error, { knowledgeBaseId }) => {
      queryClient.invalidateQueries({ queryKey: connectorKeys.all(knowledgeBaseId) })
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.documentLists(knowledgeBaseId) })
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.documentDetails(knowledgeBaseId) })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
        exact: true,
      })
      /** The base list says whether any connector syncs per member, and the Search tab lists them. */
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.lists() })
      queryClient.invalidateQueries({ queryKey: memberConnectorKeys.lists() })
      queryClient.invalidateQueries({ queryKey: searchSourceKeys.lists() })
      queryClient.invalidateQueries({ queryKey: searchIntegrationKeys.lists() })
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.searches() })
      void invalidateConnectorAccounts(queryClient)
    },
  })
}

interface DeleteConnectorParams {
  knowledgeBaseId: string
  connectorId: string
  deleteDocuments?: boolean
}

async function deleteConnector({
  knowledgeBaseId,
  connectorId,
  deleteDocuments,
}: DeleteConnectorParams): Promise<void> {
  await requestJson(deleteKnowledgeConnectorContract, {
    params: { id: knowledgeBaseId, connectorId },
    query: { deleteDocuments },
  })
}

export function useDeleteConnector() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteConnector,
    /**
     * Removing a connector can take its documents with it, so the document
     * lists and the base's own totals move — but nothing below them does.
     * Invalidating `knowledgeKeys.detail` as a prefix would also refetch every
     * cached document detail, chunk page, and chunk search in the base.
     */
    onSettled: (_data, _error, { knowledgeBaseId, deleteDocuments }) => {
      queryClient.invalidateQueries({ queryKey: connectorKeys.all(knowledgeBaseId) })
      queryClient.invalidateQueries({ queryKey: memberConnectorKeys.lists() })
      queryClient.invalidateQueries({ queryKey: searchSourceKeys.lists() })
      queryClient.invalidateQueries({ queryKey: searchIntegrationKeys.lists() })
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.documentLists(knowledgeBaseId) })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
        exact: true,
      })
      /**
       * Only this branch takes documents with it, and any per-document detail,
       * chunk page, or chunk search cached for one of them now points at a row
       * that no longer exists. The ids are not in the response, so this is the
       * narrowest prefix that reaches all of them.
       */
      if (deleteDocuments) {
        queryClient.invalidateQueries({ queryKey: knowledgeKeys.documentDetails(knowledgeBaseId) })
      }
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.lists() })
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.searches() })
    },
  })
}

interface TriggerSyncParams {
  knowledgeBaseId: string
  connectorId: string
  /** Force re-hydration + re-index of rendered content (the "Full resync" action). */
  rehydrate?: boolean
}

async function triggerSync({
  knowledgeBaseId,
  connectorId,
  rehydrate,
}: TriggerSyncParams): Promise<void> {
  await requestJson(triggerKnowledgeConnectorSyncContract, {
    params: { id: knowledgeBaseId, connectorId },
    query: rehydrate ? { rehydrate: true } : {},
  })
}

export function useTriggerSync() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: triggerSync,
    /**
     * The server marks the connector `pending` as it queues the sync, so the
     * optimistic write here only covers the request's own round trip — after
     * which the refetch below carries the same status and the list's sync poll
     * takes over through `pending` → `syncing` → `active`.
     */
    onMutate: async ({ knowledgeBaseId, connectorId }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: connectorKeys.all(knowledgeBaseId) }),
        queryClient.cancelQueries({ queryKey: memberConnectorKeys.lists() }),
        queryClient.cancelQueries({ queryKey: searchSourceKeys.lists() }),
      ])
      queryClient.setQueriesData<SearchSourceSummary[]>(
        { queryKey: searchSourceKeys.lists() },
        (sources) =>
          sources?.map((source) =>
            source.connectorId === connectorId ? { ...source, isSyncing: true } : source
          )
      )
      return optimisticallyQueueSync(queryClient, knowledgeBaseId, connectorId)
    },
    /**
     * Rolling back also stops the poll the optimistic `pending` started, so a
     * refused sync does not leave the row spinning.
     */
    onError: (_error, { knowledgeBaseId, connectorId }, previous) => {
      queryClient.invalidateQueries({ queryKey: searchSourceKeys.lists() })
      queryClient.invalidateQueries({ queryKey: searchIntegrationKeys.lists() })
      if (previous) {
        setCachedConnectorStatus(queryClient, knowledgeBaseId, connectorId, previous)
      }
      /**
       * The member-connector list took the same optimistic `pending`; a refetch
       * is its rollback, and the connector list's own status was restored above,
       * so it is not refetched over concurrent optimistic patches.
       */
      if (previous && 'memberSyncStatus' in previous) {
        queryClient.invalidateQueries({ queryKey: memberConnectorKeys.lists() })
      } else {
        queryClient.invalidateQueries({ queryKey: connectorKeys.all(knowledgeBaseId) })
      }
    },
    /**
     * Deliberately no invalidation on success. The route answers without
     * awaiting the dispatch that writes `pending`, so an immediate refetch can
     * still read `active`, discard the optimistic write, and stop the poll
     * before it ever started — leaving the UI claiming idle for a sync that is
     * running. The optimistic `pending` starts the poll instead, and the poll
     * reconciles against whatever the server actually settles on.
     */
  })
}

export const connectorDocumentKeys = {
  all: (knowledgeBaseId?: string, connectorId?: string) =>
    [...connectorKeys.detail(knowledgeBaseId, connectorId), 'documents'] as const,
  lists: (knowledgeBaseId?: string, connectorId?: string) =>
    [...connectorDocumentKeys.all(knowledgeBaseId, connectorId), 'list'] as const,
  list: (knowledgeBaseId?: string, connectorId?: string, includeExcluded = false) =>
    [...connectorDocumentKeys.lists(knowledgeBaseId, connectorId), includeExcluded] as const,
}

async function fetchConnectorDocuments(
  knowledgeBaseId: string,
  connectorId: string,
  includeExcluded: boolean,
  offset: number,
  signal?: AbortSignal
): Promise<ConnectorDocumentsData> {
  const result = await requestJson(listKnowledgeConnectorDocumentsContract, {
    params: { id: knowledgeBaseId, connectorId },
    query: {
      includeExcluded,
      limit: MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE,
      offset,
    },
    signal,
  })

  return result.data
}

export function useConnectorDocuments(
  knowledgeBaseId?: string,
  connectorId?: string,
  options?: { includeExcluded?: boolean }
) {
  const includeExcluded = options?.includeExcluded ?? false
  return useInfiniteQuery({
    queryKey: connectorDocumentKeys.list(knowledgeBaseId, connectorId, includeExcluded),
    queryFn: ({ signal, pageParam }) =>
      fetchConnectorDocuments(
        knowledgeBaseId as string,
        connectorId as string,
        includeExcluded,
        pageParam,
        signal
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const loadedCount = pages.reduce((total, page) => total + page.documents.length, 0)
      const totalCount = lastPage.counts.active + (includeExcluded ? lastPage.counts.excluded : 0)
      if (lastPage.documents.length === 0 || loadedCount >= totalCount) return undefined
      return loadedCount
    },
    enabled: Boolean(knowledgeBaseId && connectorId),
    staleTime: CONNECTOR_DOCUMENT_LIST_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

interface ConnectorDocumentMutationParams {
  knowledgeBaseId: string
  connectorId: string
  documentIds: string[]
}

/**
 * Excluding or restoring moves the connector's own document list, the base's
 * document lists that render those rows, and the base's totals.
 * `knowledgeKeys.detail` is invalidated `exact` for that last one — as a prefix
 * it would subsume every key here and refetch the base's chunk pages and chunk
 * searches too. The affected rows are named in the request, so each one is
 * invalidated directly rather than through a wider prefix.
 */
function invalidateConnectorDocumentChange(
  queryClient: QueryClient,
  { knowledgeBaseId, connectorId, documentIds }: ConnectorDocumentMutationParams
) {
  queryClient.invalidateQueries({
    queryKey: connectorDocumentKeys.lists(knowledgeBaseId, connectorId),
  })
  queryClient.invalidateQueries({ queryKey: knowledgeKeys.documentLists(knowledgeBaseId) })
  queryClient.invalidateQueries({ queryKey: knowledgeKeys.detail(knowledgeBaseId), exact: true })
  queryClient.invalidateQueries({ queryKey: knowledgeKeys.searches() })

  /**
   * One pass over the cache rather than one per id — `documentIds` reaches
   * `MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_MUTATION_ITEMS`, and every
   * `invalidateQueries` call scans the whole cache. The prefix filter already
   * restricts matches to `documentDetails`, under which `document()` puts the
   * id at the position read here.
   */
  const affected = new Set(documentIds)
  const documentDetailsPrefix = knowledgeKeys.documentDetails(knowledgeBaseId)
  queryClient.invalidateQueries({
    queryKey: documentDetailsPrefix,
    predicate: (query) => affected.has(query.queryKey[documentDetailsPrefix.length] as string),
  })
  queryClient.invalidateQueries({ queryKey: searchSourceKeys.lists() })
}

async function excludeConnectorDocuments({
  knowledgeBaseId,
  connectorId,
  documentIds,
}: ConnectorDocumentMutationParams): Promise<{ excludedCount: number }> {
  const result = await requestJson(patchKnowledgeConnectorDocumentsContract, {
    params: { id: knowledgeBaseId, connectorId },
    body: { operation: 'exclude', documentIds },
  })

  return { excludedCount: result.data.excludedCount ?? 0 }
}

export function useExcludeConnectorDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: excludeConnectorDocuments,
    onSettled: (_data, _error, variables) =>
      invalidateConnectorDocumentChange(queryClient, variables),
  })
}

async function restoreConnectorDocuments({
  knowledgeBaseId,
  connectorId,
  documentIds,
}: ConnectorDocumentMutationParams): Promise<{ restoredCount: number }> {
  const result = await requestJson(patchKnowledgeConnectorDocumentsContract, {
    params: { id: knowledgeBaseId, connectorId },
    body: { operation: 'restore', documentIds },
  })

  return { restoredCount: result.data.restoredCount ?? 0 }
}

export function useRestoreConnectorDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: restoreConnectorDocuments,
    onSettled: (_data, _error, variables) =>
      invalidateConnectorDocumentChange(queryClient, variables),
  })
}

async function connectSimSearchConnector(body: ConnectSimSearchConnectorBody) {
  const result = await requestJson(connectSimSearchConnectorContract, { body })
  return result.data
}

/**
 * One click on a Sim Search source: the source's per-member connector exists
 * afterwards and the viewer has their enrollment link. The member list and the
 * base list both gain a row on a first connect.
 */
export function useConnectSimSearchConnector() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: connectSimSearchConnector,
    onSuccess: (data) => {
      /** A first connect added a connector to the base; its own list is open on the settings page. */
      queryClient.invalidateQueries({ queryKey: connectorKeys.all(data.knowledgeBaseId) })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: searchIndexKeys.details() })
      queryClient.invalidateQueries({ queryKey: memberConnectorKeys.lists() })
      queryClient.invalidateQueries({ queryKey: searchSourceKeys.lists() })
      queryClient.invalidateQueries({ queryKey: searchIntegrationKeys.lists() })
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.lists() })
      void invalidateConnectorAccounts(queryClient)
    },
  })
}

export function usePrepareSearchSource() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: PrepareSearchSourceBody) =>
      (await requestJson(prepareSearchSourceContract, { body })).data,
    onSuccess: (_data, body) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: knowledgeKeys.lists() }),
        queryClient.invalidateQueries({
          queryKey: searchIndexKeys.detail(resourceScopeFromOwner(body)),
        }),
        queryClient.invalidateQueries({
          queryKey: searchSourceKeys.list(resourceScopeFromOwner(body)),
        }),
        invalidateConnectorAccounts(queryClient),
      ]),
  })
}
