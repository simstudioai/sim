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
import { orchestrateSubagentStream } from '@/lib/copilot/orchestrator/subagent'
import { executeToolServerSide, prepareExecutionContext } from '@/lib/copilot/orchestrator/tool-executor'

const logger = createLogger('CopilotMcpAPI')

export const dynamic = 'force-dynamic'

/**
 * Direct tools that execute immediately without LLM orchestration.
 * These are fast database queries that don't need AI reasoning.
 */
const DIRECT_TOOL_DEFS: Array<{
  name: string
  description: string
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] }
  toolId: string
}> = [
  {
    name: 'list_workflows',
    toolId: 'list_user_workflows',
    description: 'List all workflows the user has access to. Returns workflow IDs, names, and workspace info.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace ID to filter workflows.',
        },
        folderId: {
          type: 'string',
          description: 'Optional folder ID to filter workflows.',
        },
      },
    },
  },
  {
    name: 'list_workspaces',
    toolId: 'list_user_workspaces',
    description: 'List all workspaces the user has access to. Returns workspace IDs, names, and roles.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_folders',
    toolId: 'list_folders',
    description: 'List all folders in a workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Workspace ID to list folders from.',
        },
      },
      required: ['workspaceId'],
    },
  },
  {
    name: 'get_workflow',
    toolId: 'get_workflow_from_name',
    description: 'Get a workflow by name or ID. Returns the full workflow definition.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Workflow name to search for.',
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID to retrieve directly.',
        },
      },
    },
  },
]

const SUBAGENT_TOOL_DEFS: Array<{
  name: string
  description: string
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] }
  agentId: string
}> = [
  {
    name: 'copilot_discovery',
    agentId: 'discovery',
    description: `Find workflows by their contents or functionality when the user doesn't know the exact name or ID.

USE THIS WHEN:
- User describes a workflow by what it does: "the one that sends emails", "my Slack notification workflow"
- User refers to workflow contents: "the workflow with the OpenAI block"
- User needs to search/match workflows by functionality or description

DO NOT USE (use direct tools instead):
- User knows the workflow name → use get_workflow
- User wants to list all workflows → use list_workflows
- User wants to list workspaces → use list_workspaces
- User wants to list folders → use list_folders`,
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' },
        workspaceId: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['request'],
    },
  },
  {
    name: 'copilot_plan',
    agentId: 'plan',
    description: 'Plan workflow changes by gathering required information.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' },
        workflowId: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['request'],
    },
  },
  {
    name: 'copilot_edit',
    agentId: 'edit',
    description: 'Execute a workflow plan and apply edits.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        workflowId: { type: 'string' },
        plan: { type: 'object' },
        context: { type: 'object' },
      },
      required: ['workflowId'],
    },
  },
  {
    name: 'copilot_debug',
    agentId: 'debug',
    description: 'Diagnose errors or unexpected workflow behavior.',
    inputSchema: {
      type: 'object',
      properties: {
        error: { type: 'string' },
        workflowId: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['error'],
    },
  },
  {
    name: 'copilot_deploy',
    agentId: 'deploy',
    description: 'Deploy or manage workflow deployments.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' },
        workflowId: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['request'],
    },
  },
  {
    name: 'copilot_auth',
    agentId: 'auth',
    description: 'Handle OAuth connection flows.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['request'],
    },
  },
  {
    name: 'copilot_knowledge',
    agentId: 'knowledge',
    description: 'Create and manage knowledge bases.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['request'],
    },
  },
  {
    name: 'copilot_custom_tool',
    agentId: 'custom_tool',
    description: 'Create or manage custom tools.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['request'],
    },
  },
  {
    name: 'copilot_info',
    agentId: 'info',
    description: 'Inspect blocks, outputs, and workflow metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' },
        workflowId: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['request'],
    },
  },
  {
    name: 'copilot_workflow',
    agentId: 'workflow',
    description: 'Manage workflow environment and configuration.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' },
        workflowId: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['request'],
    },
  },
  {
    name: 'copilot_research',
    agentId: 'research',
    description: 'Research external APIs and documentation.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['request'],
    },
  },
  {
    name: 'copilot_tour',
    agentId: 'tour',
    description: 'Explain platform features and usage.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['request'],
    },
  },
  {
    name: 'copilot_test',
    agentId: 'test',
    description: 'Run workflows and verify outputs.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' },
        workflowId: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['request'],
    },
  },
  {
    name: 'copilot_superagent',
    agentId: 'superagent',
    description: 'Execute direct external actions (email, Slack, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['request'],
    },
  },
]

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
          serverInfo: { name: 'copilot-subagents', version: '1.0.0' },
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

  // Check if this is a subagent tool (slower, uses LLM)
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

async function handleSubagentToolCall(
  id: RequestId,
  toolDef: (typeof SUBAGENT_TOOL_DEFS)[number],
  args: Record<string, unknown>,
  userId: string
): Promise<NextResponse> {
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
    },
    {
      userId,
      workflowId: args.workflowId as string | undefined,
      workspaceId: args.workspaceId as string | undefined,
    }
  )

  const response: CallToolResult = {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
    isError: !result.success,
  }

  return NextResponse.json(createResponse(id, response))
}

