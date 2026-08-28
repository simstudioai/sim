import type { InternalJsonResponseFinalization } from '@/lib/api/server/routes/internal-json-route'
import { AuthType, type AuthTypeValue } from '@/lib/auth/hybrid'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  createDurableSecretProvenanceRegistry,
  type DurableSecretProvenance,
  durableSecretProvenanceFromPrivateBundle,
  EXACT_EMPTY_DURABLE_SECRET_PROVENANCE,
} from '@/lib/execution/durable-secret-provenance'
import {
  inspectPrivateSecretProvenanceRequest,
  isPrivateSecretProvenanceBundleV1,
} from '@/lib/execution/model-input-provenance'
import {
  negotiatePrivateToolMetadataResponse,
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
  serializePrivateToolMetadataResponseEnvelope,
} from '@/lib/execution/private-tool-metadata'
import {
  importKnowledgePersistedResponseSecretProvenance,
  type KnowledgeDocumentSourceValue,
  type KnowledgeDocumentWriteSecretProvenance,
} from '@/lib/knowledge/secret-provenance'
import {
  knowledgeDocumentContentSelectionKey,
  knowledgeDocumentFilenameSelectionKey,
  knowledgeDocumentTagValueSelectionKey,
  parseKnowledgeDocumentTagProvenanceTargets,
} from '@/lib/knowledge/secret-provenance-selection'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

function invalidKnowledgeProvenanceResponse(): Response {
  return Response.json({ error: 'Invalid knowledge secret provenance' }, { status: 400 })
}

function rejectInvalidKnowledgeProvenance(): never {
  throw new OrchestrationError('validation', 'Invalid knowledge secret provenance')
}

function finalizeKnowledgeMetadataEnvelope(
  envelope: ReturnType<typeof serializePrivateToolMetadataResponseEnvelope>
): InternalJsonResponseFinalization {
  return {
    bodyFields: {
      [RESOLVED_SECRET_PROVENANCE_FIELD]: envelope.body[RESOLVED_SECRET_PROVENANCE_FIELD],
    },
    headers: envelope.headers,
  }
}

type KnowledgeWriteProvenanceResolution =
  | { success: true; provenances?: DurableSecretProvenance[] }
  | { success: false; response: Response }

/** Resolves private document/chunk write selections after auth and workspace authorization. */
export function resolveKnowledgeWriteSecretProvenance(options: {
  headers: Headers
  payload: unknown
  authType: AuthTypeValue | undefined
  userId: string
  workspaceId?: string
  selectionKeys: readonly string[]
}): KnowledgeWriteProvenanceResolution {
  const inspection = inspectPrivateSecretProvenanceRequest(options.headers, options.payload)
  if (inspection.status === 'unsupported') {
    return options.authType === AuthType.INTERNAL_JWT
      ? { success: true }
      : {
          success: true,
          provenances: options.selectionKeys.map(() => EXACT_EMPTY_DURABLE_SECRET_PROVENANCE),
        }
  }
  if (inspection.status !== 'verified' || options.authType !== AuthType.INTERNAL_JWT) {
    return { success: false, response: invalidKnowledgeProvenanceResponse() }
  }
  if (!isPrivateSecretProvenanceBundleV1(inspection.value)) {
    return { success: false, response: invalidKnowledgeProvenanceResponse() }
  }
  if (!inspection.value.complete) {
    return {
      success: true,
      provenances: options.selectionKeys.map(() => ({ status: 'unknown' })),
    }
  }
  if (inspection.value.selections.length !== options.selectionKeys.length) {
    return { success: false, response: invalidKnowledgeProvenanceResponse() }
  }
  const provenances = options.selectionKeys.map((selectionKey) =>
    durableSecretProvenanceFromPrivateBundle(inspection.value, selectionKey, {
      userId: options.userId,
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    })
  )
  if (provenances.some((provenance) => provenance === undefined)) {
    return { success: false, response: invalidKnowledgeProvenanceResponse() }
  }
  return { success: true, provenances: provenances as DurableSecretProvenance[] }
}

type KnowledgeDocumentWriteProvenanceResolution =
  | { success: true; provenances?: KnowledgeDocumentWriteSecretProvenance[] }
  | { success: false; response: Response }

/** Resolves provenance for durable document fields; persisted tag names remain raw and untracked. */
export function resolveKnowledgeDocumentWriteSecretProvenance(options: {
  headers: Headers
  payload: unknown
  authType: AuthTypeValue | undefined
  userId: string
  workspaceId?: string
  documents: readonly { documentTagsData?: string }[]
}): KnowledgeDocumentWriteProvenanceResolution {
  const tagTargets = options.documents.map((document) =>
    parseKnowledgeDocumentTagProvenanceTargets(document.documentTagsData)
  )
  const selectionKeys = options.documents.flatMap((_document, documentIndex) => [
    knowledgeDocumentFilenameSelectionKey(documentIndex),
    knowledgeDocumentContentSelectionKey(documentIndex),
    ...tagTargets[documentIndex].map((_tag, tagIndex) =>
      knowledgeDocumentTagValueSelectionKey(documentIndex, tagIndex)
    ),
  ])
  const resolved = resolveKnowledgeWriteSecretProvenance({
    headers: options.headers,
    payload: options.payload,
    authType: options.authType,
    userId: options.userId,
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    selectionKeys,
  })
  if (!resolved.success) return resolved
  if (!resolved.provenances) return { success: true }

  let provenanceIndex = 0
  const provenances: KnowledgeDocumentWriteSecretProvenance[] = []
  for (const tags of tagTargets) {
    const filename = resolved.provenances[provenanceIndex++]
    const content = resolved.provenances[provenanceIndex++]
    const tagProvenances: KnowledgeDocumentWriteSecretProvenance['tags'][number][] = []
    for (const tag of tags) {
      const tagValue = resolved.provenances[provenanceIndex++]
      tagProvenances.push({ tagName: tag.tagName, provenance: tagValue })
    }
    provenances.push({ filename, content, tags: tagProvenances })
  }
  return { success: true, provenances }
}

/** Finalizes private provenance after the functional Knowledge response passes its contract. */
export async function finalizeKnowledgeProvenanceResponse(options: {
  headers: Headers
  authType: AuthTypeValue | undefined
  userId: string
  workspaceId?: string
  body: Record<string, unknown>
  provenances: readonly DurableSecretProvenance[]
}): Promise<InternalJsonResponseFinalization> {
  const negotiation = negotiatePrivateToolMetadataResponse(
    options.headers,
    RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    options.authType === AuthType.INTERNAL_JWT
  )
  if (negotiation.status === 'not-requested') return {}
  if (negotiation.status === 'rejected') rejectInvalidKnowledgeProvenance()
  const registry = new ResolvedSecretTraceRegistry([], {
    userId: options.userId,
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
  })
  for (const provenance of options.provenances) {
    if (provenance.status === 'unknown') {
      registry.markIncomplete('durable-provenance-unknown')
      break
    }
    const sourceRegistry = await createDurableSecretProvenanceRegistry(provenance, {
      userId: options.userId,
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    })
    if (sourceRegistry) registry.mergeToolCallRegistry(sourceRegistry)
  }
  const envelope = serializePrivateToolMetadataResponseEnvelope(
    options.body,
    RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    registry.exportCommittedProvenanceForValue(options.body)
  )
  return finalizeKnowledgeMetadataEnvelope(envelope)
}

/** Serializes an already-populated request registry as private response metadata. */
export function finalizeKnowledgeRegistryResponse(options: {
  headers: Headers
  authType: AuthTypeValue | undefined
  body: Record<string, unknown>
  registry: ResolvedSecretTraceRegistry
}): InternalJsonResponseFinalization {
  const negotiation = negotiatePrivateToolMetadataResponse(
    options.headers,
    RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    options.authType === AuthType.INTERNAL_JWT
  )
  if (negotiation.status === 'not-requested') return {}
  if (negotiation.status === 'rejected') rejectInvalidKnowledgeProvenance()
  const envelope = serializePrivateToolMetadataResponseEnvelope(
    options.body,
    RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    options.registry.exportCommittedProvenanceForValue(options.body)
  )
  return finalizeKnowledgeMetadataEnvelope(envelope)
}

/** Emits private response provenance for a bounded exact snapshot of persisted KB rows. */
export async function finalizeKnowledgePersistedResponse(options: {
  headers: Headers
  authType: AuthTypeValue | undefined
  userId: string
  workspaceId?: string
  body: Record<string, unknown>
  documents?: readonly {
    id: string
    source: KnowledgeDocumentSourceValue
    value: unknown
  }[]
  chunks?: readonly {
    id: string
    documentId: string
    content: string
    value: unknown
  }[]
}): Promise<InternalJsonResponseFinalization> {
  const negotiation = negotiatePrivateToolMetadataResponse(
    options.headers,
    RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    options.authType === AuthType.INTERNAL_JWT
  )
  if (negotiation.status === 'not-requested') return {}
  if (negotiation.status === 'rejected') rejectInvalidKnowledgeProvenance()

  const registry = new ResolvedSecretTraceRegistry([], {
    userId: options.userId,
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
  })
  await importKnowledgePersistedResponseSecretProvenance({
    registry,
    documents: options.documents,
    chunks: options.chunks,
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    actorUserId: options.userId,
  })
  return finalizeKnowledgeRegistryResponse({
    headers: options.headers,
    authType: options.authType,
    body: options.body,
    registry,
  })
}
