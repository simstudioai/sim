import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { BlockState, SubBlockState } from '@sim/workflow-types/workflow'
import { bindCopilotWorkspaceOperation } from '@/lib/core/application/copilot-workspace-invocation'
import { discoverManagedMcpToolsUseCase } from '@/lib/credentials/application/discover-managed-mcp-tools'
import { discoverMcpServerToolsUseCase } from '@/lib/mcp/application/use-cases'
import { isMcpRuntimeReference } from '@/lib/mcp/operation-policy'
import {
  createMcpToolOutputSnapshot,
  MCP_TOOL_OUTPUT_SCHEMA_SUBBLOCK,
  parseMcpToolOutputSnapshot,
} from '@/lib/mcp/output-schema'
import type { McpTool } from '@/lib/mcp/types'
import { isManagedMcpConnectionId, MANAGED_MCP_CONNECTION_PREFIX } from '@/lib/mcp/utils'
import { resolveMcpBlockConfig } from '@/lib/mcp/workflow-config'
import { WORKFLOW_DELEGATION_AUDIENCE } from '@/lib/workflows/application/authorization'

const logger = createLogger('McpOutputSchemaSnapshots')

/** Discovery is served from the tool cache when fresh; past this an edit saves without snapshots. */
const SNAPSHOT_DISCOVERY_TIMEOUT_MS = 10_000

interface SnapshotTarget {
  blockId: string
  server: string
  tool: string
}

interface SnapshotOptions {
  principal: Principal
  workspaceId: string
  signal?: AbortSignal
}

/** An MCP run block with a literal target whose stored snapshot was taken for another one. */
function staleSnapshotTarget(blockId: string, block: BlockState): SnapshotTarget | undefined {
  if (block.type !== 'mcp') return undefined
  const values = Object.fromEntries(
    Object.entries(block.subBlocks ?? {}).map(([id, subBlock]) => [id, subBlock?.value])
  )
  let target: ReturnType<typeof resolveMcpBlockConfig>
  try {
    target = resolveMcpBlockConfig(values, block.data?.canonicalModes)
  } catch {
    return undefined
  }
  const { server, tool, action } = target
  if (action === 'list' || typeof server !== 'string' || typeof tool !== 'string') return undefined
  if (
    !server.trim() ||
    !tool.trim() ||
    isMcpRuntimeReference(server) ||
    isMcpRuntimeReference(tool)
  )
    return undefined
  const snapshot = parseMcpToolOutputSnapshot(values[MCP_TOOL_OUTPUT_SCHEMA_SUBBLOCK])
  if (snapshot?.server === server && snapshot.tool === tool) return undefined
  return { blockId, server, tool }
}

async function discoverTools(
  serverId: string,
  { principal, workspaceId, signal }: SnapshotOptions
): Promise<McpTool[]> {
  if (serverId.startsWith(MANAGED_MCP_CONNECTION_PREFIX)) {
    if (!isManagedMcpConnectionId(serverId)) return []
    const { tools } = await discoverManagedMcpToolsUseCase.execute({
      principal: bindCopilotWorkspaceOperation(
        principal,
        workspaceId,
        [WORKFLOW_DELEGATION_AUDIENCE],
        discoverManagedMcpToolsUseCase,
        { credentialId: serverId }
      ),
      input: { workspaceId, credentialId: serverId, signal },
    })
    return tools
  }
  const { tools } = await discoverMcpServerToolsUseCase.execute({
    principal: bindCopilotWorkspaceOperation(
      principal,
      workspaceId,
      [WORKFLOW_DELEGATION_AUDIENCE],
      discoverMcpServerToolsUseCase,
      { mcpServerId: serverId }
    ),
    // Best effort: a failure here never marks the server unhealthy or starts its shared cooldown.
    input: { workspaceId, serverId, signal, bestEffort: true },
  })
  return tools
}

/** The block's resolved target and fields as an edit can change them, to tell an edited block from an untouched one. */
function editFingerprint(block: BlockState | undefined): string {
  return JSON.stringify([block?.type, block?.subBlocks ?? {}, block?.data?.canonicalModes ?? {}])
}

/**
 * Records, on each MCP block this edit changed and left targeting a literal
 * server and operation, the reply shape that operation declares, so the block's
 * `structuredContent` output is typed for lint, references, `workflows deps` and
 * the run. Blocks the edit did not touch, and blocks whose snapshot already
 * matches their target, are not rediscovered, so an unreachable server never
 * slows an edit that leaves its block alone; one per server is discovered, through the same authorized use
 * case the editor's tool list uses, as the editing principal.
 *
 * Best effort: a server that cannot be discovered, or an operation it does not
 * list, leaves the block as it was, which is the untyped output every block had
 * before. The edit itself never fails here.
 */
export async function snapshotMcpToolOutputSchemas(
  blocks: Record<string, BlockState>,
  baseBlocks: Record<string, BlockState>,
  options: SnapshotOptions
): Promise<Record<string, BlockState>> {
  const targets = Object.entries(blocks).flatMap(([blockId, block]) => {
    if (editFingerprint(block) === editFingerprint(baseBlocks[blockId])) return []
    const target = staleSnapshotTarget(blockId, block)
    return target ? [target] : []
  })
  if (targets.length === 0) return blocks

  const timeout = AbortSignal.timeout(SNAPSHOT_DISCOVERY_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const servers = [...new Set(targets.map((target) => target.server))]
  const discovered = new Map(
    await Promise.all(
      servers.map(async (serverId) => {
        try {
          return [serverId, await discoverTools(serverId, { ...options, signal })] as const
        } catch (error) {
          logger.info('Skipped MCP output schema snapshot for an undiscoverable server', {
            serverId,
            error: getErrorMessage(error),
          })
          return [serverId, undefined] as const
        }
      })
    )
  )

  let next = blocks
  for (const { blockId, server, tool } of targets) {
    const declared = discovered.get(server)?.find((candidate) => candidate.name === tool)
    if (!declared) continue
    const block = next[blockId]
    if (!block) continue
    const snapshot: unknown = createMcpToolOutputSnapshot(server, tool, declared.outputSchema)
    next = {
      ...next,
      [blockId]: {
        ...block,
        subBlocks: {
          ...block.subBlocks,
          [MCP_TOOL_OUTPUT_SCHEMA_SUBBLOCK]: {
            id: MCP_TOOL_OUTPUT_SCHEMA_SUBBLOCK,
            type: 'code',
            // Stored as the JSON object it is, like the editor's `_toolSchema`; `SubBlockState` types only scalar field values.
            value: snapshot as SubBlockState['value'],
          },
        },
      },
    }
  }
  return next
}
