import type { Edge } from 'reactflow'
import type { V1WorkflowExportPayload } from '@/lib/api/contracts/v1/workflows'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { sanitizeForExport } from '@/lib/workflows/sanitization/json-sanitizer'
import { parseWorkflowVariables } from '@/lib/workflows/variables/parse'

/**
 * Server-only assembly of the public workflow-export payload, shared by the v1
 * and v2 export routes so both surfaces emit byte-identical envelopes.
 *
 * Unlike the admin export (`/api/v1/admin/workflows/[id]/export`), which emits
 * the raw state for backup/restore, this runs the payload through
 * `sanitizeForExport`, which nulls three classes of sub-block value:
 * - `password: true` fields, unless the value is a whole `{{ENV_VAR}}`
 *   reference, which is preserved so the import resolves it in the target
 *   workspace;
 * - `oauth-input` credentials;
 * - **workspace-scoped bindings** — selector fields and id-keyed fields that
 *   point at rows that do not exist in another workspace, cleared rather than
 *   carried across as dangling ids.
 *
 * The last class means an export is **not** a byte-for-byte clone even when
 * re-imported into the same workspace: those bindings come back empty and must
 * be re-selected. This matches the in-app export.
 *
 * Workflow **variables** are emitted as stored: they are plaintext workflow
 * configuration readable by anyone with workspace read (the same permission the
 * export routes require); secrets belong in environment variables, which travel
 * as unresolved `{{ENV_VAR}}` references.
 */

/** The subset of the workflow record the export payload reads. */
export interface ExportableWorkflowRecord {
  id: string
  name: string
  description: string | null
  workspaceId: string | null
  folderId: string | null
  variables: unknown
}

type ExportedEdge = V1WorkflowExportPayload['state']['edges'][number]

/**
 * Projects a persisted ReactFlow edge onto the wire shape declared by the
 * response contract. Field-by-field rather than a spread because ReactFlow's
 * `Edge` is looser than the contract in three places: handles are `null` when
 * unset (the contract and the importer both model absent as `undefined`),
 * `label` is a `ReactNode`, and the marker fields accept an `EdgeMarker`
 * object. Non-serializable values in those slots are dropped rather than
 * emitted as `{}`.
 */
function toExportedEdge(edge: Edge): ExportedEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
    type: edge.type,
    animated: edge.animated,
    style: edge.style as Record<string, unknown> | undefined,
    data: edge.data,
    label: typeof edge.label === 'string' ? edge.label : undefined,
    labelStyle: edge.labelStyle as Record<string, unknown> | undefined,
    labelShowBg: edge.labelShowBg,
    labelBgStyle: edge.labelBgStyle as Record<string, unknown> | undefined,
    labelBgPadding: edge.labelBgPadding,
    labelBgBorderRadius: edge.labelBgBorderRadius,
    markerStart: typeof edge.markerStart === 'string' ? edge.markerStart : undefined,
    markerEnd: typeof edge.markerEnd === 'string' ? edge.markerEnd : undefined,
  }
}

/**
 * Loads the workflow's normalized state, sanitizes it, and assembles the
 * portable export envelope. Returns `null` when the workflow has no persisted
 * normalized state (the caller renders its own 404).
 */
export async function buildWorkflowExportPayload(
  workflowData: ExportableWorkflowRecord
): Promise<V1WorkflowExportPayload | null> {
  const normalizedData = await loadWorkflowFromNormalizedTables(workflowData.id)
  if (!normalizedData) return null

  const sanitized = sanitizeForExport({
    blocks: normalizedData.blocks,
    edges: normalizedData.edges,
    loops: normalizedData.loops,
    parallels: normalizedData.parallels,
    metadata: {
      name: workflowData.name,
      description: workflowData.description ?? undefined,
    },
    variables: parseWorkflowVariables(workflowData.variables),
  })

  return {
    version: '1.0',
    exportedAt: sanitized.exportedAt,
    workflow: {
      id: workflowData.id,
      name: workflowData.name,
      description: workflowData.description,
      workspaceId: workflowData.workspaceId,
      folderId: workflowData.folderId,
    },
    state: {
      ...sanitized.state,
      edges: sanitized.state.edges.map(toExportedEdge),
      metadata: {
        ...sanitized.state.metadata,
        name: workflowData.name,
        description: workflowData.description ?? undefined,
        exportedAt: sanitized.exportedAt,
      },
    },
  }
}
