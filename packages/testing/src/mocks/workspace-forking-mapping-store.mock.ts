import { vi } from 'vitest'

/** Shape of a persisted fork mapping row (`ForkMappingRow`) the pure helpers read. */
interface MockForkMappingRow {
  resourceType: string
  parentResourceId: string
  childResourceId: string | null
  [key: string]: unknown
}

/** Shape of a mapping upsert entry (`ForkMappingUpsert`). */
interface MockForkMappingUpsert {
  resourceType: string
  parentResourceId: string
  childResourceId: string | null
}

/** Options read by `buildForkResolver` (`BuildForkResolverOptions`). */
interface MockBuildForkResolverOptions {
  sourceIsParent: boolean
  targetEnvKeys?: Set<string>
  sourceEnvKeys?: Set<string>
  validTargetIdsByKind?: Partial<Record<string, Set<string>>>
}

const RESOURCE_TYPE_TO_FORK_KIND: Record<string, string | null> = {
  workflow: null,
  oauth_credential: 'credential',
  service_account_credential: 'credential',
  env_var: 'env-var',
  table: 'table',
  knowledge_base: 'knowledge-base',
  knowledge_document: 'knowledge-document',
  file: 'file',
  file_folder: 'file-folder',
  mcp_server: 'mcp-server',
  workflow_mcp_server: null,
  custom_block: 'custom-block',
  custom_tool: 'custom-tool',
  skill: 'skill',
  sandbox: 'sandbox',
}

const NON_CREDENTIAL_FORK_KIND_TO_RESOURCE_TYPE: Record<string, string> = {
  'env-var': 'env_var',
  table: 'table',
  'knowledge-base': 'knowledge_base',
  'knowledge-document': 'knowledge_document',
  file: 'file',
  'file-folder': 'file_folder',
  'mcp-server': 'mcp_server',
  'custom-tool': 'custom_tool',
  'custom-block': 'custom_block',
  skill: 'skill',
  sandbox: 'sandbox',
}

function resourceTypeToForkKind(resourceType: string): string | null {
  return RESOURCE_TYPE_TO_FORK_KIND[resourceType] ?? null
}

/**
 * Controllable mock functions for `@/ee/workspace-forking/lib/mapping/mapping-store`.
 *
 * The persistence functions (`getEdgeMappingRows`, `deleteWorkflowIdentityByIds`,
 * `seedEdgeMappings`, `upsertEdgeMappings`, `persistCopiedResourceMappings`,
 * `deleteEdgeMappingsByChildResources`, `deleteCopiedResourceMappingsByTargets`) are bare
 * `vi.fn()` (resolve `undefined` when awaited). The pure helpers are faithful ports of the real
 * logic: `resourceTypeToForkKind`, `nonCredentialForkKindToResourceType`,
 * `orientCopiedResourceMappings` (swaps sides and emits delete keys when the source is the child)
 * and `buildForkResolver` (direction-aware id index with the env-var identity fallbacks).
 *
 * @example
 * ```ts
 * import { workspaceForkingMappingStoreMockFns } from '@sim/testing/mocks/workspace-forking-mapping-store.mock'
 *
 * workspaceForkingMappingStoreMockFns.mockGetEdgeMappingRows.mockResolvedValue([])
 * ```
 */
export const workspaceForkingMappingStoreMockFns = {
  mockResourceTypeToForkKind: vi.fn(resourceTypeToForkKind),
  mockNonCredentialForkKindToResourceType: vi.fn(
    (kind: string): string => NON_CREDENTIAL_FORK_KIND_TO_RESOURCE_TYPE[kind]
  ),
  mockGetEdgeMappingRows: vi.fn(),
  mockDeleteWorkflowIdentityByIds: vi.fn(),
  mockSeedEdgeMappings: vi.fn(),
  mockUpsertEdgeMappings: vi.fn(),
  mockOrientCopiedResourceMappings: vi.fn(
    (
      sourceIsParent: boolean,
      entries: MockForkMappingUpsert[]
    ): {
      entries: MockForkMappingUpsert[]
      deleteKeys: Array<{ resourceType: string; childResourceId: string }>
    } => {
      if (sourceIsParent) return { entries, deleteKeys: [] }
      const oriented: MockForkMappingUpsert[] = []
      const deleteKeys: Array<{ resourceType: string; childResourceId: string }> = []
      for (const entry of entries) {
        if (entry.childResourceId == null) continue
        oriented.push({
          resourceType: entry.resourceType,
          parentResourceId: entry.childResourceId,
          childResourceId: entry.parentResourceId,
        })
        deleteKeys.push({
          resourceType: entry.resourceType,
          childResourceId: entry.parentResourceId,
        })
      }
      return { entries: oriented, deleteKeys }
    }
  ),
  mockPersistCopiedResourceMappings: vi.fn(),
  mockDeleteEdgeMappingsByChildResources: vi.fn(),
  mockDeleteCopiedResourceMappingsByTargets: vi.fn(),
  mockBuildForkResolver: vi.fn(
    (
      rows: MockForkMappingRow[],
      options: MockBuildForkResolverOptions
    ): ((kind: string, sourceId: string) => string | null) => {
      const index = new Map<string, Map<string, string>>()
      for (const row of rows) {
        const kind = resourceTypeToForkKind(row.resourceType)
        if (!kind) continue
        if (row.childResourceId == null) continue
        const sourceId = options.sourceIsParent ? row.parentResourceId : row.childResourceId
        const targetId = options.sourceIsParent ? row.childResourceId : row.parentResourceId
        let kindIndex = index.get(kind)
        if (!kindIndex) {
          kindIndex = new Map()
          index.set(kind, kindIndex)
        }
        kindIndex.set(sourceId, targetId)
      }
      return (kind, sourceId) => {
        const mapped = index.get(kind)?.get(sourceId)
        if (mapped != null) {
          const validSet = options.validTargetIdsByKind?.[kind]
          if (!validSet || validSet.has(mapped)) return mapped
        }
        if (kind === 'env-var') {
          if (options.sourceEnvKeys && !options.sourceEnvKeys.has(sourceId)) return sourceId
          if (options.targetEnvKeys?.has(sourceId)) return sourceId
        }
        return null
      }
    }
  ),
}

/**
 * Static mock module for `@/ee/workspace-forking/lib/mapping/mapping-store`. Covers every runtime
 * export.
 *
 * @example
 * ```ts
 * vi.mock('@/ee/workspace-forking/lib/mapping/mapping-store', () => workspaceForkingMappingStoreMock)
 * ```
 */
export const workspaceForkingMappingStoreMock = {
  resourceTypeToForkKind: workspaceForkingMappingStoreMockFns.mockResourceTypeToForkKind,
  nonCredentialForkKindToResourceType:
    workspaceForkingMappingStoreMockFns.mockNonCredentialForkKindToResourceType,
  getEdgeMappingRows: workspaceForkingMappingStoreMockFns.mockGetEdgeMappingRows,
  deleteWorkflowIdentityByIds: workspaceForkingMappingStoreMockFns.mockDeleteWorkflowIdentityByIds,
  seedEdgeMappings: workspaceForkingMappingStoreMockFns.mockSeedEdgeMappings,
  upsertEdgeMappings: workspaceForkingMappingStoreMockFns.mockUpsertEdgeMappings,
  orientCopiedResourceMappings:
    workspaceForkingMappingStoreMockFns.mockOrientCopiedResourceMappings,
  persistCopiedResourceMappings:
    workspaceForkingMappingStoreMockFns.mockPersistCopiedResourceMappings,
  deleteEdgeMappingsByChildResources:
    workspaceForkingMappingStoreMockFns.mockDeleteEdgeMappingsByChildResources,
  deleteCopiedResourceMappingsByTargets:
    workspaceForkingMappingStoreMockFns.mockDeleteCopiedResourceMappingsByTargets,
  buildForkResolver: workspaceForkingMappingStoreMockFns.mockBuildForkResolver,
}
