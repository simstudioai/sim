import type { ContentSource, ContentSourceKind } from '@/lib/core/application'
import {
  type DurableSecretProvenanceRefusalCause,
  type DurableSecretProvenanceSurface,
  reportDurableSecretProvenanceRefusal,
} from '@/lib/execution/durable-secret-provenance-telemetry'

export type ContentRefusalReason = 'unknown' | 'opaque' | 'registry' | 'import'

export const CONTENT_SURFACE: Record<ContentSourceKind, DurableSecretProvenanceSurface> = {
  'workspace-file': 'workspace-file',
  'execution-file': 'workspace-file',
  'knowledge-document': 'knowledge',
  'knowledge-chunk': 'knowledge',
  'table-row': 'table-row',
  'tool-result': 'tool-result',
}

const FILE_CAUSES: Record<ContentRefusalReason, DurableSecretProvenanceRefusalCause> = {
  unknown: 'workspace-file-provenance-unavailable',
  opaque: 'workspace-file-opaque-secret-content',
  registry: 'workspace-file-registry-unavailable',
  import: 'workspace-file-provenance-unavailable',
}

const CAUSES: Record<
  ContentSourceKind,
  Record<ContentRefusalReason, DurableSecretProvenanceRefusalCause>
> = {
  'workspace-file': FILE_CAUSES,
  'execution-file': FILE_CAUSES,
  'knowledge-document': {
    unknown: 'knowledge-document-source-unavailable',
    opaque: 'knowledge-opaque-secret-content',
    registry: 'content-registry-unavailable',
    import: 'knowledge-result-provenance-unavailable',
  },
  'knowledge-chunk': {
    unknown: 'knowledge-chunk-source-unavailable',
    opaque: 'knowledge-opaque-secret-content',
    registry: 'content-registry-unavailable',
    import: 'knowledge-result-provenance-unavailable',
  },
  'tool-result': {
    unknown: 'tool-result-provenance-unavailable',
    opaque: 'tool-result-provenance-unavailable',
    registry: 'content-registry-unavailable',
    import: 'tool-result-provenance-unavailable',
  },
  'table-row': {
    unknown: 'table-row-provenance-unavailable',
    opaque: 'table-row-opaque-secret-content',
    registry: 'content-registry-unavailable',
    import: 'table-row-provenance-unavailable',
  },
}

/** Names the refused item and why, never its content. */
export function reportContentRefusal(
  source: ContentSource,
  reason: ContentRefusalReason,
  workspaceId: string | undefined
): false {
  reportDurableSecretProvenanceRefusal({
    surface: CONTENT_SURFACE[source.kind],
    cause: CAUSES[source.kind][reason],
    workspaceId,
    resourceId: source.id,
  })
  return false
}
