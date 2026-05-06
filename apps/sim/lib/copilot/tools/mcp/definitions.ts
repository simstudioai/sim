import type { Tool } from '@modelcontextprotocol/sdk/types.js'

export type ToolAnnotations = NonNullable<Tool['annotations']>

export type DirectToolDef = {
  name: string
  description: string
  inputSchema: Tool['inputSchema']
  toolId: string
  annotations?: ToolAnnotations
}

export type SubagentToolDef = {
  name: string
  description: string
  inputSchema: Tool['inputSchema']
  agentId: string
  annotations?: ToolAnnotations
}

/**
 * Direct tools that execute immediately without LLM orchestration.
 * These are fast database queries that don't need AI reasoning.
 */
export const DIRECT_TOOL_DEFS: DirectToolDef[] = [
  {
    name: 'list_workspaces',
    toolId: 'list_user_workspaces',
    description:
      'List all workspaces the user has access to. Returns workspace IDs, names, and roles. Use this first to determine which workspace to operate in.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_folders',
    toolId: 'list_folders',
    description:
      'List all folders in a workspace. Returns folder IDs, names, and parent relationships for organizing workflows.',
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
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_workflow',
    toolId: 'create_workflow',
    description:
      'Create a new empty workflow. Returns the new workflow ID. Always call this FIRST before sim_workflow for new workflows. Use workspaceId to place it in a specific workspace.',
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
    annotations: { destructiveHint: false },
  },
  {
    name: 'create_folder',
    toolId: 'create_folder',
    description:
      'Create a new folder for organizing workflows. Use parentId to create nested folder hierarchies.',
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
    annotations: { destructiveHint: false },
  },
  {
    name: 'rename_workflow',
    toolId: 'rename_workflow',
    description: 'Rename an existing workflow.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'The workflow ID to rename.',
        },
        name: {
          type: 'string',
          description: 'The new name for the workflow.',
        },
      },
      required: ['workflowId', 'name'],
    },
    annotations: { destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'move_workflow',
    toolId: 'move_workflow',
    description:
      'Move a workflow into a different folder. Omit folderId or pass empty string to move to workspace root.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'The workflow ID to move.',
        },
        folderId: {
          type: 'string',
          description: 'Target folder ID. Omit or pass empty string to move to workspace root.',
        },
      },
      required: ['workflowId'],
    },
    annotations: { destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'move_folder',
    toolId: 'move_folder',
    description:
      'Move a folder into another folder. Omit parentId or pass empty string to move to workspace root.',
    inputSchema: {
      type: 'object',
      properties: {
        folderId: {
          type: 'string',
          description: 'The folder ID to move.',
        },
        parentId: {
          type: 'string',
          description:
            'Target parent folder ID. Omit or pass empty string to move to workspace root.',
        },
      },
      required: ['folderId'],
    },
    annotations: { destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'get_deployed_workflow_state',
    toolId: 'get_deployed_workflow_state',
    description:
      'Get the deployed (production) state of a workflow. Returns the full workflow definition as deployed, or indicates if the workflow is not yet deployed.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'REQUIRED. The workflow ID to get the deployed state for.',
        },
      },
      required: ['workflowId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'generate_api_key',
    toolId: 'generate_api_key',
    description:
      'Generate a new workspace API key for calling workflow API endpoints. The key is only shown once — tell the user to save it immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'A descriptive name for the API key (e.g., "production-key", "dev-testing").',
        },
        workspaceId: {
          type: 'string',
          description: "Optional workspace ID. Defaults to user's default workspace.",
        },
      },
      required: ['name'],
    },
    annotations: { destructiveHint: false },
  },
  {
    name: 'create_job',
    toolId: 'create_job',
    description:
      'Create a scheduled background job that runs a prompt against the Mothership at a specified frequency or time. Use for polling, reminders, or deferred tasks. Provide cron for recurring jobs or time for one-time execution.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'A short descriptive title for the job (e.g., "Email Poller").',
        },
        prompt: {
          type: 'string',
          description: 'The prompt to execute when the job fires.',
        },
        cron: {
          type: 'string',
          description:
            'Cron expression for recurring jobs (e.g., "*/5 * * * *" for every 5 minutes).',
        },
        time: {
          type: 'string',
          description:
            'ISO 8601 datetime for one-time jobs or cron start time (e.g., "2026-03-06T09:00:00").',
        },
        timezone: {
          type: 'string',
          description: 'IANA timezone (default: UTC).',
        },
        lifecycle: {
          type: 'string',
          description:
            '"persistent" (default, runs indefinitely) or "until_complete" (runs until complete_job is called).',
        },
        successCondition: {
          type: 'string',
          description:
            'What must happen for the job to be considered complete. Used with until_complete lifecycle.',
        },
        maxRuns: {
          type: 'number',
          description: 'Maximum number of executions before the job auto-completes. Safety limit.',
        },
      },
      required: ['title', 'prompt'],
    },
    annotations: { destructiveHint: false },
  },
]

export const SUBAGENT_TOOL_DEFS: SubagentToolDef[] = [
  {
    name: 'sim_workflow',
    agentId: 'workflow',
    description: `Create, modify, test, debug, and organize workflows end-to-end in a single step.

USE THIS WHEN:
- Building a new workflow from scratch
- Modifying an existing workflow
- You want to gather information and build in one pass
- Moving, renaming, or organizing workflows and folders

WORKFLOW ID (REQUIRED):
- For NEW workflows: First call create_workflow to get a workflowId, then pass it here
- For EXISTING workflows: Always pass the workflowId parameter

CAN DO:
- Gather information about blocks, credentials, patterns
- Search documentation and patterns for best practices
- Add, modify, or remove blocks
- Configure block settings and connections
- Set environment variables and workflow variables
- Move, rename, delete workflows and folders
- Run or inspect workflows through the nested run/debug specialists when validation is needed
- Delegate deployment or auth setup to the nested specialists when needed

CANNOT DO:
- Replace dedicated testing flows like sim_test when you want a standalone execution-only pass
- Replace dedicated deploy flows like sim_deploy when you want deployment as a separate step

WORKFLOW:
1. Call create_workflow to get a workflowId (for new workflows)
2. Call sim_workflow with the request and workflowId
3. Workflow agent gathers info, builds, and can delegate run/debug/auth/deploy help in one pass
4. Call sim_test when you want a dedicated execution-only verification pass
5. Optionally call sim_deploy to make it externally accessible`,
    inputSchema: {
      type: 'object',
      properties: {
        request: {
          type: 'string',
          description: 'What you want to build, modify, or organize.',
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
    annotations: { destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'sim_discovery',
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
    annotations: { readOnlyHint: true },
  },
  {
    name: 'sim_deploy',
    agentId: 'deploy',
    description: `Deploy a workflow to make it accessible externally. Workflows can be tested without deploying, but deployment is needed for API access, chat UIs, or MCP exposure.

DEPLOYMENT TYPES:
- "deploy as api" - REST API endpoint for programmatic access
- "deploy as chat" - Managed chat UI with auth options
- "deploy as mcp" - Expose as MCP tool on an MCP server for AI agents to call

MCP DEPLOYMENT FLOW:
The deploy subagent will automatically: list available MCP servers → create one if needed → deploy the workflow as an MCP tool to that server. You can specify server name, tool name, and tool description.

ALSO CAN:
- Get the deployed (production) state to compare with draft
- Generate workspace API keys for calling deployed workflows
- List and create MCP servers in the workspace`,
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
    annotations: { destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'sim_test',
    agentId: 'run',
    description: `Run a workflow and verify its outputs. Works on both deployed and undeployed (draft) workflows. Use after building to verify correctness.

Supports full and partial execution:
- Full run with test inputs
- Stop after a specific block (run_workflow_until_block)
- Run a single block in isolation (run_block)
- Resume from a specific block (run_from_block)`,
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
    annotations: { destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'sim_auth',
    agentId: 'auth',
    description:
      'Check OAuth connection status, list connected services, and initiate new OAuth connections. Use when a workflow needs third-party service access (Google, Slack, GitHub, etc.). In MCP/headless mode, returns an authorization URL the user must open in their browser to complete the OAuth flow.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['request'],
    },
    annotations: { destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'sim_knowledge',
    agentId: 'knowledge',
    description:
      'Manage knowledge bases for RAG-powered document retrieval. Supports listing, creating, updating, and deleting knowledge bases. Knowledge bases can be attached to agent blocks for context-aware responses.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['request'],
    },
    annotations: { destructiveHint: false },
  },
  {
    name: 'sim_table',
    agentId: 'table',
    description:
      'Manage user-defined tables for structured data storage. Supports creating tables with typed schemas, inserting/updating/deleting rows, querying with filters and sorting, and batch operations.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['request'],
    },
    annotations: { destructiveHint: false },
  },
  {
    name: 'sim_job',
    agentId: 'job',
    description:
      'Manage scheduled background jobs. Supports creating, listing, updating, pausing, resuming, and deleting jobs that run prompts against the Mothership on a schedule or at a specific time.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['request'],
    },
    annotations: { destructiveHint: false },
  },
  {
    name: 'sim_agent',
    agentId: 'agent',
    description:
      'Manage custom tools, MCP server connections, and skills for agent blocks. Supports creating, editing, deleting, and listing custom JavaScript tools, external MCP server connections, and workspace skills. Can also research external MCP tools and add deployed workflows as MCP tools.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['request'],
    },
    annotations: { destructiveHint: false },
  },
  {
    name: 'sim_info',
    agentId: 'info',
    description:
      "Inspect a workflow's blocks, connections, outputs, variables, and metadata. Use for questions about the Sim platform itself — how blocks work, what integrations are available, platform concepts, etc. Provide workflowId when you want results scoped to a specific workflow.",
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' },
        workflowId: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['request'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'sim_research',
    agentId: 'research',
    description:
      'Research external APIs and documentation. Use when you need to understand third-party services, external APIs, authentication flows, or data formats OUTSIDE of Sim. For questions about Sim itself, use sim_info instead.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['request'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'sim_superagent',
    agentId: 'superagent',
    description:
      'Execute direct actions NOW: send an email, post to Slack, make an API call, etc. Use when the user wants to DO something immediately rather than build a workflow for it.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['request'],
    },
    annotations: { destructiveHint: true, openWorldHint: true },
  },
  {
    name: 'sim_platform',
    agentId: 'tour',
    description:
      'Get help with Sim platform navigation, keyboard shortcuts, and UI actions. Use when the user asks "how do I..." about the Sim editor, wants keyboard shortcuts, or needs to know what actions are available in the UI.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['request'],
    },
    annotations: { readOnlyHint: true },
  },
]
