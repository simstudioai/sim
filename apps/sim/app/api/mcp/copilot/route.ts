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
## Sim Workflow Copilot - Usage Guide

You are interacting with Sim's workflow automation platform. These tools orchestrate specialized AI agents that build workflows. Follow these guidelines carefully.

---

## Platform Knowledge

Sim is a workflow automation platform. Workflows are visual pipelines of blocks.

### Block Types

**Core Logic:**
- **Agent** - The heart of Sim (LLM block with tools, memory, structured output, knowledge bases)
- **Function** - JavaScript code execution
- **Condition** - If/else branching
- **Router** - AI-powered content-based routing
- **Loop** - While/do-while iteration
- **Parallel** - Simultaneous execution
- **API** - HTTP requests

**Integrations (3rd Party):**
- OAuth: Slack, Gmail, Google Calendar, Sheets, Outlook, Linear, GitHub, Notion
- API: Stripe, Twilio, SendGrid, any REST API

### The Agent Block

The Agent block is the core of intelligent workflows:
- **Tools** - Add integrations, custom tools, web search to give it capabilities
- **Memory** - Multi-turn conversations with persistent context
- **Structured Output** - JSON schema for reliable parsing
- **Knowledge Bases** - RAG-powered document retrieval

**Design principle:** Put tools INSIDE agents rather than using standalone tool blocks.

### Triggers

| Type | Description |
|------|-------------|
| Manual/Chat | User sends message in UI (start block: input, files, conversationId) |
| API | REST endpoint with custom input schema |
| Webhook | External services POST to trigger URL |
| Schedule | Cron-based (hourly, daily, weekly) |

### Deployments

| Type | Trigger | Use Case |
|------|---------|----------|
| API | Start block | REST endpoint for programmatic access |
| Chat | Start block | Managed chat UI with auth options |
| MCP | Start block | Expose as MCP tool for AI agents |
| General | Schedule/Webhook | Activate triggers to run automatically |

**Undeployed workflows only run in the builder UI.**

### Variable Syntax

Reference outputs from previous blocks: \`<blockname.field>\`
Reference environment variables: \`{{ENV_VAR_NAME}}\`

Rules:
- Block names must be lowercase, no spaces, no special characters
- Use dot notation for nested fields: \`<blockname.field.subfield>\`

---

## Workflow Lifecycle

1. **Create**: For NEW workflows, FIRST call create_workflow to get a workflowId
2. **Plan**: Use copilot_plan with the workflowId to plan the workflow
3. **Edit**: Use copilot_edit with the workflowId AND the plan to build the workflow
4. **Deploy**: ALWAYS deploy after building using copilot_deploy before testing/running
5. **Test**: Use copilot_test to verify the workflow works correctly
6. **Share**: Provide the user with the workflow URL after completion

---

## CRITICAL: Always Pass workflowId

- For NEW workflows: Call create_workflow FIRST, then use the returned workflowId
- For EXISTING workflows: Pass the workflowId to all copilot tools
- copilot_plan, copilot_edit, copilot_deploy, copilot_test, copilot_debug all REQUIRE workflowId

---

## CRITICAL: How to Handle Plans

The copilot_plan tool returns a structured plan object. You MUST:

1. **Do NOT modify the plan**: Pass the plan object EXACTLY as returned to copilot_edit
2. **Do NOT interpret or summarize the plan**: The edit agent needs the raw plan data
3. **Pass the plan in the context.plan field**: \`{ "context": { "plan": <plan_object> } }\`
4. **Include ALL plan data**: Block configurations, connections, credentials, everything

Example flow:
\`\`\`
1. copilot_plan({ request: "build a workflow...", workflowId: "abc123" })
   -> Returns: { "plan": { "blocks": [...], "connections": [...], ... } }

2. copilot_edit({ 
     workflowId: "abc123",
     message: "Execute the plan",
     context: { "plan": <EXACT plan object from step 1> }
   })
\`\`\`

**Why this matters**: The plan contains technical details (block IDs, field mappings, API schemas) that the edit agent needs verbatim. Summarizing or rephrasing loses critical information.

---

## CRITICAL: Error Handling

**If the user says "doesn't work", "broke", "failed", "error" → ALWAYS use copilot_debug FIRST.**

Don't guess. Don't plan. Debug first to find the actual problem.

---

## Important Rules

- ALWAYS deploy a workflow before attempting to run or test it
- Workflows must be deployed to have an "active deployment" for execution
- After building, call copilot_deploy with the appropriate deployment type (api, chat, or mcp)
- Return the workflow URL to the user so they can access it in Sim

---

## Quick Operations (use direct tools)
- list_workflows, list_workspaces, list_folders, get_workflow: Fast database queries
- create_workflow: Create new workflow and get workflowId (CALL THIS FIRST for new workflows)
- create_folder: Create new resources

## Workflow Building (use copilot tools)
- copilot_plan: Plan workflow changes (REQUIRES workflowId) - returns a plan object
- copilot_edit: Execute the plan (REQUIRES workflowId AND plan from copilot_plan)
- copilot_deploy: Deploy workflows (REQUIRES workflowId)
- copilot_test: Test workflow execution (REQUIRES workflowId)
- copilot_debug: Diagnose errors (REQUIRES workflowId) - USE THIS FIRST for issues
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
    const context = (args.context as Record<string, unknown>) || {}

    const requestPayload = {
      message: requestText,
      workflowId: resolved.workflowId,
      userId,
      stream: true,
      streamToolCalls: true,
      model,
      mode: 'agent',
      commands: ['fast'],
      messageId: crypto.randomUUID(),
      version: SIM_AGENT_VERSION,
      headless: true,
      chatId,
      context,
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
