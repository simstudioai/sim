/**
 * Viewer curation for `blocks get` (18-agent-surface.md B3). The v2 catalog already
 * hides blocks by visibility, allowlist and hosted-key restrictions, but it does not
 * apply a permission group's `deniedTools`; the mothership asks for `curate: "block"`
 * so a partially-denied block is trimmed to the operations this viewer may configure.
 */

import { agentCliFail } from '@/lib/mothership/agent-cli/types'
import type { AgentCliRawResult } from '@/lib/mothership/generated/agent-cli'
import { resolveDeniedBlockOperations } from '@/lib/mothership/integration-tool-projection'
import { createToolAccessGate } from '@/lib/permission-groups/operation-access'
import { getUserPermissionConfig } from '@/ee/access-control/utils/permission-check'

export interface CurationViewer {
  workspaceId: string
  userId: string
}

interface BlockDetailShape {
  type: string
  operations?: Record<string, unknown>
  tools?: Array<{ id?: unknown }>
}

function parseBlockDetail(stdout: string): BlockDetailShape | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const candidate = parsed as { type?: unknown }
  return typeof candidate.type === 'string' ? (parsed as BlockDetailShape) : null
}

export async function curateBlockDetail(
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
  if (denied.fullyDenied.has(detail.type)) {
    return agentCliFail(`Block "${detail.type}" is not available to you in this workspace.`)
  }
  const deniedOperations = denied.needsProjection.get(detail.type)
  if (!deniedOperations) return result
  const operations = Object.fromEntries(
    Object.entries(detail.operations ?? {}).filter(([id]) => !deniedOperations.has(id))
  )
  const tools = (detail.tools ?? []).filter(
    (tool) => typeof tool.id !== 'string' || isToolAllowed(tool.id)
  )
  return { ...result, stdout: JSON.stringify({ ...detail, operations, tools }, null, 2) }
}
