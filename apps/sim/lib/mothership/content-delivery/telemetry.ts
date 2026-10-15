import type { ContentSource, ContentSourceKind } from '@/lib/core/application'
import {
  type DurableSecretProvenanceRefusalCause,
  type DurableSecretProvenanceRefusalReport,
  type DurableSecretProvenanceSurface,
  reportDurableSecretProvenanceRefusals,
} from '@/lib/execution/durable-secret-provenance-telemetry'

type ContentRefusalReason = 'unknown' | 'opaque' | 'registry' | 'import'

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

/**
 * Collects the items one admission refuses and reports them once, naming each item and why, never
 * its content. A page of legacy rows is one line, not one per row.
 */
export interface ContentRefusals {
  /** Records the refusal of `source`; returns the verdict, `false`. */
  refuse(source: ContentSource, reason: ContentRefusalReason): false
  /** Reports what was recorded, as one line. */
  report(): void
}

export function createContentRefusals(workspaceId: string | undefined): ContentRefusals {
  const reports: DurableSecretProvenanceRefusalReport[] = []
  return {
    refuse(source: ContentSource, reason: ContentRefusalReason): false {
      reports.push({
        surface: CONTENT_SURFACE[source.kind],
        cause: CAUSES[source.kind][reason],
        workspaceId,
        resourceId: source.id,
      })
      return false
    },
    report(): void {
      reportDurableSecretProvenanceRefusals(reports)
    },
  }
}

const WITHHELD_LABELS: Record<ContentSourceKind, readonly [string, string]> = {
  'workspace-file': ['file', 'files'],
  'execution-file': ['run file', 'run files'],
  'knowledge-document': ['knowledge document', 'knowledge documents'],
  'knowledge-chunk': ['knowledge chunk', 'knowledge chunks'],
  'table-row': ['table row', 'table rows'],
  'tool-result': ['tool result', 'tool results'],
}

/**
 * Tells Chat's model what a result left out: a refused item is dropped from the page it was read
 * in, which otherwise reads exactly like an item that does not exist.
 */
export function describeWithheldContent(
  withheld: ReadonlyMap<ContentSourceKind, number>
): string | undefined {
  const lines = [...withheld].map(([kind, count]) => {
    const [singular, plural] = WITHHELD_LABELS[kind]
    return count === 1
      ? `Note: 1 ${singular} was withheld from this result because its secret provenance is unavailable. It exists; reading it again will not return it.`
      : `Note: ${count} ${plural} were withheld from this result because their secret provenance is unavailable. They exist; reading them again will not return them.`
  })
  return lines.length > 0 ? lines.join('\n') : undefined
}
