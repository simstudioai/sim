import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { createLogger } from '@sim/logger'
import { isPlainRecord } from '@sim/utils/object'
import {
  bindDurableSecretProvenanceToValue,
  durableSecretProvenanceFromRegistry,
} from '@/lib/execution/durable-secret-provenance'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import type { ExecuteMcpToolResult } from '@/lib/mcp/application/execute-tool'
import { MCP_PRESENTATION_MAX_BYTES, type McpPresentationReceipt } from '@/lib/mcp/presentation'
import { getMcpAppResourceUri } from '@/lib/mcp/presentation-metadata'
import { createCopilotApplicationAdapter } from '@/lib/mothership/application/application-adapter'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  createTrustedOrganizationCopilotPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import {
  MCP_PRESENTATION_AUDIENCE,
  publishMcpResult,
} from '@/lib/mothership/chat/application/mcp-results'
import { projectResolvedSecretModelJsonContent } from '@/executor/utils/resolved-secret-content-projection'

const publish = createCopilotApplicationAdapter({
  domain: 'MCP presentation',
  delegation: {
    audience: MCP_PRESENTATION_AUDIENCE,
    ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
    createDelegationId: (context) => `copilot-tool:${context.toolCallId}`,
  },
  operations: { publish: publishMcpResult.operation },
})
const logger = createLogger('McpPresentation')

/** Separates private App data from model content while retaining a small, durable display receipt. */
export async function presentMcpToolResult(
  context: InternalToolOperationContext,
  connectionId: string,
  execution: ExecuteMcpToolResult,
  signal?: AbortSignal
): Promise<ExecuteMcpToolResult> {
  const presentation = execution.presentation
  if (!presentation || !context.chatId || !context.workspaceId || !context.toolCallId)
    return execution
  const { tool, result } = presentation
  const organizationId = context.chatOrganizationId ?? context.organizationId
  let receipt: McpPresentationReceipt | undefined
  try {
    if (getMcpAppResourceUri(tool) || result.content.some((item) => item.type !== 'text')) {
      const value = { arguments: presentation.arguments, result, title: tool.title || tool.name }
      const projection = projectResolvedSecretModelJsonContent(
        value,
        context.resolvedSecretTraceRegistry?.forkForPropagatedEntries(),
        MCP_PRESENTATION_MAX_BYTES
      )
      if (
        projection.safe &&
        isPlainRecord(projection.value) &&
        isPlainRecord(projection.value.arguments) &&
        typeof projection.value.title === 'string'
      ) {
        const input = {
          chatId: context.chatId,
          workspaceId: context.workspaceId,
          connectionId,
          toolCallId: context.toolCallId,
          tool: { ...tool, title: projection.value.title },
          arguments: projection.value.arguments,
          result: CallToolResultSchema.parse(projection.value.result),
          signal,
          secretProvenance: bindDurableSecretProvenanceToValue(
            durableSecretProvenanceFromRegistry(
              context.resolvedSecretTraceRegistry,
              projection.value
            ),
            projection.value
          ),
        }
        receipt =
          organizationId && context.userId
            ? await publishMcpResult.execute({
                principal: createTrustedOrganizationCopilotPrincipal(
                  {
                    userId: context.userId,
                    organizationId,
                    chatId: context.chatId,
                    delegationId: `copilot-tool:${context.toolCallId}`,
                  },
                  {
                    audience: MCP_PRESENTATION_AUDIENCE,
                    ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
                  }
                ),
                input,
              })
            : await publish(context, publishMcpResult, input)
      }
    }
  } catch {
    signal?.throwIfAborted()
    logger.warn('MCP tool completed but its presentation could not be saved', {
      toolCallId: context.toolCallId,
    })
  }
  const output = {
    content: result.content.map((item, index) =>
      item.type === 'text'
        ? {
            type: 'text' as const,
            text: item.text,
            ...(item.annotations ? { annotations: item.annotations } : {}),
          }
        : {
            type: 'text' as const,
            text: receipt
              ? `Attached result: ${receipt.items.find((asset) => asset.index === index)?.title || 'file'}`
              : 'MCP file output could not be displayed.',
          }
    ),
    ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
    ...(result.isError ? { isError: true } : {}),
    ...(receipt ? { mcpPresentation: receipt } : {}),
  }
  return execution.success
    ? { success: true, output }
    : { success: false, error: execution.error, output }
}
