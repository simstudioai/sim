import { db } from '@sim/db'
import { memorySecretProvenance } from '@sim/db/schema'
import { inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { AuthType, type AuthTypeValue } from '@/lib/auth/hybrid'
import {
  type DurableSecretProvenance,
  durableSecretProvenanceFromPrivateBundle,
  EXACT_EMPTY_DURABLE_SECRET_PROVENANCE,
  importDurableSecretProvenance,
} from '@/lib/execution/durable-secret-provenance'
import {
  isDurableSecretProvenanceEnforced,
  reportUnrecordedDurableProvenance,
} from '@/lib/execution/durable-secret-provenance-enforcement'
import {
  inspectPrivateSecretProvenanceRequest,
  isPrivateSecretProvenanceBundleV1,
} from '@/lib/execution/model-input-provenance'
import {
  negotiatePrivateToolMetadataResponse,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
  serializePrivateToolMetadataResponseEnvelope,
} from '@/lib/execution/private-tool-metadata'
import { readBoundMemorySecretProvenance } from '@/lib/memory/secret-provenance'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

/**
 * Ids per sidecar lookup, matching how the rest of the codebase chunks an `inArray`.
 *
 * It was 8, which only worked because a cap refused any read over ten thousand memories — at that
 * width the page loop would otherwise have issued more than a thousand sequential statements. The
 * cap is gone because refusing on a record count told us nothing about the data, so the page size
 * now has to be the thing that keeps the read bounded.
 */
const PRIVATE_MEMORY_QUERY_CHUNK_SIZE = 1_000

interface MemoryCrossing {
  id: string
  data: unknown
  secretProvenanceVersion: number | null
}

function invalidMemoryProvenanceResponse(): NextResponse {
  return NextResponse.json({ error: 'Invalid memory secret provenance' }, { status: 400 })
}

/** Resolves write provenance while retaining headerless internal calls as legacy/untracked. */
export function resolveMemoryWriteSecretProvenance(options: {
  request: NextRequest
  payload: unknown
  authType: AuthTypeValue | undefined
  userId: string
  workspaceId: string
}):
  | { success: true; provenance?: DurableSecretProvenance }
  | { success: false; response: NextResponse } {
  const { request } = options
  const inspection = inspectPrivateSecretProvenanceRequest(request.headers, options.payload)
  if (inspection.status === 'unsupported') {
    return options.authType === AuthType.INTERNAL_JWT
      ? { success: true }
      : { success: true, provenance: EXACT_EMPTY_DURABLE_SECRET_PROVENANCE }
  }
  if (inspection.status !== 'verified' || options.authType !== AuthType.INTERNAL_JWT) {
    return { success: false, response: invalidMemoryProvenanceResponse() }
  }
  if (!isPrivateSecretProvenanceBundleV1(inspection.value)) {
    return { success: false, response: invalidMemoryProvenanceResponse() }
  }
  if (!inspection.value.complete) {
    return { success: true, provenance: { status: 'unknown' } }
  }
  if (inspection.value.selections.length !== 1) {
    return { success: false, response: invalidMemoryProvenanceResponse() }
  }
  const provenance = durableSecretProvenanceFromPrivateBundle(inspection.value, 'data', {
    userId: options.userId,
    workspaceId: options.workspaceId,
  })
  return provenance
    ? { success: true, provenance }
    : { success: false, response: invalidMemoryProvenanceResponse() }
}

/** Adds private response provenance only when an authenticated tool caller requests it. */
export async function createMemoryResponse(options: {
  request: NextRequest
  authType: AuthTypeValue | undefined
  userId: string
  workspaceId: string
  body: Record<string, unknown>
  memories: MemoryCrossing[]
}): Promise<NextResponse> {
  const { request } = options
  const negotiation = negotiatePrivateToolMetadataResponse(
    request.headers,
    RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    options.authType === AuthType.INTERNAL_JWT
  )
  if (negotiation.status === 'not-requested') return NextResponse.json(options.body)
  if (negotiation.status === 'rejected') return invalidMemoryProvenanceResponse()

  const registry = new ResolvedSecretTraceRegistry([], {
    userId: options.userId,
    workspaceId: options.workspaceId,
  })
  /**
   * No cap on how many memories may cross, and no separate accounting of what they carry.
   *
   * There was both: a refusal past ten thousand records, and a running total of every sidecar's
   * entries. The first said nothing about the data. The second summed entries *before* they were
   * folded, so a page of memories sharing a handful of secrets counted once per mention and could
   * refuse a read whose envelope would have held a dozen entries.
   *
   * Neither is needed, because the registry already bounds the only thing that has a real limit —
   * the serialized envelope — as each entry is added, at the granularity it actually dedupes on.
   * A second estimate in front of it could only ever be wrong in one of two directions.
   */
  const ids = [...new Set(options.memories.map((record) => record.id))]
  const memoriesById = new Map<string, MemoryCrossing[]>()
  for (const memory of options.memories) {
    const matching = memoriesById.get(memory.id) ?? []
    matching.push(memory)
    memoriesById.set(memory.id, matching)
  }
  /**
   * Counted only while the surface is open. Under enforcement the import fails the registry closed
   * instead of proceeding, so counting those records would audit a fail-open read that never
   * happened — and this entry exists precisely to say a read went ahead unvouched.
   */
  const memoryEnforced = isDurableSecretProvenanceEnforced('memory')
  let unrecordedMemoryCount = 0
  for (let index = 0; index < ids.length; index += PRIVATE_MEMORY_QUERY_CHUNK_SIZE) {
    const pageIds = ids.slice(index, index + PRIVATE_MEMORY_QUERY_CHUNK_SIZE)
    const sidecars = await db
      .select()
      .from(memorySecretProvenance)
      .where(inArray(memorySecretProvenance.memoryId, pageIds))
    const sidecarById = new Map(sidecars.map((sidecar) => [sidecar.memoryId, sidecar]))
    for (const memoryId of pageIds) {
      for (const record of memoriesById.get(memoryId) ?? []) {
        const sidecar = sidecarById.get(record.id)
        const provenance = readBoundMemorySecretProvenance({
          secretProvenanceVersion: record.secretProvenanceVersion,
          data: record.data,
          provenanceContentHash: sidecar?.contentHash ?? null,
          status: sidecar?.status ?? null,
          entries: sidecar?.entries,
        })
        if (provenance.status === 'unknown' && !memoryEnforced) unrecordedMemoryCount += 1
        await importDurableSecretProvenance(registry, provenance, record.data, 'memory', {
          reportUnrecorded: false,
        })
      }
    }
  }

  /**
   * Counted here and reported once, rather than left to the per-record import.
   *
   * That import reports without a workspace, so the workspace-visible half of the trail never
   * reached the people it concerns — the audit entry is skipped when it cannot name one. Passing
   * the workspace down instead would have written one row per record, which on a wide read is
   * thousands of fire-and-forget inserts for a single event. One read is one thing that happened,
   * so it is one entry carrying how many records it covered — the shape the table surface uses.
   */
  if (unrecordedMemoryCount > 0) {
    reportUnrecordedDurableProvenance({
      surface: 'memory',
      cause: 'durable-provenance-unknown',
      affectedCount: unrecordedMemoryCount,
      workspaceId: options.workspaceId,
      actorUserId: options.userId,
    })
  }

  const envelope = serializePrivateToolMetadataResponseEnvelope(
    options.body,
    RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    registry.exportCommittedProvenanceForValue(options.body)
  )
  return NextResponse.json(envelope.body, { headers: envelope.headers })
}
