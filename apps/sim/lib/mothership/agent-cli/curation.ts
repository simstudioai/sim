/**
 * Viewer curation for `blocks get` (18-agent-surface.md B3). The v2 catalog already
 * hides blocks by visibility, allowlist and hosted-key restrictions, but it does not
 * apply a permission group's `deniedTools`; the mothership asks for `curate: "block"`
 * so a partially-denied block is trimmed to the operations this viewer may configure.
 */

import { omit } from '@sim/utils/object'
import { z } from 'zod'
import { mothershipBlockDetailSchema } from '@/lib/api/contracts/mothership-catalog'
import { type V2BlockDetail, v2BlockDetailSchema } from '@/lib/api/contracts/v2/catalog'
import { projectBlockOutputs } from '@/lib/catalog/projection/block-detail'
import { resolveDeniedBlockOperations } from '@/lib/integrations/tool-projection'
import { withModelHints } from '@/lib/mothership/agent-cli/model-hints'
import { withToolBindingHints } from '@/lib/mothership/agent-cli/tool-binding-hints'
import { agentCliFail } from '@/lib/mothership/agent-cli/types'
import type { AgentCliRawResult } from '@/lib/mothership/generated/agent-cli'
import { createToolAccessGate } from '@/lib/permission-groups/operation-access'
import { getTableQueryAvailability } from '@/lib/table/query-availability'
import { getBlockOutputs } from '@/lib/workflows/blocks/block-outputs'
import { inputFormatValueSchema } from '@/lib/workflows/input-format-schema'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'
import { getUserPermissionConfig } from '@/ee/access-control/utils/permission-check'

export interface CurationViewer {
  workspaceId: string
  userId: string
}

const { $schema: _schemaVersion, ...inputFormatSchema } = z.toJSONSchema(inputFormatValueSchema)

function parseBlockDetail(stdout: string): V2BlockDetail | null {
  try {
    const parsed = v2BlockDetailSchema.safeParse(JSON.parse(stdout))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

async function curatePermittedBlockDetail(
  result: AgentCliRawResult,
  viewer: CurationViewer
): Promise<AgentCliRawResult> {
  const detail = parseBlockDetail(result.stdout)
  if (!detail) return result
  const config = await getUserPermissionConfig(viewer.userId, viewer.workspaceId)
  const deniedTools = config?.deniedTools
  if (!deniedTools?.length) return result
  const isToolAllowed = createToolAccessGate(deniedTools)
  const denied = resolveDeniedBlockOperations(deniedTools, isToolAllowed)
  if (denied.fullyDenied.has(detail.id)) {
    return agentCliFail(`Block "${detail.id}" is not available to you in this workspace.`)
  }
  const deniedOperations = denied.needsProjection.get(detail.id)
  if (!deniedOperations) return result
  const operations = omit(detail.operations, [...deniedOperations])
  const tools = detail.tools.filter((tool) => isToolAllowed(tool.id))
  const inputSchema = detail.inputSchema.map((field) =>
    field.id === 'operation'
      ? { ...field, options: field.options?.filter((option) => !deniedOperations.has(option.id)) }
      : field
  )
  return {
    ...result,
    stdout: JSON.stringify({
      ...detail,
      operations,
      operationIds: detail.operationIds.filter((id) => !deniedOperations.has(id)),
      operationInputSchema: omit(detail.operationInputSchema, [...deniedOperations]),
      inputSchema,
      tools,
      toolIds: detail.toolIds.filter(isToolAllowed),
    }),
  }
}

/** Static hints follow the existing authorized read and per-viewer operation projection. */
export async function curateBlockDetail(
  result: AgentCliRawResult,
  viewer: CurationViewer
): Promise<AgentCliRawResult> {
  const permitted = await curatePermittedBlockDetail(result, viewer)
  if (permitted.exitCode !== 0) return permitted
  const detail = parseBlockDetail(permitted.stdout)
  if (!detail) return permitted
  const hasInputFormat = detail.inputSchema.some((field) => field.type === 'input-format')
  let enriched = withModelHints(
    hasInputFormat
      ? {
          ...detail,
          inputSchema: detail.inputSchema.map((field) =>
            field.type === 'input-format' ? { ...field, valueSchema: inputFormatSchema } : field
          ),
          outputs: projectBlockOutputs(getBlockOutputs(detail.id)),
        }
      : detail
  )
  enriched = withToolBindingHints(enriched)
  if (detail.toolIds.includes('table_query_rows_v2')) {
    const workspace = await resolveActiveWorkspaceApplicationContext(viewer.workspaceId)
    enriched = {
      ...enriched,
      operationAvailability: {
        table_query_rows_v2: await getTableQueryAvailability({
          userId: viewer.userId,
          orgId: workspace.workspaceOrganizationId,
        }),
      },
    }
  }
  if (enriched === detail) return permitted
  return { ...permitted, stdout: JSON.stringify(mothershipBlockDetailSchema.parse(enriched)) }
}
