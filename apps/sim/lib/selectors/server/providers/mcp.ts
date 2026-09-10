import { OrchestrationError } from '@/lib/core/orchestration/types'
import { discoverMcpServerToolsUseCase } from '@/lib/mcp/application/use-cases'
import {
  definePreparedSelectorAttachment,
  detailSelectorResult,
  listSelectorResult,
} from '@/lib/selectors/server/types'

/** The existing MCP use case binds the destination and credentials to an authorized server. */
export const mcpSelectorAttachments = {
  'mcp.tools': definePreparedSelectorAttachment({
    integrationBlockTypes: ['mcp'],
    destination: {
      kind: 'credential-bound',
      async prepare(args) {
        if (!args.workspaceId || !args.context.mcpServerId)
          throw new OrchestrationError(
            'validation',
            'MCP tool discovery requires a destination server'
          )
        return discoverMcpServerToolsUseCase.execute({
          principal: args.principal,
          input: {
            workspaceId: args.workspaceId,
            serverId: args.context.mcpServerId,
            signal: args.signal,
            requireComplete: true,
          },
        })
      },
    },
    async execute(args, result) {
      const tools = result.tools
        .map((tool) => ({ id: tool.name, label: tool.name }))
        .sort((a, b) => a.id.localeCompare(b.id))
      if (args.request.kind === 'detail') {
        const id = args.request.id
        return detailSelectorResult(tools.find((tool) => tool.id === id) ?? null)
      }
      const { search, cursor } = args.request
      const matches = search
        ? tools.filter((tool) => tool.label.toLowerCase().includes(search.toLowerCase()))
        : tools
      const offset = cursor ? Number(cursor) : 0
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000)
        throw new OrchestrationError('validation', 'Invalid MCP tools cursor')
      return listSelectorResult(
        matches.slice(offset, offset + 100),
        offset + 100 < matches.length ? String(offset + 100) : undefined
      )
    },
  }),
}
