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

  // === Workflow read/inspect ===
  {
    name: 'get_workflow_data',
    toolId: 'get_workflow_data',
    description:
      "Get a workflow's full normalized state (blocks, edges, loops, parallels, variables) or a slice via data_type. Returns the same shape sim's internal copilot uses for inspection.",
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID to inspect.' },
        data_type: {
          type: 'string',
          description:
            'Optional slice: "all" (default), "blocks", "edges", "variables", "schedules", or "metadata".',
        },
      },
      required: ['workflowId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_block_outputs',
    toolId: 'get_block_outputs',
    description:
      "Get the output schema for one or more blocks in a workflow. Useful for understanding what data downstream blocks can reference via <blockName.field>.",
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID.' },
        blockIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Block IDs to inspect outputs for. Omit for all blocks.',
        },
      },
      required: ['workflowId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_block_upstream_references',
    toolId: 'get_block_upstream_references',
    description:
      "Get the variable references (<other_block.field> and {{ENV_VAR}}) available to a given block based on its upstream connections. Use when wiring inputs to a new block.",
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID.' },
        blockIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Block IDs to compute upstream references for.',
        },
      },
      required: ['workflowId', 'blockIds'],
    },
    annotations: { readOnlyHint: true },
  },

  // === Workflow mutations ===
  {
    name: 'delete_workflow',
    toolId: 'delete_workflow',
    description:
      'Permanently delete one or more workflows. Cascades to deployment versions, MCP tool registrations, and execution history.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Workflow IDs to delete.',
        },
      },
      required: ['workflowIds'],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: 'delete_folder',
    toolId: 'delete_folder',
    description:
      'Delete one or more empty folders. Workflows inside the folder must be moved or deleted first.',
    inputSchema: {
      type: 'object',
      properties: {
        folderIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Folder IDs to delete.',
        },
      },
      required: ['folderIds'],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: 'set_block_enabled',
    toolId: 'set_block_enabled',
    description:
      'Enable or disable a single block in a workflow. Disabled blocks are skipped during execution.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID.' },
        blockId: { type: 'string', description: 'Block ID to toggle.' },
        enabled: { type: 'boolean', description: 'true to enable, false to disable.' },
      },
      required: ['workflowId', 'blockId', 'enabled'],
    },
    annotations: { destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'set_global_workflow_variables',
    toolId: 'set_global_workflow_variables',
    description:
      "Add, edit, or delete a workflow's global variables in one batched operation. Each operation specifies a name and an action.",
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID.' },
        operations: {
          type: 'array',
          description: 'Variable mutations to apply.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Variable name.' },
              operation: {
                type: 'string',
                description: '"add", "edit", or "delete".',
              },
              value: { description: 'Variable value (for add/edit).' },
              type: {
                type: 'string',
                description: 'Variable type: "string", "number", "boolean", "object", or "array".',
              },
            },
            required: ['name', 'operation'],
          },
        },
      },
      required: ['workflowId', 'operations'],
    },
    annotations: { destructiveHint: false },
  },

  // === Deployment ===
  // NOTE: run_workflow / run_workflow_until_block / run_from_block / run_block
  // are intentionally NOT exposed via MCP. Their entries in
  // tool-catalog-v1.ts are route: 'client' — sim's tool-executor only
  // dispatches sim-routed tools to local handlers, so client-routed tools
  // fail with "Built-in tool not found" when called via MCP. External
  // callers should use the regular HTTP endpoint
  // POST /api/workflows/{id}/execute for synchronous workflow execution.
  {
    name: 'deploy_api',
    toolId: 'deploy_api',
    description:
      'Deploy a workflow as an API endpoint, or undeploy it. Once deployed, the workflow is callable at /api/workflows/{id}/execute with a workspace API key.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID.' },
        action: {
          type: 'string',
          description: '"deploy" (default) or "undeploy".',
        },
      },
      required: ['workflowId'],
    },
    annotations: { destructiveHint: false },
  },
  {
    name: 'deploy_chat',
    toolId: 'deploy_chat',
    description:
      "Deploy a workflow as a hosted chat UI, update its config, or undeploy it. Supports password/email/SSO/public auth modes and customizations.",
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID.' },
        action: { type: 'string', description: '"deploy" (default), "update", or "undeploy".' },
        identifier: { type: 'string', description: 'Public chat slug (subdomain).' },
        title: { type: 'string', description: 'Display title for the chat UI.' },
        description: { type: 'string', description: 'Display description.' },
        welcomeMessage: { type: 'string', description: 'First message shown in the chat.' },
        authType: {
          type: 'string',
          description: '"public", "password", "email", or "sso".',
        },
        password: { type: 'string', description: 'Required when authType="password".' },
        allowedEmails: {
          type: 'array',
          items: { type: 'string' },
          description: 'Required when authType="email".',
        },
        subdomain: { type: 'string', description: 'Optional subdomain override.' },
      },
      required: ['workflowId'],
    },
    annotations: { destructiveHint: false },
  },
  {
    name: 'deploy_mcp',
    toolId: 'deploy_mcp',
    description:
      "Publish a workflow as a tool on a workflow MCP server, or undeploy it. If serverId is omitted a new server is created. The tool's input schema is auto-generated from the workflow's start block input format.",
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID to publish as an MCP tool.' },
        action: { type: 'string', description: '"deploy" (default) or "undeploy".' },
        toolName: { type: 'string', description: 'Tool name as exposed to MCP clients.' },
        toolDescription: { type: 'string', description: 'Tool description for MCP clients.' },
        serverId: {
          type: 'string',
          description: 'Existing workflow MCP server to attach the tool to. Omit to create a new server.',
        },
      },
      required: ['workflowId'],
    },
    annotations: { destructiveHint: false },
  },
  {
    name: 'redeploy',
    toolId: 'redeploy',
    description:
      "Force a fresh deployment of a workflow's current draft state, replacing the active deployed version. Use after editing a deployed workflow to push changes live.",
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID to redeploy.' },
      },
      required: ['workflowId'],
    },
    annotations: { destructiveHint: false },
  },
  {
    name: 'check_deployment_status',
    toolId: 'check_deployment_status',
    description:
      "Get the deployment status of a workflow across all surfaces: API endpoint, chat UI, and MCP tools. Includes whether a redeploy is needed because the draft has diverged.",
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID to check.' },
      },
      required: ['workflowId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_deployment_version',
    toolId: 'get_deployment_version',
    description:
      "Get a specific deployment version's snapshot for a workflow. Pass version=1 for the first deploy, etc. Useful for diffing versions or restoring an older deployment.",
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID.' },
        version: { type: 'number', description: 'Deployment version number (1-indexed).' },
      },
      required: ['workflowId', 'version'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'revert_to_version',
    toolId: 'revert_to_version',
    description:
      "Revert a workflow's draft state to a previous deployment version's snapshot. Does not change the active deployment — call redeploy after if you want to push the reverted state live.",
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID.' },
        version: { type: 'number', description: 'Deployment version number to revert to.' },
      },
      required: ['workflowId', 'version'],
    },
    annotations: { destructiveHint: true },
  },

  // === Workflow MCP server publishing ===
  {
    name: 'list_workspace_mcp_servers',
    toolId: 'list_workspace_mcp_servers',
    description:
      'List all workflow MCP servers in a workspace, including each server\'s registered tools (workflow IDs and tool names). Pass workflowId to filter to servers that include a specific workflow.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID. Defaults to current.' },
        workflowId: { type: 'string', description: 'Optional: filter to servers that include this workflow.' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_workspace_mcp_server',
    toolId: 'create_workspace_mcp_server',
    description:
      "Create a new workflow MCP server in the workspace. Optionally seed it with one or more deployed workflows as tools.",
    inputSchema: {
      type: 'object',
      properties: {
        serverName: { type: 'string', description: 'Display name for the new server.' },
        description: { type: 'string', description: 'Optional server description.' },
        isPublic: { type: 'boolean', description: 'Whether the server is publicly accessible (default: false).' },
        workflowIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional initial workflow IDs to register as tools on this server.',
        },
      },
      required: ['serverName'],
    },
    annotations: { destructiveHint: false },
  },
  {
    name: 'update_workspace_mcp_server',
    toolId: 'update_workspace_mcp_server',
    description: 'Rename a workflow MCP server, update its description, or toggle isPublic.',
    inputSchema: {
      type: 'object',
      properties: {
        serverId: { type: 'string', description: 'Server ID to update.' },
        name: { type: 'string', description: 'New display name.' },
        description: { type: 'string', description: 'New description.' },
        isPublic: { type: 'boolean', description: 'Toggle public access.' },
      },
      required: ['serverId'],
    },
    annotations: { destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'delete_workspace_mcp_server',
    toolId: 'delete_workspace_mcp_server',
    description: 'Permanently delete a workflow MCP server and unregister all its tools.',
    inputSchema: {
      type: 'object',
      properties: {
        serverId: { type: 'string', description: 'Server ID to delete.' },
      },
      required: ['serverId'],
    },
    annotations: { destructiveHint: true },
  },

  // === Workspace assets (custom tools, MCP tools, skills, credentials) ===
  {
    name: 'manage_custom_tool',
    toolId: 'manage_custom_tool',
    description:
      'Create, edit, delete, or list workspace custom JavaScript tools that agent blocks can call. Pass operation: "list", "get", "add", "edit", or "delete" plus operation-specific args.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          description: '"list", "get", "add", "edit", or "delete".',
        },
        workspaceId: { type: 'string', description: 'Workspace ID. Defaults to current.' },
        toolId: { type: 'string', description: 'Tool ID (required for get/edit/delete).' },
        name: { type: 'string', description: 'Tool name (for add/edit).' },
        description: { type: 'string', description: 'Tool description (for add/edit).' },
        code: { type: 'string', description: 'JavaScript implementation (for add/edit).' },
        schema: { description: 'JSON schema for tool inputs (for add/edit).' },
      },
      required: ['operation'],
    },
    annotations: { destructiveHint: false },
  },
  {
    name: 'manage_mcp_tool',
    toolId: 'manage_mcp_tool',
    description:
      "Manage external MCP server connections used as tools by agent blocks. Pass operation: 'list', 'get', 'add', 'edit', or 'delete' plus operation-specific args (URL, auth, etc.).",
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', description: '"list", "get", "add", "edit", or "delete".' },
        serverId: { type: 'string', description: 'Server ID (required for get/edit/delete).' },
        name: { type: 'string', description: 'Display name (for add/edit).' },
        url: { type: 'string', description: 'MCP server URL (for add/edit).' },
        transport: { type: 'string', description: 'Transport type, e.g. "streamable-http" (for add/edit).' },
        headers: { description: 'Optional auth headers as a JSON object.' },
      },
      required: ['operation'],
    },
    annotations: { destructiveHint: false },
  },
  {
    name: 'manage_skill',
    toolId: 'manage_skill',
    description:
      'Manage workspace skills (reusable prompt+tool packages used by agent blocks). Pass operation: "list", "get", "add", "edit", or "delete".',
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', description: '"list", "get", "add", "edit", or "delete".' },
        skillId: { type: 'string', description: 'Skill ID (required for get/edit/delete).' },
        name: { type: 'string', description: 'Skill name (for add/edit).' },
        description: { type: 'string', description: 'Skill description (for add/edit).' },
        prompt: { type: 'string', description: 'Skill prompt body (for add/edit).' },
      },
      required: ['operation'],
    },
    annotations: { destructiveHint: false },
  },
  {
    name: 'manage_credential',
    toolId: 'manage_credential',
    description:
      'Manage OAuth/API credentials for third-party integrations (Slack, Google, GitHub, etc.). Pass operation: "list", "get", "add", "edit", or "delete".',
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', description: '"list", "get", "add", "edit", or "delete".' },
        credentialId: { type: 'string', description: 'Credential ID (required for get/edit/delete).' },
        provider: { type: 'string', description: 'Provider name, e.g. "slack" (for add).' },
      },
      required: ['operation'],
    },
    annotations: { destructiveHint: false },
  },

  // === OAuth ===
  {
    name: 'oauth_get_auth_link',
    toolId: 'oauth_get_auth_link',
    description:
      "Get an authorization URL for a third-party OAuth provider. The user opens this URL in their browser to grant access. Returns the URL only — does not initiate the flow.",
    inputSchema: {
      type: 'object',
      properties: {
        providerName: { type: 'string', description: 'Provider name (e.g. "slack", "google", "github").' },
      },
      required: ['providerName'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'oauth_request_access',
    toolId: 'oauth_request_access',
    description:
      'Notify the user they need to grant OAuth access for a provider. Returns a structured prompt the calling agent can show to guide the user.',
    inputSchema: {
      type: 'object',
      properties: {
        providerName: { type: 'string', description: 'Provider name (e.g. "slack", "google").' },
      },
      required: ['providerName'],
    },
    annotations: { readOnlyHint: true },
  },

  // === Jobs ===
  {
    name: 'manage_job',
    toolId: 'manage_job',
    description:
      'List, get, pause, resume, update, or delete scheduled background jobs. Pass operation plus operation-specific args (jobId, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', description: '"list", "get", "pause", "resume", "update", or "delete".' },
        args: { description: 'Operation-specific arguments.' },
      },
      required: ['operation'],
    },
    annotations: { destructiveHint: false },
  },
  {
    name: 'complete_job',
    toolId: 'complete_job',
    description:
      'Mark a scheduled job complete (stops further executions). Use for until_complete-lifecycle jobs once their success condition has been met.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job ID to mark complete.' },
      },
      required: ['jobId'],
    },
    annotations: { destructiveHint: false, idempotentHint: true },
  },

  // === Workspace VFS (file artifacts produced by workflows) ===
  {
    name: 'read_file',
    toolId: 'read',
    description:
      "Read a workspace file by path. Workspace files are produced by Function blocks (outputPath) and tools that emit artifacts. Returns text content.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path within the workspace, e.g. "files/result.json".' },
      },
      required: ['path'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'glob_files',
    toolId: 'glob',
    description:
      'List workspace files matching a glob pattern. Useful for finding artifacts produced by previous workflow runs.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern, e.g. "files/**/*.json".' },
      },
      required: ['pattern'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'grep_files',
    toolId: 'grep',
    description:
      'Search workspace file contents with a regex pattern. Returns matching lines with context.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for.' },
        output_mode: {
          type: 'string',
          description: '"content" (default), "files_with_matches", or "count".',
        },
      },
      required: ['pattern'],
    },
    annotations: { readOnlyHint: true },
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
