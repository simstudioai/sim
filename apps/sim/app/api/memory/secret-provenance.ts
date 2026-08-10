import { Buffer } from 'buffer'
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

const MAX_PRIVATE_MEMORY_CROSSINGS = 10_000
const PRIVATE_MEMORY_QUERY_CHUNK_SIZE = 8
const MAX_PRIVATE_MEMORY_PROVENANCE_ENTRIES = 10_000
const MAX_PRIVATE_MEMORY_PROVENANCE_BYTES = 8 * 1024 * 1024

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
  if (options.memories.length > MAX_PRIVATE_MEMORY_CROSSINGS) {
    registry.markIncomplete()
  } else {
    const ids = [...new Set(options.memories.map((record) => record.id))]
    const memoriesById = new Map<string, MemoryCrossing[]>()
    for (const memory of options.memories) {
      const matching = memoriesById.get(memory.id) ?? []
      matching.push(memory)
      memoriesById.set(memory.id, matching)
    }
    let provenanceEntryCount = 0
    let provenanceBytes = 0
    for (let index = 0; index < ids.length; index += PRIVATE_MEMORY_QUERY_CHUNK_SIZE) {
      const pageIds = ids.slice(index, index + PRIVATE_MEMORY_QUERY_CHUNK_SIZE)
      const sidecars = await db
        .select()
        .from(memorySecretProvenance)
        .where(inArray(memorySecretProvenance.memoryId, pageIds))
      for (const sidecar of sidecars) {
        provenanceEntryCount += Array.isArray(sidecar.entries) ? sidecar.entries.length : 0
        provenanceBytes += Buffer.byteLength(JSON.stringify(sidecar.entries ?? []), 'utf8')
      }
      if (
        provenanceEntryCount > MAX_PRIVATE_MEMORY_PROVENANCE_ENTRIES ||
        provenanceBytes > MAX_PRIVATE_MEMORY_PROVENANCE_BYTES
      ) {
        registry.markIncomplete()
        break
      }
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
          await importDurableSecretProvenance(registry, provenance, record.data, 'memory')
        }
      }
    }
  }

  const envelope = serializePrivateToolMetadataResponseEnvelope(
    options.body,
    RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    registry.exportCommittedProvenanceForValue(options.body)
  )
  return NextResponse.json(envelope.body, { headers: envelope.headers })
}
