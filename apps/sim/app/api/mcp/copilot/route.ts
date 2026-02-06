import {
  type CallToolResult,
  ErrorCode,
  type InitializeResult,
  isJSONRPCNotification,
  isJSONRPCRequest,
  type JSONRPCError,
  type JSONRPCMessage,
  type JSONRPCResponse,
  type ListToolsResult,
  type RequestId,
} from '@modelcontextprotocol/sdk/types.js'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { getCopilotModel } from '@/lib/copilot/config'
import { SIM_AGENT_VERSION } from '@/lib/copilot/constants'
import { orchestrateCopilotStream } from '@/lib/copilot/orchestrator'
import { orchestrateSubagentStream } from '@/lib/copilot/orchestrator/subagent'
import {
  executeToolServerSide,
  prepareExecutionContext,
} from '@/lib/copilot/orchestrator/tool-executor'
import { DIRECT_TOOL_DEFS, SUBAGENT_TOOL_DEFS } from '@/lib/copilot/tools/mcp/definitions'
import { resolveWorkflowIdForUser } from '@/lib/workflows/utils'

const logger = createLogger('CopilotMcpAPI')

export const dynamic = 'force-dynamic'

/**
 * MCP Server instructions that guide LLMs on how to use the Sim copilot tools.
 * This is included in the initialize response to help external LLMs understand
 * the workflow lifecycle and best practices.
 */
const MCP_SERVER_INSTRUCTIONS = `
## Sim Workflow Copilot

Sim is a workflow automation platform. Workflows are visual pipelines of connected blocks (Agent, Function, Condition, API, integrations, etc.). The Agent block is the core — an LLM with tools, memory, structured output, and knowledge bases.

### Workflow Lifecycle (Happy Path)

1. \`list_workspaces\` → know where to work
2. \`create_workflow(name, workspaceId)\` → get a workflowId
3. \`copilot_build(request, workflowId)\` → plan and build in one pass
4. \`copilot_test(request, workflowId)\` → verify it works
5. \`copilot_deploy("deploy as api", workflowId)\` → make it accessible externally (optional)

For fine-grained control, use \`copilot_plan\` → \`copilot_edit\` instead of \`copilot_build\`. Pass the plan object from copilot_plan EXACTLY as-is to copilot_edit's context.plan field.

### Working with Existing Workflows

When the user refers to a workflow by name or description ("the email one", "my Slack bot"):
1. Use \`copilot_discovery\` to find it by functionality
2. Or use \`list_workflows\` and match by name
3. Then pass the workflowId to other tools

### Organization

- \`rename_workflow\` — rename a workflow
- \`move_workflow\` — move a workflow into a folder (or root with null)
- \`move_folder\` — nest a folder inside another (or root with null)
- \`create_folder(name, parentId)\` — create nested folder hierarchies

### Key Rules

- You can test workflows immediately after building — deployment is only needed for external access (API, chat, MCP).
- All copilot tools (build, plan, edit, deploy, test, debug) require workflowId.
- If the user reports errors → use \`copilot_debug\` first, don't guess.
- Variable syntax: \`<blockname.field>\` for block outputs, \`{{ENV_VAR}}\` for env vars.
`

function createResponse(id: RequestId, result: unknown): JSONRPCResponse {
  return {
    jsonrpc: '2.0',
    id,
    result: result as JSONRPCResponse['result'],
  }
}

function createError(id: RequestId, code: ErrorCode | number, message: string): JSONRPCError {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  }
}

export async function GET() {
  return NextResponse.json({
    name: 'copilot-subagents',
    version: '1.0.0',
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
  })
}

export async function POST(request: NextRequest) {
  try {
    const auth = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json()) as JSONRPCMessage

    if (isJSONRPCNotification(body)) {
      return new NextResponse(null, { status: 202 })
    }

    if (!isJSONRPCRequest(body)) {
      return NextResponse.json(
        createError(0, ErrorCode.InvalidRequest, 'Invalid JSON-RPC message'),
        { status: 400 }
      )
    }

    const { id, method, params } = body

    switch (method) {
      case 'initialize': {
        const result: InitializeResult = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'sim-copilot', version: '1.0.0' },
          instructions: MCP_SERVER_INSTRUCTIONS,
        }
        return NextResponse.json(createResponse(id, result))
      }
      case 'ping':
        return NextResponse.json(createResponse(id, {}))
      case 'tools/list':
        return handleToolsList(id)
      case 'tools/call':
        return handleToolsCall(
          id,
          params as { name: string; arguments?: Record<string, unknown> },
          auth.userId
        )
      default:
        return NextResponse.json(
          createError(id, ErrorCode.MethodNotFound, `Method not found: ${method}`),
          { status: 404 }
        )
    }
  } catch (error) {
    logger.error('Error handling MCP request', { error })
    return NextResponse.json(createError(0, ErrorCode.InternalError, 'Internal error'), {
      status: 500,
    })
  }
}

async function handleToolsList(id: RequestId): Promise<NextResponse> {
  const directTools = DIRECT_TOOL_DEFS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }))

  const subagentTools = SUBAGENT_TOOL_DEFS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }))

  const result: ListToolsResult = {
    tools: [...directTools, ...subagentTools],
  }

  return NextResponse.json(createResponse(id, result))
}

async function handleToolsCall(
  id: RequestId,
  params: { name: string; arguments?: Record<string, unknown> },
  userId: string
): Promise<NextResponse> {
  const args = params.arguments || {}

  // Check if this is a direct tool (fast, no LLM)
  const directTool = DIRECT_TOOL_DEFS.find((tool) => tool.name === params.name)
  if (directTool) {
    return handleDirectToolCall(id, directTool, args, userId)
  }

  // Check if this is a subagent tool (uses LLM orchestration)
  const subagentTool = SUBAGENT_TOOL_DEFS.find((tool) => tool.name === params.name)
  if (subagentTool) {
    return handleSubagentToolCall(id, subagentTool, args, userId)
  }

  return NextResponse.json(
    createError(id, ErrorCode.MethodNotFound, `Tool not found: ${params.name}`),
    { status: 404 }
  )
}

async function handleDirectToolCall(
  id: RequestId,
  toolDef: (typeof DIRECT_TOOL_DEFS)[number],
  args: Record<string, unknown>,
  userId: string
): Promise<NextResponse> {
  try {
    const execContext = await prepareExecutionContext(userId, (args.workflowId as string) || '')

    const toolCall = {
      id: crypto.randomUUID(),
      name: toolDef.toolId,
      status: 'pending' as const,
      params: args as Record<string, any>,
      startTime: Date.now(),
    }

    const result = await executeToolServerSide(toolCall, execContext)

    const response: CallToolResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result.output ?? result, null, 2),
        },
      ],
      isError: !result.success,
    }

    return NextResponse.json(createResponse(id, response))
  } catch (error) {
    logger.error('Direct tool execution failed', { tool: toolDef.name, error })
    return NextResponse.json(
      createError(id, ErrorCode.InternalError, `Tool execution failed: ${error}`),
      { status: 500 }
    )
  }
}

/**
 * Build mode uses the main chat orchestrator with the 'fast' command instead of
 * the subagent endpoint. In Go, 'build' is not a registered subagent — it's a mode
 * (ModeFast) on the main chat processor that bypasses subagent orchestration and
 * executes all tools directly.
 */
async function handleBuildToolCall(
  id: RequestId,
  args: Record<string, unknown>,
  userId: string
): Promise<NextResponse> {
  try {
    const requestText = (args.request as string) || JSON.stringify(args)
    const { model } = getCopilotModel('chat')
    const workflowId = args.workflowId as string | undefined

    const resolved = workflowId ? { workflowId } : await resolveWorkflowIdForUser(userId)

    if (!resolved?.workflowId) {
      const response: CallToolResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: 'workflowId is required for build. Call create_workflow first.',
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      }
      return NextResponse.json(createResponse(id, response))
    }

    const chatId = crypto.randomUUID()

    const requestPayload = {
      message: requestText,
      workflowId: resolved.workflowId,
      userId,
      model,
      mode: 'agent',
      commands: ['fast'],
      messageId: crypto.randomUUID(),
      version: SIM_AGENT_VERSION,
      headless: true,
      chatId,
    }

    const result = await orchestrateCopilotStream(requestPayload, {
      userId,
      workflowId: resolved.workflowId,
      chatId,
      autoExecuteTools: true,
      timeout: 300000,
      interactive: false,
    })

    const responseData = {
      success: result.success,
      content: result.content,
      toolCalls: result.toolCalls,
      error: result.error,
    }

    const response: CallToolResult = {
      content: [{ type: 'text', text: JSON.stringify(responseData, null, 2) }],
      isError: !result.success,
    }

    return NextResponse.json(createResponse(id, response))
  } catch (error) {
    logger.error('Build tool call failed', { error })
    return NextResponse.json(createError(id, ErrorCode.InternalError, `Build failed: ${error}`), {
      status: 500,
    })
  }
}

async function handleSubagentToolCall(
  id: RequestId,
  toolDef: (typeof SUBAGENT_TOOL_DEFS)[number],
  args: Record<string, unknown>,
  userId: string
): Promise<NextResponse> {
  // Build mode uses the main chat endpoint, not the subagent endpoint
  if (toolDef.agentId === 'build') {
    return handleBuildToolCall(id, args, userId)
  }

  const requestText =
    (args.request as string) ||
    (args.message as string) ||
    (args.error as string) ||
    JSON.stringify(args)

  const context = (args.context as Record<string, unknown>) || {}
  if (args.plan && !context.plan) {
    context.plan = args.plan
  }

  const { model } = getCopilotModel('chat')

  const result = await orchestrateSubagentStream(
    toolDef.agentId,
    {
      message: requestText,
      workflowId: args.workflowId,
      workspaceId: args.workspaceId,
      context,
      model,
      headless: true,
    },
    {
      userId,
      workflowId: args.workflowId as string | undefined,
      workspaceId: args.workspaceId as string | undefined,
    }
  )

  let responseData: unknown
  if (result.structuredResult) {
    responseData = {
      success: result.structuredResult.success ?? result.success,
      type: result.structuredResult.type,
      summary: result.structuredResult.summary,
      data: result.structuredResult.data,
    }
  } else if (result.error) {
    responseData = {
      success: false,
      error: result.error,
      errors: result.errors,
    }
  } else {
    responseData = {
      success: result.success,
      content: result.content,
    }
  }

  const response: CallToolResult = {
    content: [
      {
        type: 'text',
        text: JSON.stringify(responseData, null, 2),
      },
    ],
    isError: !result.success,
  }

  return NextResponse.json(createResponse(id, response))
}
