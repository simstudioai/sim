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

export const SUBAGENT_TOOL_DEFS: SubagentToolDef[] = [
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

