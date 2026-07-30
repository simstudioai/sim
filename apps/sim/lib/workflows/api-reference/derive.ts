import type { workflowPublication, workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { computeVersionChangelog } from '@/lib/workflows/api-reference/changelog'
import { deriveInputSchema, deriveOutputSchema } from '@/lib/workflows/api-reference/schema'
import type { ApiReferenceAuth, ApiReferenceEntry } from '@/lib/workflows/api-reference/types'
import { listWorkflowVersions, loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'

const logger = createLogger('ApiReferenceDerive')

export type PublicationRow = typeof workflowPublication.$inferSelect
export type WorkflowRow = typeof workflowTable.$inferSelect

/** Describes the existing caller-auth mechanism for this workflow — never invents one. */
function describeAuth(isPublicApi: boolean): ApiReferenceAuth {
  if (isPublicApi) {
    return {
      type: 'public',
      header: null,
      description:
        'This workflow is exposed as a public API. POST the input body to the invoke URL; no authentication is required.',
    }
  }
  return {
    type: 'api_key',
    header: 'x-api-key',
    description:
      'Send a Sim API key in the `x-api-key` header. A personal key (with access to this workspace) or a workspace-scoped key for this workspace is accepted. The JSON request body is passed through as the workflow input.',
  }
}

/**
 * Builds one API reference entry for a published workflow. Structure (`input`/`output`)
 * is derived live from the workflow's active deployment via `loadDeployedWorkflowState`,
 * so it always reflects what actually executes and never the in-editor draft. Prose and
 * exposure toggles come from the publication row. A published-but-undeployed workflow
 * still yields an entry (existence is intentional) with a null version and empty schema.
 */
export async function deriveApiReferenceEntry(
  workflowRow: WorkflowRow,
  publication: PublicationRow,
  workspaceId: string
): Promise<ApiReferenceEntry> {
  const workflowId = workflowRow.id
  const invokeUrl = `${getBaseUrl()}/api/workflows/${workflowId}/execute`
  const name = publication.displayName?.trim() || workflowRow.name

  let input = deriveInputSchema(null, publication.fieldOverlay)
  let output = deriveOutputSchema(null)
  try {
    const deployed = await loadDeployedWorkflowState(workflowId, workspaceId)
    input = deriveInputSchema(deployed.blocks, publication.fieldOverlay)
    output = deriveOutputSchema(deployed.blocks)
  } catch {
    logger.info('Publication has no active deployment; emitting empty schema', { workflowId })
  }

  const [{ versions }, changelog] = await Promise.all([
    listWorkflowVersions(workflowId),
    computeVersionChangelog(workflowId, workspaceId),
  ])
  const active = versions.find((v) => v.isActive) ?? null

  return {
    workflowId,
    name,
    summary: publication.summary ?? null,
    // Single source of truth for the prose: the workflow's own description (what "API
    // Settings" edits, and what the MCP tool schema uses). A publication-specific
    // description is only an optional override when the public-facing copy must differ.
    description: publication.description?.trim() || workflowRow.description || null,
    version: active?.version ?? null,
    deployedAt: active?.createdAt ? active.createdAt.toISOString() : null,
    invokeUrl,
    auth: describeAuth(workflowRow.isPublicApi ?? false),
    input,
    output,
    exposure: {
      trace: publication.exposeTrace === 'traceId' ? 'traceId' : 'off',
      blocks: Boolean(publication.exposeBlocks),
    },
    versions: changelog,
  }
}
