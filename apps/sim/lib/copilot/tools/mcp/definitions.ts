export type DirectToolDef = {
  name: string
  description: string
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] }
  toolId: string
}

export type SubagentToolDef = {
  name: string
  description: string
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] }
  agentId: string
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
  },
  {
    name: 'list_workflows',
    toolId: 'list_user_workflows',
    description:
      'List all workflows the user has access to. Returns workflow IDs, names, workspace, and folder info. Use workspaceId/folderId to scope results.',
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
  },
  {
    name: 'get_workflow',
    toolId: 'get_user_workflow',
    description:
      'Get a workflow by ID. Returns the full workflow definition including all blocks, connections, and configuration.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'Workflow ID to retrieve.',
        },
      },
      required: ['workflowId'],
    },
  },
  {
    name: 'create_workflow',
    toolId: 'create_workflow',
    description:
      'Create a new empty workflow. Returns the new workflow ID. Always call this FIRST before sim_build for new workflows. Use workspaceId to place it in a specific workspace.',
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
  },
  {
    name: 'run_workflow',
    toolId: 'run_workflow',
    description:
      'Run a workflow and return its output. Works on both draft and deployed states. By default runs the draft (live) state.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'REQUIRED. The workflow ID to run.',
        },
        workflow_input: {
          type: 'object',
          description:
            'JSON object with input values. Keys should match the workflow start block input field names.',
        },
        useDeployedState: {
          type: 'boolean',
          description: 'When true, runs the deployed version instead of the draft. Default: false.',
        },
      },
      required: ['workflowId'],
    },
  },
  {
    name: 'run_workflow_until_block',
    toolId: 'run_workflow_until_block',
    description:
      'Run a workflow and stop after a specific block completes. Useful for testing partial execution or debugging specific blocks.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'REQUIRED. The workflow ID to run.',
        },
        stopAfterBlockId: {
          type: 'string',
          description:
            'REQUIRED. The block ID to stop after. Execution halts once this block completes.',
        },
        workflow_input: {
          type: 'object',
          description: 'JSON object with input values for the workflow.',
        },
        useDeployedState: {
          type: 'boolean',
          description: 'When true, runs the deployed version instead of the draft. Default: false.',
        },
      },
      required: ['workflowId', 'stopAfterBlockId'],
    },
  },
  {
    name: 'run_from_block',
    toolId: 'run_from_block',
    description:
      'Run a workflow starting from a specific block, using cached outputs from a prior execution for upstream blocks. The workflow must have been run at least once first.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'REQUIRED. The workflow ID to run.',
        },
        startBlockId: {
          type: 'string',
          description: 'REQUIRED. The block ID to start execution from.',
        },
        executionId: {
          type: 'string',
          description:
            'Optional. Specific execution ID to load the snapshot from. Uses latest if omitted.',
        },
        workflow_input: {
          type: 'object',
          description: 'Optional input values for the workflow.',
        },
        useDeployedState: {
          type: 'boolean',
          description: 'When true, runs the deployed version instead of the draft. Default: false.',
        },
      },
      required: ['workflowId', 'startBlockId'],
    },
  },
  {
    name: 'run_block',
    toolId: 'run_block',
    description:
      'Run a single block in isolation using cached outputs from a prior execution. Only the specified block executes — nothing upstream or downstream. The workflow must have been run at least once first.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'REQUIRED. The workflow ID.',
        },
        blockId: {
          type: 'string',
          description: 'REQUIRED. The block ID to run in isolation.',
        },
        executionId: {
          type: 'string',
          description:
            'Optional. Specific execution ID to load the snapshot from. Uses latest if omitted.',
        },
        workflow_input: {
          type: 'object',
          description: 'Optional input values for the workflow.',
        },
        useDeployedState: {
          type: 'boolean',
          description: 'When true, runs the deployed version instead of the draft. Default: false.',
        },
      },
      required: ['workflowId', 'blockId'],
    },
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
  },
]

export const SUBAGENT_TOOL_DEFS: SubagentToolDef[] = [
  {
    name: 'sim_build',
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
- Run or test workflows (use sim_test separately)
- Deploy workflows (use sim_deploy separately)

WORKFLOW:
1. Call create_workflow to get a workflowId (for new workflows)
2. Call sim_build with the request and workflowId
3. Build agent gathers info and builds in one pass
4. Call sim_test to verify it works
5. Optionally call sim_deploy to make it externally accessible`,
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
  },
  {
    name: 'sim_plan',
    agentId: 'plan',
    description: `Plan workflow changes by gathering required information. For most cases, prefer sim_build which combines planning and editing in one step.

USE THIS WHEN:
- You need fine-grained control over the build process
- You want to inspect the plan before executing it

WORKFLOW ID (REQUIRED):
- For NEW workflows: First call create_workflow to get a workflowId, then pass it here
- For EXISTING workflows: Always pass the workflowId parameter

This tool gathers information about available blocks, credentials, and the current workflow state.

RETURNS: A plan object containing block configurations, connections, and technical details.
IMPORTANT: Pass the returned plan EXACTLY to sim_edit - do not modify or summarize it.`,
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
    name: 'sim_edit',
    agentId: 'edit',
    description: `Execute a workflow plan from sim_plan. For most cases, prefer sim_build which combines planning and editing in one step.

WORKFLOW ID (REQUIRED):
- You MUST provide the workflowId parameter

PLAN (REQUIRED):
- Pass the EXACT plan object from sim_plan in the context.plan field
- Do NOT modify, summarize, or interpret the plan - pass it verbatim

After sim_edit completes, you can test immediately with sim_test, or deploy with sim_deploy to make it accessible externally.`,
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Optional additional instructions for the edit.' },
        workflowId: {
          type: 'string',
          description:
            'REQUIRED. The workflow ID to edit. Get this from create_workflow for new workflows.',
        },
        plan: {
          type: 'object',
          description: 'The plan object from sim_plan. Pass it EXACTLY as returned, do not modify.',
        },
        context: {
          type: 'object',
          description:
            'Additional context. Put the plan in context.plan if not using the plan field directly.',
        },
      },
      required: ['workflowId'],
    },
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
  },
  {
    name: 'sim_test',
    agentId: 'test',
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
  },
  {
    name: 'sim_debug',
    agentId: 'debug',
    description:
      'Diagnose errors or unexpected workflow behavior. Provide the error message and workflowId. Returns root cause analysis and fix suggestions.',
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
    name: 'sim_auth',
    agentId: 'auth',
    description:
      'Check OAuth connection status, list connected services, and initiate new OAuth connections. Use when a workflow needs third-party service access (Google, Slack, GitHub, etc.).',
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
  },
  {
    name: 'sim_custom_tool',
    agentId: 'custom_tool',
    description:
      'Manage custom tools (reusable API integrations). Supports listing, creating, updating, and deleting custom tools. Custom tools can be added to agent blocks as callable functions.',
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
    name: 'sim_info',
    agentId: 'info',
    description:
      "Inspect a workflow's blocks, connections, outputs, variables, and metadata. Use for questions about the Sim platform itself — how blocks work, what integrations are available, platform concepts, etc. Always provide workflowId to scope results to a specific workflow.",
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
    name: 'sim_workflow',
    agentId: 'workflow',
    description:
      'Manage workflow-level configuration: environment variables, settings, scheduling, and deployment status. Use for any data about a specific workflow — its settings, credentials, variables, or deployment state.',
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
  },
]
