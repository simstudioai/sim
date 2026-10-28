import type {
  ContentRefusalReason,
  ContentSource,
  ContentSourceKind,
  WithheldContent,
} from '@/lib/core/application'
import {
  type DurableSecretProvenanceRefusalCause,
  type DurableSecretProvenanceRefusalReport,
  type DurableSecretProvenanceSurface,
  reportDurableSecretProvenanceRefusals,
} from '@/lib/execution/durable-secret-provenance-telemetry'

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
 * Collects the items one admission refuses and reports them once per surface and cause, naming
 * each item by its id and why, never its content. A page of legacy rows is one line.
 */
export interface ContentRefusals {
  /** Records the refusal of `source`; returns the verdict, its reason. */
  refuse(source: ContentSource, reason: ContentRefusalReason): ContentRefusalReason
  /** Reports what was recorded. */
  report(): void
}

export function createContentRefusals(workspaceId: string | undefined): ContentRefusals {
  const reports: DurableSecretProvenanceRefusalReport[] = []
  return {
    refuse(source, reason) {
      reports.push({
        surface: CONTENT_SURFACE[source.kind],
        cause: CAUSES[source.kind][reason],
        workspaceId,
        resourceId: source.id,
      })
      return reason
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

/** What each refusal means for Chat's next read, as `[one item, several items]`. */
const WITHHELD_REASONS: Record<ContentRefusalReason, readonly [string, string]> = {
  unknown: [
    'its secret provenance is unknown, so reading it again will not return it. It exists; do not treat it as missing.',
    'their secret provenance is unknown, so reading them again will not return them. They exist; do not treat them as missing.',
  ],
  opaque: [
    'it contains recorded secrets and cannot be shown as raw bytes or a preview. Read it as text for a redacted copy.',
    'they contain recorded secrets and cannot be shown as raw bytes or a preview. Read them as text for a redacted copy.',
  ],
  registry: [
    'its secret provenance could not be verified right now. It may be readable on a later request.',
    'their secret provenance could not be verified right now. They may be readable on a later request.',
  ],
  import: [
    'its secret provenance could not be verified right now. It may be readable on a later request.',
    'their secret provenance could not be verified right now. They may be readable on a later request.',
  ],
}

/**
 * Tells Chat's model what a result left out, and what to do about it: a refused item is dropped
 * from the page it was read in, which otherwise reads exactly like an item that does not exist,
 * and a model that cannot tell why keeps reading it again. Names no item.
 */
export function describeWithheldContent(withheld: WithheldContent): string | undefined {
  const lines: string[] = []
  for (const [kind, reasons] of withheld) {
    for (const [reason, count] of reasons) {
      const form = count === 1 ? 0 : 1
      lines.push(
        `Note: ${count} ${WITHHELD_LABELS[kind][form]} ${count === 1 ? 'was' : 'were'} withheld from this result: ${WITHHELD_REASONS[reason][form]}`
      )
    }
  }
  return lines.length > 0 ? lines.join('\n') : undefined
}
