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
  {
    name: 'create_workflow',
    toolId: 'create_workflow',
    description: 'Create a new workflow. Returns the new workflow ID.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name for the new workflow.',
        },
        workspaceId: {
          type: 'string',
          description: 'Optional workspace ID. Uses default workspace if not provided.',
        },
        folderId: {
          type: 'string',
          description: 'Optional folder ID to place the workflow in.',
        },
        description: {
          type: 'string',
          description: 'Optional description for the workflow.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_folder',
    toolId: 'create_folder',
    description: 'Create a new folder in a workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name for the new folder.',
        },
        workspaceId: {
          type: 'string',
          description: 'Optional workspace ID. Uses default workspace if not provided.',
        },
        parentId: {
          type: 'string',
          description: 'Optional parent folder ID for nested folders.',
        },
      },
      required: ['name'],
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
    name: 'copilot_build',
    agentId: 'build',
    description: `Build a workflow end-to-end in a single step. This is the fast mode equivalent for headless/MCP usage.

USE THIS WHEN:
- Building a new workflow from scratch
- Modifying an existing workflow
- You want to gather information and build in one pass without separate plan→edit steps

WORKFLOW ID (REQUIRED):
- For NEW workflows: First call create_workflow to get a workflowId, then pass it here
- For EXISTING workflows: Always pass the workflowId parameter

CAN DO:
- Gather information about blocks, credentials, patterns
- Search documentation and patterns for best practices
- Add, modify, or remove blocks
- Configure block settings and connections
- Set environment variables and workflow variables

CANNOT DO:
- Run or test workflows (use copilot_test separately after deploying)
- Deploy workflows (use copilot_deploy separately)

WORKFLOW:
1. Call create_workflow to get a workflowId (for new workflows)
2. Call copilot_build with the request and workflowId
3. Build agent gathers info and builds in one pass
4. Call copilot_deploy to deploy the workflow
5. Optionally call copilot_test to verify it works`,
    inputSchema: {
      type: 'object',
      properties: {
        request: {
          type: 'string',
          description: 'What you want to build or modify in the workflow.',
        },
        workflowId: {
          type: 'string',
          description:
            'REQUIRED. The workflow ID. For new workflows, call create_workflow first to get this.',
        },
        context: { type: 'object' },
      },
      required: ['request', 'workflowId'],
    },
  },
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
    description: `Plan workflow changes by gathering required information.

USE THIS WHEN:
- Building a new workflow
- Modifying an existing workflow
- You need to understand what blocks and integrations are available
- The workflow requires multiple blocks or connections

WORKFLOW ID (REQUIRED):
- For NEW workflows: First call create_workflow to get a workflowId, then pass it here
- For EXISTING workflows: Always pass the workflowId parameter

This tool gathers information about available blocks, credentials, and the current workflow state.

RETURNS: A plan object containing block configurations, connections, and technical details.
IMPORTANT: Pass the returned plan EXACTLY to copilot_edit - do not modify or summarize it.`,
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string', description: 'What you want to build or modify in the workflow.' },
        workflowId: {
          type: 'string',
          description: 'REQUIRED. The workflow ID. For new workflows, call create_workflow first to get this.',
        },
        context: { type: 'object' },
      },
      required: ['request', 'workflowId'],
    },
  },
  {
    name: 'copilot_edit',
    agentId: 'edit',
    description: `Execute a workflow plan and apply edits.

USE THIS WHEN:
- You have a plan from copilot_plan that needs to be executed
- Building or modifying a workflow based on the plan
- Making changes to blocks, connections, or configurations

WORKFLOW ID (REQUIRED):
- You MUST provide the workflowId parameter
- For new workflows, get the workflowId from create_workflow first

PLAN (REQUIRED):
- Pass the EXACT plan object from copilot_plan in the context.plan field
- Do NOT modify, summarize, or interpret the plan - pass it verbatim
- The plan contains technical details the edit agent needs exactly as-is

IMPORTANT: After copilot_edit completes, you MUST call copilot_deploy before the workflow can be run or tested.`,
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Optional additional instructions for the edit.' },
        workflowId: {
          type: 'string',
          description: 'REQUIRED. The workflow ID to edit. Get this from create_workflow for new workflows.',
        },
        plan: {
          type: 'object',
          description: 'The plan object from copilot_plan. Pass it EXACTLY as returned, do not modify.',
        },
        context: {
          type: 'object',
          description: 'Additional context. Put the plan in context.plan if not using the plan field directly.',
        },
      },
      required: ['workflowId'],
    },
  },
  {
    name: 'copilot_debug',
    agentId: 'debug',
    description: `Diagnose errors or unexpected workflow behavior.

WORKFLOW ID (REQUIRED): Always provide the workflowId of the workflow to debug.`,
    inputSchema: {
      type: 'object',
      properties: {
        error: { type: 'string', description: 'The error message or description of the issue.' },
        workflowId: { type: 'string', description: 'REQUIRED. The workflow ID to debug.' },
        context: { type: 'object' },
      },
      required: ['error', 'workflowId'],
    },
  },
  {
    name: 'copilot_deploy',
    agentId: 'deploy',
    description: `Deploy or manage workflow deployments.

CRITICAL: You MUST deploy a workflow after building before it can be run or tested.
Workflows without an active deployment will fail with "no active deployment" error.

WORKFLOW ID (REQUIRED):
- Always provide the workflowId parameter
- This must match the workflow you built with copilot_edit

USE THIS:
- After copilot_edit completes to activate the workflow
- To update deployment settings
- To redeploy after making changes

DEPLOYMENT TYPES:
- "deploy as api" - REST API endpoint
- "deploy as chat" - Chat interface
- "deploy as mcp" - MCP server`,
    inputSchema: {
      type: 'object',
      properties: {
        request: {
          type: 'string',
          description: 'The deployment request, e.g. "deploy as api" or "deploy as chat"',
        },
        workflowId: {
          type: 'string',
          description: 'REQUIRED. The workflow ID to deploy.',
        },
        context: { type: 'object' },
      },
      required: ['request', 'workflowId'],
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
    description: `Run workflows and verify outputs.

PREREQUISITE: The workflow MUST be deployed first using copilot_deploy.
Undeployed workflows will fail with "no active deployment" error.

WORKFLOW ID (REQUIRED):
- Always provide the workflowId parameter

USE THIS:
- After deploying to verify the workflow works correctly
- To test with sample inputs
- To validate workflow behavior before sharing with user`,
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' },
        workflowId: {
          type: 'string',
          description: 'REQUIRED. The workflow ID to test.',
        },
        context: { type: 'object' },
      },
      required: ['request', 'workflowId'],
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
      // Signal to the copilot backend that this is a headless request
      // so it can enforce workflowId requirements on tools
      headless: true,
    },
    {
      userId,
      workflowId: args.workflowId as string | undefined,
      workspaceId: args.workspaceId as string | undefined,
    }
  )

  // When a respond tool (plan_respond, edit_respond, etc.) was used,
  // return only the structured result - not the full result with all internal tool calls.
  // This provides clean output for MCP consumers.
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
    // Fallback: return content if no structured result
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

