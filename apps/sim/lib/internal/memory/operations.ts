import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import type { ContractBody, ContractQuery } from '@/lib/api/contracts'
import type {
  createMemoryContract,
  deleteMemoryByQueryContract,
  listMemoriesContract,
} from '@/lib/api/contracts/memory'
import { requireWorkspaceBillingAttributionHeader } from '@/lib/billing/core/billing-attribution'
import {
  memoryToolRequestsProvenance,
  memoryToolSuppliesWriteProvenance,
  readMemoryWriteProvenance,
} from '@/lib/internal/memory/provenance'
import {
  appendMemoryUseCase,
  deleteMemoryUseCase,
  listMemoriesUseCase,
  type MemoryLegacyProvenanceScope,
  type MemoryReadProvenance,
  readMemoryUseCase,
} from '@/lib/memory/application/use-cases'

export interface MemoryToolOperationContext {
  principal: WorkflowExecutionDelegatedPrincipal
  headers: Headers
  signal?: AbortSignal
}

export interface MemoryToolOperationResult {
  body: Record<string, unknown>
  provenance?: MemoryReadProvenance[]
  provenanceScope?: MemoryLegacyProvenanceScope
}

function complete<T>(context: MemoryToolOperationContext, value: T): T {
  context.signal?.throwIfAborted()
  return value
}

export async function executeMemoryAdd(
  body: ContractBody<typeof createMemoryContract>,
  context: MemoryToolOperationContext
): Promise<MemoryToolOperationResult> {
  const includePersistedSecretProvenance = memoryToolRequestsProvenance(context.headers)
  const resolveWriteProvenance = memoryToolSuppliesWriteProvenance(context.headers, body)
    ? (scope: MemoryLegacyProvenanceScope) =>
        readMemoryWriteProvenance(context.headers, body, scope)
    : undefined
  const result = await appendMemoryUseCase.execute({
    principal: context.principal,
    input: {
      workspaceId: context.principal.workspaceId,
      key: body.key ?? '',
      data: body.data,
      ...(resolveWriteProvenance ? { resolveWriteProvenance } : {}),
      includePersistedSecretProvenance,
      resolveBillingAttribution: async (workspaceId) =>
        requireWorkspaceBillingAttributionHeader(context.headers, { workspaceId }),
      signal: context.signal,
    },
  })
  return complete(context, {
    body: {
      success: true,
      data: { conversationId: result.record.key, data: result.record.data },
    },
    provenance: result.readProvenance,
    provenanceScope: result.provenanceScope,
  })
}

export async function executeMemoryList(
  query: ContractQuery<typeof listMemoriesContract>,
  context: MemoryToolOperationContext
): Promise<MemoryToolOperationResult> {
  const result = await listMemoriesUseCase.execute({
    principal: context.principal,
    input: {
      workspaceId: context.principal.workspaceId,
      query: query.query,
      limit: query.limit,
      includePersistedSecretProvenance: memoryToolRequestsProvenance(context.headers),
      resolveBillingAttribution: async (workspaceId) =>
        requireWorkspaceBillingAttributionHeader(context.headers, { workspaceId }),
      signal: context.signal,
    },
  })
  return complete(context, {
    body: {
      success: true,
      data: {
        memories: result.records.map((record) => ({
          conversationId: record.key,
          data: record.data,
        })),
      },
    },
    provenance: result.readProvenance,
    provenanceScope: result.provenanceScope,
  })
}

export async function executeMemoryGet(
  key: string,
  context: MemoryToolOperationContext
): Promise<MemoryToolOperationResult> {
  const result = await readMemoryUseCase.execute({
    principal: context.principal,
    input: {
      workspaceId: context.principal.workspaceId,
      key,
      includePersistedSecretProvenance: memoryToolRequestsProvenance(context.headers),
      resolveBillingAttribution: async (workspaceId) =>
        requireWorkspaceBillingAttributionHeader(context.headers, { workspaceId }),
      signal: context.signal,
    },
  })
  return complete(context, {
    body: {
      success: true,
      data: result.record ? { conversationId: result.record.key, data: result.record.data } : null,
    },
    provenance: result.readProvenance,
    provenanceScope: result.provenanceScope,
  })
}

export async function executeMemoryDelete(
  query: ContractQuery<typeof deleteMemoryByQueryContract>,
  context: MemoryToolOperationContext
): Promise<MemoryToolOperationResult> {
  const result = await deleteMemoryUseCase.execute({
    principal: context.principal,
    input: {
      workspaceId: context.principal.workspaceId,
      key: query.conversationId ?? '',
      signal: context.signal,
    },
  })
  return complete(context, {
    body: {
      success: true,
      data: {
        message:
          result.deletedCount > 0
            ? `Successfully deleted ${result.deletedCount} memories`
            : 'No memories found matching the criteria',
        deletedCount: result.deletedCount,
      },
    },
  })
}
