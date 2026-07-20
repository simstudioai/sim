// AUTO-GENERATED FILE. DO NOT EDIT.
// Generated from copilot/contracts/tool-catalog-v1.json
//

export type JsonSchema = unknown

export interface ToolRuntimeSchemaEntry {
  parameters?: JsonSchema
  resultSchema?: JsonSchema
}

export const TOOL_RUNTIME_SCHEMAS: Record<string, ToolRuntimeSchemaEntry> = {
  agent: {
    parameters: {
      properties: {
        request: {
          description: 'What tool/skill/MCP action is needed.',
          type: 'string',
        },
      },
      required: ['request'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  auth: {
    parameters: {
      properties: {
        request: {
          description: 'What authentication/credential action is needed.',
          type: 'string',
        },
      },
      required: ['request'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  call_integration_tool: {
    parameters: {
      properties: {
        arguments: {
          additionalProperties: true,
          description: "Inputs matching the selected operation's server-owned inputSchema.",
          type: 'object',
        },
        credentialId: {
          description:
            'Optional OAuth credential ID convenience field. It is injected into operation arguments when that schema accepts credentialId.',
          type: 'string',
        },
        description: {
          description:
            'Short base-form verb phrase describing this invocation, without the integration name (for example "Search for invoice emails").',
          type: 'string',
        },
        toolId: {
          description: 'Exact toolId returned by search_integration_tools.',
          type: 'string',
        },
      },
      required: ['toolId', 'description', 'arguments'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  check_deployment_status: {
    parameters: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'Workflow ID to check (defaults to current workflow)',
        },
      },
    },
    resultSchema: undefined,
  },
  complete_scheduled_task: {
    parameters: {
      type: 'object',
      properties: {
        jobId: {
          type: 'string',
          description: 'The ID of the scheduled task to mark as completed.',
        },
      },
      required: ['jobId'],
    },
    resultSchema: undefined,
  },
  cp: {
    parameters: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description:
            'Target path under workflows/. An existing folder (or a path ending in "/") duplicates sources into it keeping their names; otherwise the last segment names the copy and the preceding segments are the target folder (created automatically when missing).',
        },
        sources: {
          type: 'array',
          description:
            'Canonical workflow VFS paths to duplicate, e.g. ["workflows/My%20Workflow"]. Copy paths verbatim from glob/grep/read output.',
          items: {
            type: 'string',
          },
        },
        toolTitle: {
          type: 'string',
          description:
            'Target-only UI phrase for the action row, e.g. "My Workflow" or "Template to Archive", not a full sentence like "Copying My Workflow".',
        },
      },
      required: ['sources', 'destination', 'toolTitle'],
    },
    resultSchema: undefined,
  },
  crawl_website: {
    parameters: {
      type: 'object',
      properties: {
        exclude_paths: {
          type: 'array',
          description: 'Skip URLs matching these patterns',
          items: {
            type: 'string',
          },
        },
        include_paths: {
          type: 'array',
          description: 'Only crawl URLs matching these patterns',
          items: {
            type: 'string',
          },
        },
        limit: {
          type: 'number',
          description: 'Maximum pages to crawl (default 10, max 50)',
        },
        max_depth: {
          type: 'number',
          description: 'How deep to follow links (default 2)',
        },
        url: {
          type: 'string',
          description: 'Starting URL to crawl from',
        },
      },
      required: ['url'],
    },
    resultSchema: undefined,
  },
  create_file: {
    parameters: {
      type: 'object',
      properties: {
        contentType: {
          type: 'string',
          description:
            'Optional MIME type override. Usually omit and let the system infer from the file extension.',
        },
        fileName: {
          type: 'string',
          description:
            'Backward-compatible workspace filename. Prefer outputs.files[0].path for new calls.',
        },
        outputs: {
          type: 'object',
          description: 'Workspace file output declarations using canonical VFS paths.',
          properties: {
            files: {
              type: 'array',
              description:
                'Files to create or overwrite. Missing parent folders are created automatically for create mode.',
              items: {
                type: 'object',
                properties: {
                  mimeType: {
                    type: 'string',
                    description: 'Optional MIME type override when inference is not enough.',
                  },
                  mode: {
                    type: 'string',
                    description: 'Create a new file or overwrite an existing file at path.',
                    enum: ['create', 'overwrite'],
                  },
                  path: {
                    type: 'string',
                    description: 'Canonical destination VFS path, e.g. "files/Reports/result.csv".',
                  },
                },
                required: ['path', 'mode'],
              },
            },
          },
        },
      },
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description:
            'Contains id (internal file ID), name, and vfsPath. Use vfsPath for follow-up file tools.',
        },
        message: {
          type: 'string',
          description: 'Human-readable outcome.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the file was created.',
        },
      },
      required: ['success', 'message'],
    },
  },
  create_workflow: {
    parameters: {
      type: 'object',
      properties: {
        folderPath: {
          type: 'string',
          description:
            'Optional canonical workflow-folder VFS path copied from glob("workflows/**"), for example "workflows/Dream" or "workflows/Client%20Work/Intake". Omit for the workspace root.',
        },
        name: {
          type: 'string',
          description: 'Workflow name.',
        },
        workspaceId: {
          type: 'string',
          description: 'Optional workspace ID.',
        },
      },
      required: ['name'],
    },
    resultSchema: undefined,
  },
  create_workspace_mcp_server: {
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Optional description for the server',
        },
        isPublic: {
          type: 'boolean',
          description: 'Whether the workflow MCP server is publicly accessible',
        },
        name: {
          type: 'string',
          description: 'Required: server name',
        },
        workflowIds: {
          type: 'array',
          description: 'Optional deployed workflow IDs to publish as tools on the new server',
          items: {
            type: 'string',
          },
        },
        workspaceId: {
          type: 'string',
          description:
            'Workspace ID. Required when no current workspace context is available, such as headless MCP calls.',
        },
      },
      required: ['name'],
    },
    resultSchema: undefined,
  },
  delete_file: {
    parameters: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          description:
            'Canonical workspace file VFS paths to delete, e.g. ["files/Reports/draft.md"].',
          items: {
            type: 'string',
          },
        },
      },
      required: ['paths'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Human-readable outcome.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the delete succeeded.',
        },
      },
      required: ['success', 'message'],
    },
  },
  delete_file_folder: {
    parameters: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          description: 'Canonical folder VFS paths to delete, e.g. ["files/Archive"].',
          items: {
            type: 'string',
          },
        },
      },
      required: ['paths'],
    },
    resultSchema: undefined,
  },
  delete_workflow: {
    parameters: {
      type: 'object',
      properties: {
        workflowIds: {
          type: 'array',
          description: 'The workflow IDs to delete.',
          items: {
            type: 'string',
          },
        },
      },
      required: ['workflowIds'],
    },
    resultSchema: undefined,
  },
  delete_workspace_mcp_server: {
    parameters: {
      type: 'object',
      properties: {
        serverId: {
          type: 'string',
          description: 'Required: the MCP server ID to delete',
        },
      },
      required: ['serverId'],
    },
    resultSchema: undefined,
  },
  deploy: {
    parameters: {
      properties: {
        request: {
          description:
            'Detailed deployment instructions. Include the deployment type and ALL user-specified options: identifier, title, description, authType, password, allowedEmails, welcomeMessage, outputConfigs (block outputs to display).',
          type: 'string',
        },
      },
      required: ['request'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  deploy_api: {
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Whether to deploy or undeploy the API endpoint',
          enum: ['deploy', 'undeploy'],
          default: 'deploy',
        },
        versionDescription: {
          type: 'string',
          description:
            'REQUIRED when action is "deploy": a concise (1-3 sentence) description of what changed in this deployment version, e.g. "Adds Slack failure alert and retries on the HTTP block". If unsure what changed, call diff_workflows(ref1: "live", ref2: "draft") first. Ignored for undeploy.',
        },
        versionName: {
          type: 'string',
          description:
            'REQUIRED when action is "deploy": a short human-readable name/label for this deployment version (shown in the deployment history), e.g. "v2 pricing" or "Add Slack alerts". Ignored for undeploy.',
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID to deploy (required in workspace context)',
        },
      },
    },
    resultSchema: {
      type: 'object',
      properties: {
        apiEndpoint: {
          type: 'string',
          description: 'Canonical workflow execution endpoint.',
        },
        baseUrl: {
          type: 'string',
          description: 'Base URL used to construct deployment URLs.',
        },
        deployedAt: {
          type: 'string',
          description: 'Deployment timestamp when the workflow is deployed.',
        },
        deploymentConfig: {
          type: 'object',
          description:
            'Structured deployment configuration keyed by surface name. For API deploys this includes endpoint, auth, and sync/stream/async mode details.',
        },
        deploymentStatus: {
          type: 'object',
          description:
            'Structured per-surface deployment status keyed by surface name, such as api.',
        },
        deploymentType: {
          type: 'string',
          description:
            'Deployment surface this result describes. For deploy_api and redeploy this is always "api".',
        },
        examples: {
          type: 'object',
          description:
            'Invocation examples keyed by surface name. For API deploys this includes curl examples for sync, stream, async, and polling.',
        },
        isDeployed: {
          type: 'boolean',
          description: 'Whether the workflow API is currently deployed after this tool call.',
        },
        version: {
          type: 'number',
          description: 'Deployment version for the current API deployment.',
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID that was deployed or undeployed.',
        },
      },
      required: [
        'workflowId',
        'isDeployed',
        'deploymentType',
        'deploymentStatus',
        'deploymentConfig',
        'examples',
      ],
    },
  },
  deploy_chat: {
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Whether to deploy or undeploy the chat interface',
          enum: ['deploy', 'undeploy'],
          default: 'deploy',
        },
        allowedEmails: {
          type: 'array',
          description: 'List of allowed emails/domains for email or SSO auth',
          items: {
            type: 'string',
          },
        },
        authType: {
          type: 'string',
          description: 'Authentication type: public, password, email, or sso',
          enum: ['public', 'password', 'email', 'sso'],
          default: 'public',
        },
        description: {
          type: 'string',
          description: 'Optional chat-facing description shown on the chat page',
        },
        identifier: {
          type: 'string',
          description: 'URL slug for the chat (lowercase letters, numbers, hyphens only)',
        },
        outputConfigs: {
          type: 'array',
          description: 'Output configurations specifying which block outputs to display in chat',
          items: {
            type: 'object',
            properties: {
              blockId: {
                type: 'string',
                description: 'The block UUID',
              },
              path: {
                type: 'string',
                description:
                  'The output path (e.g. `content` for an agent; structured fields are top-level paths). Call get_block_outputs for real paths.',
              },
            },
            required: ['blockId', 'path'],
          },
        },
        password: {
          type: 'string',
          description: 'Password for password-protected chats',
        },
        title: {
          type: 'string',
          description: 'Display title for the chat interface',
        },
        versionDescription: {
          type: 'string',
          description:
            'REQUIRED when action is "deploy": a concise (1-3 sentence) description of what changed in this deployment version (distinct from the chat-facing description). If unsure what changed, call diff_workflows(ref1: "live", ref2: "draft") first. Ignored for undeploy.',
        },
        versionName: {
          type: 'string',
          description:
            'REQUIRED when action is "deploy": a short human-readable name/label for this deployment version (distinct from the chat title; shown in deployment history). Ignored for undeploy.',
        },
        welcomeMessage: {
          type: 'string',
          description: 'Welcome message shown to users',
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID to deploy (required in workspace context)',
        },
      },
    },
    resultSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Action performed by the tool, such as "deploy" or "undeploy".',
        },
        apiEndpoint: {
          type: 'string',
          description: 'Paired workflow execution endpoint used by the chat deployment.',
        },
        baseUrl: {
          type: 'string',
          description: 'Base URL used to construct deployment URLs.',
        },
        chatUrl: {
          type: 'string',
          description: 'Shareable chat URL when the chat surface is deployed.',
        },
        deployedAt: {
          type: 'string',
          description: 'Deployment timestamp for the underlying workflow deployment.',
        },
        deploymentConfig: {
          type: 'object',
          description:
            'Structured deployment configuration keyed by surface name. Includes chat settings and the paired API invocation configuration.',
        },
        deploymentStatus: {
          type: 'object',
          description:
            'Structured per-surface deployment status keyed by surface name, including api and chat.',
        },
        deploymentType: {
          type: 'string',
          description:
            'Deployment surface this result describes. For deploy_chat this is always "chat".',
        },
        examples: {
          type: 'object',
          description:
            'Invocation examples keyed by surface name. Includes chat access details and API curl examples.',
        },
        identifier: {
          type: 'string',
          description: 'Chat identifier or slug.',
        },
        isChatDeployed: {
          type: 'boolean',
          description: 'Whether the chat surface is deployed after this tool call.',
        },
        isDeployed: {
          type: 'boolean',
          description: 'Whether the paired API surface remains deployed after this tool call.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the deploy_chat action completed successfully.',
        },
        version: {
          type: 'number',
          description: 'Deployment version for the underlying workflow deployment.',
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID associated with the chat deployment.',
        },
      },
      required: [
        'workflowId',
        'success',
        'action',
        'isDeployed',
        'isChatDeployed',
        'deploymentType',
        'deploymentStatus',
        'deploymentConfig',
        'examples',
      ],
    },
  },
  deploy_custom_block: {
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Whether to publish (deploy) or unpublish (undeploy) the custom block',
          enum: ['deploy', 'undeploy'],
          default: 'deploy',
        },
        description: {
          type: 'string',
          description: 'Short description shown in the block picker, max 280 characters',
        },
        exposedOutputs: {
          type: 'array',
          description:
            "Outputs the block exposes, each mapping a child block output path to a friendly name (use get_block_outputs for valid paths). Omit to expose the terminal block's whole result",
          items: {
            type: 'object',
            properties: {
              blockId: {
                type: 'string',
                description: 'Block UUID inside the workflow',
              },
              name: {
                type: 'string',
                description: 'Friendly output name shown on the block',
              },
              path: {
                type: 'string',
                description:
                  "Dot-path into that block's output (from get_block_outputs relativeOutputs)",
              },
            },
            required: ['blockId', 'path', 'name'],
          },
        },
        iconUrl: {
          type: 'string',
          description:
            'Optional icon image for the block: a workspace file VFS path (e.g. "files/icon.png", copied into public icon storage at publish) or an https image URL. Omit to use the organization\'s default icon',
        },
        inputs: {
          type: 'array',
          description:
            "Optional per-input placeholder overrides. Input names and types are derived from the workflow's input trigger and cannot be changed here",
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Stable id of the input trigger field',
              },
              placeholder: {
                type: 'string',
                description: "Placeholder text shown in the block's input field",
              },
            },
            required: ['id'],
          },
        },
        name: {
          type: 'string',
          description:
            'Display name for the block, max 60 characters. When republishing an existing block, pass the current name to keep it or a new name to rename.',
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID (defaults to active workflow)',
        },
      },
      required: ['name'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Action performed by the tool, such as "deploy" or "undeploy".',
        },
        blockId: {
          type: 'string',
          description: 'Custom block record ID.',
        },
        blockType: {
          type: 'string',
          description: 'Stable block type slug (custom_block_*) used in workflow state.',
        },
        deploymentConfig: {
          type: 'object',
          description:
            "Structured deployment configuration keyed by surface name. Includes the block's type, name, description, icon, derived input fields, and exposed outputs.",
        },
        deploymentStatus: {
          type: 'object',
          description:
            'Structured per-surface deployment status keyed by surface name, including customBlock and the underlying api surface when applicable.',
        },
        deploymentType: {
          type: 'string',
          description:
            'Deployment surface this result describes. For deploy_custom_block this is always "custom_block".',
        },
        isDeployed: {
          type: 'boolean',
          description: 'Whether the custom block is published after this tool call.',
        },
        name: {
          type: 'string',
          description: 'Display name of the custom block.',
        },
        removed: {
          type: 'boolean',
          description: 'Whether the custom block was unpublished during an undeploy action.',
        },
        updated: {
          type: 'boolean',
          description: 'Whether an existing custom block was updated instead of created.',
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID the custom block is bound to.',
        },
      },
      required: ['deploymentType', 'deploymentStatus'],
    },
  },
  deploy_mcp: {
    parameters: {
      type: 'object',
      properties: {
        parameterDescriptions: {
          type: 'array',
          description: 'Array of parameter descriptions for the tool',
          items: {
            type: 'object',
            properties: {
              description: {
                type: 'string',
                description: 'Parameter description',
              },
              name: {
                type: 'string',
                description: 'Parameter name',
              },
            },
            required: ['name', 'description'],
          },
        },
        serverId: {
          type: 'string',
          description: 'Required: server ID from list_workspace_mcp_servers',
        },
        toolDescription: {
          type: 'string',
          description: 'Description for the MCP tool',
        },
        toolName: {
          type: 'string',
          description: 'Name for the MCP tool (defaults to workflow name)',
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID (defaults to active workflow)',
        },
      },
      required: ['serverId'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Action performed by the tool, such as "deploy" or "undeploy".',
        },
        apiEndpoint: {
          type: 'string',
          description: 'Underlying workflow API endpoint associated with the MCP tool.',
        },
        baseUrl: {
          type: 'string',
          description: 'Base URL used to construct deployment URLs.',
        },
        deploymentConfig: {
          type: 'object',
          description:
            'Structured deployment configuration keyed by surface name. Includes MCP server, tool, auth, and parameter schema details.',
        },
        deploymentStatus: {
          type: 'object',
          description:
            'Structured per-surface deployment status keyed by surface name, including mcp and the underlying api surface when applicable.',
        },
        deploymentType: {
          type: 'string',
          description:
            'Deployment surface this result describes. For deploy_mcp this is always "mcp".',
        },
        examples: {
          type: 'object',
          description:
            'Setup examples keyed by surface name. Includes ready-to-paste config snippets for supported MCP clients.',
        },
        mcpServerUrl: {
          type: 'string',
          description: 'HTTP MCP server URL to configure in clients.',
        },
        removed: {
          type: 'boolean',
          description: 'Whether the MCP deployment was removed during an undeploy action.',
        },
        serverId: {
          type: 'string',
          description: 'Workspace MCP server ID.',
        },
        serverName: {
          type: 'string',
          description: 'Workspace MCP server name.',
        },
        toolDescription: {
          type: 'string',
          description: 'MCP tool description exposed on the server.',
        },
        toolId: {
          type: 'string',
          description: 'MCP tool ID when deployed.',
        },
        toolName: {
          type: 'string',
          description: 'MCP tool name exposed on the server.',
        },
        updated: {
          type: 'boolean',
          description: 'Whether an existing MCP tool deployment was updated instead of created.',
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID associated with the MCP deployment.',
        },
      },
      required: ['deploymentType', 'deploymentStatus'],
    },
  },
  diff_workflows: {
    parameters: {
      type: 'object',
      properties: {
        ref1: {
          type: 'string',
          description:
            'Base side (string): a version number (e.g. "3"), "live" (active deployment), or "draft" (current editor state).',
        },
        ref2: {
          type: 'string',
          description:
            'Target side (string): a version number (e.g. "4"), "live" (active deployment), or "draft" (current editor state).',
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID. If not provided, uses the current workflow in context.',
        },
      },
      required: ['ref1', 'ref2'],
    },
    resultSchema: undefined,
  },
  download_to_workspace_file: {
    parameters: {
      type: 'object',
      properties: {
        fileName: {
          type: 'string',
          description:
            'Backward-compatible workspace file name. Prefer outputs.files[0].path for new calls.',
        },
        outputs: {
          type: 'object',
          description: 'Workspace file output declarations using canonical VFS paths.',
          properties: {
            files: {
              type: 'array',
              description:
                'Files to create or overwrite. Missing parent folders are created automatically for create mode.',
              items: {
                type: 'object',
                properties: {
                  mimeType: {
                    type: 'string',
                    description: 'Optional MIME type override when inference is not enough.',
                  },
                  mode: {
                    type: 'string',
                    description: 'Create a new file or overwrite an existing file at path.',
                    enum: ['create', 'overwrite'],
                  },
                  path: {
                    type: 'string',
                    description: 'Canonical destination VFS path, e.g. "files/Reports/result.csv".',
                  },
                },
                required: ['path', 'mode'],
              },
            },
          },
        },
        url: {
          type: 'string',
          description:
            'Direct URL of the file to download, such as an image CDN URL ending in .png or .jpg',
        },
      },
      required: ['url'],
    },
    resultSchema: undefined,
  },
  edit_content: {
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description:
            'The text content to write. For append: text to append. For update: full replacement text. For patch with search_replace: the replacement text. For patch with anchored: the insert/replacement text.',
        },
      },
      required: ['content'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description:
            'Optional operation metadata such as file id, file name, size, and content type.',
        },
        message: {
          type: 'string',
          description: 'Human-readable summary of the outcome.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the content was applied successfully.',
        },
      },
      required: ['success', 'message'],
    },
  },
  edit_workflow: {
    parameters: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          description: 'Array of edit operations',
          items: {
            type: 'object',
            properties: {
              block_id: {
                type: 'string',
                description:
                  'Block ID for the operation. For add operations, this will be the desired ID for the new block.',
              },
              operation_type: {
                type: 'string',
                description: 'Type of operation to perform',
                enum: ['add', 'edit', 'delete', 'insert_into_subflow', 'extract_from_subflow'],
              },
              params: {
                type: 'object',
                description:
                  'Parameters for the operation (optional).\nFor edit: {"inputs": {"temperature": 0.5}} NOT {"subBlocks": {"temperature": {"value": 0.5}}}\nFor add: {"type": "agent", "name": "My Agent", "inputs": {"model": "<model-id from agent.json>"}}\nFor delete: omit params entirely (none needed)',
              },
            },
            required: ['operation_type', 'block_id'],
          },
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID to edit. If not provided, uses the current workflow in context.',
        },
      },
      required: ['operations'],
    },
    resultSchema: undefined,
  },
  enrichment_run: {
    parameters: {
      type: 'object',
      properties: {
        enrichmentId: {
          type: 'string',
          description:
            "Which enrichment to run. Discover the full set and each one's inputs/outputs via user_table.list_enrichments.",
          enum: [
            'work-email',
            'phone-number',
            'company-domain',
            'company-info',
            'email-verification',
          ],
        },
        inputs: {
          type: 'object',
          description:
            'Map of the enrichment\'s input id → value, e.g. { "fullName": "Jane Doe", "companyDomain": "acme.com" }. Provide a value for every required input.',
        },
      },
      required: ['enrichmentId', 'inputs'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        matched: {
          type: 'boolean',
          description: 'True when a provider returned a non-empty result.',
        },
        provider: {
          type: 'string',
          description:
            'Internal label of the provider that produced the result (billing/diagnostics only — do NOT surface it to the user), or null on no match.',
        },
        result: {
          type: 'object',
          description: 'Mapped output values from the winning provider (empty object on no match).',
        },
      },
      required: ['matched', 'result'],
    },
  },
  ffmpeg: {
    parameters: {
      type: 'object',
      properties: {
        aspectRatio: {
          type: 'string',
          description: 'Target aspect ratio for scale_pad, e.g. 9:16, 16:9, 1:1.',
        },
        end: {
          type: 'number',
          description: 'End time in seconds (trim).',
        },
        format: {
          type: 'string',
          description: 'Target format/extension for convert (e.g. mp4, mp3, wav, gif).',
        },
        height: {
          type: 'number',
          description: 'Target height in pixels (scale_pad).',
        },
        inputs: {
          type: 'object',
          description:
            'Workspace resources to mount into the sandbox. Copy paths verbatim from glob/read/grep output — they are percent-encoded per segment (spaces are %20, an in-name slash is %2F; parentheses and dots stay literal). Both the encoded path and the plain name resolve, so copy the returned path exactly rather than retyping or decoding it.',
          properties: {
            directories: {
              type: 'array',
              description:
                'Workspace folders to mount recursively into the sandbox, including nested files and empty folders.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description:
                      'Canonical VFS folder path, e.g. "files/Reports". By default this mounts at "/home/user/{path}".',
                  },
                  sandboxPath: {
                    type: 'string',
                    description:
                      'Optional full sandbox directory path override. Omit to mount at /home/user/{path}.',
                  },
                },
                required: ['path'],
              },
            },
            files: {
              type: 'array',
              description: 'Workspace files to mount into the sandbox.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description:
                      'Canonical VFS file path, e.g. "files/Reports/sales.csv". By default this mounts at "/home/user/{path}".',
                  },
                  sandboxPath: {
                    type: 'string',
                    description:
                      'Full sandbox path to mount at, e.g. /home/user/inputs/data.csv. STRONGLY RECOMMENDED whenever the file name has spaces or special characters: the default mount path is the percent-ENCODED canonical path (e.g. /home/user/files/Q4%20Sales%20(Final).csv), which code using the human-readable name will not find. Set a simple sandboxPath and read exactly that.',
                  },
                },
                required: ['path'],
              },
            },
            tables: {
              type: 'array',
              description: 'Workspace tables to mount as CSV files.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'Canonical VFS table path when available.',
                  },
                  sandboxPath: {
                    type: 'string',
                    description: 'Optional full sandbox path for the mounted CSV.',
                  },
                  tableId: {
                    type: 'string',
                    description: 'Workspace table ID.',
                  },
                },
              },
            },
          },
        },
        loopToVideo: {
          type: 'boolean',
          description: 'For overlay_audio, loop or trim the audio to match the video length.',
        },
        musicVolume: {
          type: 'number',
          description: 'Volume multiplier for the background music track in mix_audio (e.g. 0.3).',
        },
        operation: {
          type: 'string',
          description: 'The FFmpeg operation to run.',
          enum: [
            'overlay_audio',
            'mix_audio',
            'concat',
            'trim',
            'scale_pad',
            'overlay_image',
            'add_text',
            'fade',
            'extract_audio',
            'convert',
            'thumbnail',
            'probe',
          ],
        },
        outputs: {
          type: 'object',
          description:
            'Workspace files to create or overwrite from returned code results or sandbox-created files.',
          properties: {
            files: {
              type: 'array',
              description:
                'File outputs. Missing parent folders are created automatically for create mode.',
              items: {
                type: 'object',
                properties: {
                  format: {
                    type: 'string',
                    description: 'Optional serialization format for returned values.',
                    enum: ['json', 'csv', 'txt', 'md', 'html'],
                  },
                  mimeType: {
                    type: 'string',
                    description: 'Optional MIME type override when inference is not enough.',
                  },
                  mode: {
                    type: 'string',
                    description: 'Create a new file or overwrite an existing file at path.',
                    enum: ['create', 'overwrite'],
                  },
                  path: {
                    type: 'string',
                    description: 'Canonical destination VFS path, e.g. "files/Reports/chart.png".',
                  },
                  sandboxPath: {
                    type: 'string',
                    description:
                      'Optional full path to a file created inside the sandbox. Omit to save the code return value.',
                  },
                },
                required: ['path', 'mode'],
              },
            },
          },
        },
        position: {
          type: 'string',
          description: 'Placement for add_text / overlay_image.',
          enum: ['top', 'center', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'],
        },
        start: {
          type: 'number',
          description: 'Start time in seconds (trim, thumbnail, fade).',
        },
        text: {
          type: 'string',
          description: 'Text to burn in for add_text.',
        },
        volume: {
          type: 'number',
          description: 'Volume multiplier for the primary track (mix_audio / overlay_audio).',
        },
        width: {
          type: 'number',
          description: 'Target width in pixels (scale_pad).',
        },
      },
      required: ['operation', 'inputs'],
    },
    resultSchema: undefined,
  },
  file: {
    parameters: {
      properties: {
        prompt: {
          description:
            "Optional brief instruction (one short sentence) to scope the task. The agent inherits the full conversation history — do NOT restate or rewrite conversation content, only add scoping the history doesn't convey.",
          type: 'string',
        },
      },
      type: 'object',
    },
    resultSchema: undefined,
  },
  function_execute: {
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'Code to execute. For JS: raw statements auto-wrapped in async context. For Python: full script. For shell: bash script with access to pre-installed CLI tools and workspace env vars as $VAR_NAME.',
        },
        inputs: {
          type: 'object',
          description:
            'Workspace resources to mount into the sandbox. Copy paths verbatim from glob/read/grep output — they are percent-encoded per segment (spaces are %20, an in-name slash is %2F; parentheses and dots stay literal). Both the encoded path and the plain name resolve, so copy the returned path exactly rather than retyping or decoding it.',
          properties: {
            directories: {
              type: 'array',
              description:
                'Workspace folders to mount recursively into the sandbox, including nested files and empty folders.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description:
                      'Canonical VFS folder path, e.g. "files/Reports". By default this mounts at "/home/user/{path}".',
                  },
                  sandboxPath: {
                    type: 'string',
                    description:
                      'Optional full sandbox directory path override. Omit to mount at /home/user/{path}.',
                  },
                },
                required: ['path'],
              },
            },
            files: {
              type: 'array',
              description: 'Workspace files to mount into the sandbox.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description:
                      'Canonical VFS file path, e.g. "files/Reports/sales.csv". By default this mounts at "/home/user/{path}".',
                  },
                  sandboxPath: {
                    type: 'string',
                    description:
                      'Full sandbox path to mount at, e.g. /home/user/inputs/data.csv. STRONGLY RECOMMENDED whenever the file name has spaces or special characters: the default mount path is the percent-ENCODED canonical path (e.g. /home/user/files/Q4%20Sales%20(Final).csv), which code using the human-readable name will not find. Set a simple sandboxPath and read exactly that.',
                  },
                },
                required: ['path'],
              },
            },
            tables: {
              type: 'array',
              description: 'Workspace tables to mount as CSV files.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'Canonical VFS table path when available.',
                  },
                  sandboxPath: {
                    type: 'string',
                    description: 'Optional full sandbox path for the mounted CSV.',
                  },
                  tableId: {
                    type: 'string',
                    description: 'Workspace table ID.',
                  },
                },
              },
            },
          },
        },
        language: {
          type: 'string',
          description: 'Execution language.',
          enum: ['javascript', 'python', 'shell'],
        },
        outputTable: {
          type: 'string',
          description:
            'Table ID to overwrite with the code\'s return value. Code MUST return an array of objects where keys match column names. All existing rows are replaced. Example: "tbl_abc123"',
        },
        outputs: {
          type: 'object',
          description:
            'Workspace files to create or overwrite from returned code results or sandbox-created files.',
          properties: {
            files: {
              type: 'array',
              description:
                'File outputs. Missing parent folders are created automatically for create mode.',
              items: {
                type: 'object',
                properties: {
                  format: {
                    type: 'string',
                    description: 'Optional serialization format for returned values.',
                    enum: ['json', 'csv', 'txt', 'md', 'html'],
                  },
                  mimeType: {
                    type: 'string',
                    description: 'Optional MIME type override when inference is not enough.',
                  },
                  mode: {
                    type: 'string',
                    description: 'Create a new file or overwrite an existing file at path.',
                    enum: ['create', 'overwrite'],
                  },
                  path: {
                    type: 'string',
                    description: 'Canonical destination VFS path, e.g. "files/Reports/chart.png".',
                  },
                  sandboxPath: {
                    type: 'string',
                    description:
                      'Optional full path to a file created inside the sandbox. Omit to save the code return value.',
                  },
                },
                required: ['path', 'mode'],
              },
            },
          },
        },
        timeout: {
          type: 'number',
          description:
            'Maximum execution time in seconds. The sandbox stops execution and returns a timeout error after this duration. Defaults to 10 seconds; the platform execution limit still applies.',
          default: 10,
        },
        title: {
          type: 'string',
          description:
            'Short user-visible label for this execution, e.g. "Clean customer CSV", "Revenue chart", or "Query GitHub issues".',
        },
      },
      required: ['code'],
    },
    resultSchema: undefined,
  },
  generate_api_key: {
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            "A descriptive name for the API key (e.g., 'production-key', 'dev-testing').",
        },
        workspaceId: {
          type: 'string',
          description: "Optional workspace ID. Defaults to user's default workspace.",
        },
      },
      required: ['name'],
    },
    resultSchema: undefined,
  },
  generate_audio: {
    parameters: {
      type: 'object',
      properties: {
        duration: {
          type: 'number',
          description:
            'Approximate duration in seconds for sfx (and music models that support it). MiniMax music ignores this — fit music to a video with the ffmpeg tool instead.',
        },
        inputs: {
          type: 'object',
          description:
            'Workspace resources to mount into the sandbox. Copy paths verbatim from glob/read/grep output — they are percent-encoded per segment (spaces are %20, an in-name slash is %2F; parentheses and dots stay literal). Both the encoded path and the plain name resolve, so copy the returned path exactly rather than retyping or decoding it.',
          properties: {
            directories: {
              type: 'array',
              description:
                'Workspace folders to mount recursively into the sandbox, including nested files and empty folders.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description:
                      'Canonical VFS folder path, e.g. "files/Reports". By default this mounts at "/home/user/{path}".',
                  },
                  sandboxPath: {
                    type: 'string',
                    description:
                      'Optional full sandbox directory path override. Omit to mount at /home/user/{path}.',
                  },
                },
                required: ['path'],
              },
            },
            files: {
              type: 'array',
              description: 'Workspace files to mount into the sandbox.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description:
                      'Canonical VFS file path, e.g. "files/Reports/sales.csv". By default this mounts at "/home/user/{path}".',
                  },
                  sandboxPath: {
                    type: 'string',
                    description:
                      'Full sandbox path to mount at, e.g. /home/user/inputs/data.csv. STRONGLY RECOMMENDED whenever the file name has spaces or special characters: the default mount path is the percent-ENCODED canonical path (e.g. /home/user/files/Q4%20Sales%20(Final).csv), which code using the human-readable name will not find. Set a simple sandboxPath and read exactly that.',
                  },
                },
                required: ['path'],
              },
            },
            tables: {
              type: 'array',
              description: 'Workspace tables to mount as CSV files.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'Canonical VFS table path when available.',
                  },
                  sandboxPath: {
                    type: 'string',
                    description: 'Optional full sandbox path for the mounted CSV.',
                  },
                  tableId: {
                    type: 'string',
                    description: 'Workspace table ID.',
                  },
                },
              },
            },
          },
        },
        instrumental: {
          type: 'boolean',
          description:
            'For music: true = instrumental, no vocals (default); false = a song with vocals.',
        },
        lyrics: {
          type: 'string',
          description:
            'For music with vocals: the lyrics to sing (optional; supports [Verse]/[Chorus] tags). Setting this implies instrumental=false.',
        },
        model: {
          type: 'string',
          description:
            'Optional model override for the selected type (e.g. fal-ai/elevenlabs/tts/eleven-v3 for speech).',
        },
        outputs: {
          type: 'object',
          description:
            'Workspace files to create or overwrite from returned code results or sandbox-created files.',
          properties: {
            files: {
              type: 'array',
              description:
                'File outputs. Missing parent folders are created automatically for create mode.',
              items: {
                type: 'object',
                properties: {
                  format: {
                    type: 'string',
                    description: 'Optional serialization format for returned values.',
                    enum: ['json', 'csv', 'txt', 'md', 'html'],
                  },
                  mimeType: {
                    type: 'string',
                    description: 'Optional MIME type override when inference is not enough.',
                  },
                  mode: {
                    type: 'string',
                    description: 'Create a new file or overwrite an existing file at path.',
                    enum: ['create', 'overwrite'],
                  },
                  path: {
                    type: 'string',
                    description: 'Canonical destination VFS path, e.g. "files/Reports/chart.png".',
                  },
                  sandboxPath: {
                    type: 'string',
                    description:
                      'Optional full path to a file created inside the sandbox. Omit to save the code return value.',
                  },
                },
                required: ['path', 'mode'],
              },
            },
          },
        },
        prompt: {
          type: 'string',
          description:
            'For speech: the text to speak (may include expressive tags). For music/sfx: a description of the audio to generate.',
        },
        type: {
          type: 'string',
          description: 'Kind of audio to generate. Defaults to speech.',
          enum: ['speech', 'music', 'sfx'],
        },
        voice: {
          type: 'string',
          description: 'Optional voice name or id for speech.',
        },
      },
      required: ['prompt'],
    },
    resultSchema: undefined,
  },
  generate_image: {
    parameters: {
      type: 'object',
      properties: {
        aspectRatio: {
          type: 'string',
          description: 'Aspect ratio for the generated image.',
          enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
        },
        inputs: {
          type: 'object',
          description:
            'Workspace resources to mount into the sandbox. Copy paths verbatim from glob/read/grep output — they are percent-encoded per segment (spaces are %20, an in-name slash is %2F; parentheses and dots stay literal). Both the encoded path and the plain name resolve, so copy the returned path exactly rather than retyping or decoding it.',
          properties: {
            directories: {
              type: 'array',
              description:
                'Workspace folders to mount recursively into the sandbox, including nested files and empty folders.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description:
                      'Canonical VFS folder path, e.g. "files/Reports". By default this mounts at "/home/user/{path}".',
                  },
                  sandboxPath: {
                    type: 'string',
                    description:
                      'Optional full sandbox directory path override. Omit to mount at /home/user/{path}.',
                  },
                },
                required: ['path'],
              },
            },
            files: {
              type: 'array',
              description: 'Workspace files to mount into the sandbox.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description:
                      'Canonical VFS file path, e.g. "files/Reports/sales.csv". By default this mounts at "/home/user/{path}".',
                  },
                  sandboxPath: {
                    type: 'string',
                    description:
                      'Full sandbox path to mount at, e.g. /home/user/inputs/data.csv. STRONGLY RECOMMENDED whenever the file name has spaces or special characters: the default mount path is the percent-ENCODED canonical path (e.g. /home/user/files/Q4%20Sales%20(Final).csv), which code using the human-readable name will not find. Set a simple sandboxPath and read exactly that.',
                  },
                },
                required: ['path'],
              },
            },
            tables: {
              type: 'array',
              description: 'Workspace tables to mount as CSV files.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'Canonical VFS table path when available.',
                  },
                  sandboxPath: {
                    type: 'string',
                    description: 'Optional full sandbox path for the mounted CSV.',
                  },
                  tableId: {
                    type: 'string',
                    description: 'Workspace table ID.',
                  },
                },
              },
            },
          },
        },
        outputs: {
          type: 'object',
          description:
            'Workspace files to create or overwrite from returned code results or sandbox-created files.',
          properties: {
            files: {
              type: 'array',
              description:
                'File outputs. Missing parent folders are created automatically for create mode.',
              items: {
                type: 'object',
                properties: {
                  format: {
                    type: 'string',
                    description: 'Optional serialization format for returned values.',
                    enum: ['json', 'csv', 'txt', 'md', 'html'],
                  },
                  mimeType: {
                    type: 'string',
                    description: 'Optional MIME type override when inference is not enough.',
                  },
                  mode: {
                    type: 'string',
                    description: 'Create a new file or overwrite an existing file at path.',
                    enum: ['create', 'overwrite'],
                  },
                  path: {
                    type: 'string',
                    description: 'Canonical destination VFS path, e.g. "files/Reports/chart.png".',
                  },
                  sandboxPath: {
                    type: 'string',
                    description:
                      'Optional full path to a file created inside the sandbox. Omit to save the code return value.',
                  },
                },
                required: ['path', 'mode'],
              },
            },
          },
        },
        prompt: {
          type: 'string',
          description:
            'Detailed text description of the image to generate, or editing instructions when editing the image(s) passed in `inputs.files`.',
        },
      },
      required: ['prompt'],
    },
    resultSchema: undefined,
  },
  generate_video: {
    parameters: {
      type: 'object',
      properties: {
        aspectRatio: {
          type: 'string',
          description: 'Aspect ratio for the video (model-dependent).',
          enum: ['16:9', '9:16', '1:1'],
        },
        duration: {
          type: 'number',
          description: 'Clip duration in seconds (model-dependent; e.g. 4, 6, 8).',
        },
        generateAudio: {
          type: 'boolean',
          description:
            "Toggle Veo's native audio (dialogue/SFX/ambience/music generated from the prompt). Default true. Set false when you will add your own voiceover/music via the ffmpeg tool.",
        },
        inputs: {
          type: 'object',
          description:
            'Workspace resources to mount into the sandbox. Copy paths verbatim from glob/read/grep output — they are percent-encoded per segment (spaces are %20, an in-name slash is %2F; parentheses and dots stay literal). Both the encoded path and the plain name resolve, so copy the returned path exactly rather than retyping or decoding it.',
          properties: {
            directories: {
              type: 'array',
              description:
                'Workspace folders to mount recursively into the sandbox, including nested files and empty folders.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description:
                      'Canonical VFS folder path, e.g. "files/Reports". By default this mounts at "/home/user/{path}".',
                  },
                  sandboxPath: {
                    type: 'string',
                    description:
                      'Optional full sandbox directory path override. Omit to mount at /home/user/{path}.',
                  },
                },
                required: ['path'],
              },
            },
            files: {
              type: 'array',
              description: 'Workspace files to mount into the sandbox.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description:
                      'Canonical VFS file path, e.g. "files/Reports/sales.csv". By default this mounts at "/home/user/{path}".',
                  },
                  sandboxPath: {
                    type: 'string',
                    description:
                      'Full sandbox path to mount at, e.g. /home/user/inputs/data.csv. STRONGLY RECOMMENDED whenever the file name has spaces or special characters: the default mount path is the percent-ENCODED canonical path (e.g. /home/user/files/Q4%20Sales%20(Final).csv), which code using the human-readable name will not find. Set a simple sandboxPath and read exactly that.',
                  },
                },
                required: ['path'],
              },
            },
            tables: {
              type: 'array',
              description: 'Workspace tables to mount as CSV files.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'Canonical VFS table path when available.',
                  },
                  sandboxPath: {
                    type: 'string',
                    description: 'Optional full sandbox path for the mounted CSV.',
                  },
                  tableId: {
                    type: 'string',
                    description: 'Workspace table ID.',
                  },
                },
              },
            },
          },
        },
        model: {
          type: 'string',
          description:
            "Optional model override, keyed to the video's goal: veo-3.1-lite (prototype/quick test, cheapest), veo-3.1-fast (reasonable draft — default, good video), veo-3.1 Standard (final cut / premium quality). Stay on Veo unless the user explicitly asks for another model; seedance-2.0 for >8s narrative, kling-v3-pro for specific looks.",
          enum: [
            'veo-3.1',
            'veo-3.1-fast',
            'veo-3.1-lite',
            'seedance-2.0',
            'seedance-2.0-fast',
            'kling-v3-pro',
            'minimax-hailuo-2.3-pro',
            'wan-2.2-a14b-turbo',
            'ltx-2.3',
          ],
        },
        negativePrompt: {
          type: 'string',
          description:
            'Things to exclude from the video/audio (Veo models), e.g. "no background music" to keep dialogue but drop Veo\'s invented music before overlaying your own track.',
        },
        outputs: {
          type: 'object',
          description:
            'Workspace files to create or overwrite from returned code results or sandbox-created files.',
          properties: {
            files: {
              type: 'array',
              description:
                'File outputs. Missing parent folders are created automatically for create mode.',
              items: {
                type: 'object',
                properties: {
                  format: {
                    type: 'string',
                    description: 'Optional serialization format for returned values.',
                    enum: ['json', 'csv', 'txt', 'md', 'html'],
                  },
                  mimeType: {
                    type: 'string',
                    description: 'Optional MIME type override when inference is not enough.',
                  },
                  mode: {
                    type: 'string',
                    description: 'Create a new file or overwrite an existing file at path.',
                    enum: ['create', 'overwrite'],
                  },
                  path: {
                    type: 'string',
                    description: 'Canonical destination VFS path, e.g. "files/Reports/chart.png".',
                  },
                  sandboxPath: {
                    type: 'string',
                    description:
                      'Optional full path to a file created inside the sandbox. Omit to save the code return value.',
                  },
                },
                required: ['path', 'mode'],
              },
            },
          },
        },
        prompt: {
          type: 'string',
          description:
            'Detailed description of the video to generate (scene, action, camera movement, style).',
        },
        promptOptimizer: {
          type: 'boolean',
          description: 'Enable prompt optimization for MiniMax models (default true).',
        },
        resolution: {
          type: 'string',
          description: 'Video resolution (model-dependent), e.g. 720p or 1080p.',
          enum: ['720p', '1080p', '4k'],
        },
      },
      required: ['prompt'],
    },
    resultSchema: undefined,
  },
  get_block_outputs: {
    parameters: {
      type: 'object',
      properties: {
        blockIds: {
          type: 'array',
          description:
            'Optional array of block UUIDs. If provided, returns outputs only for those blocks. If not provided, returns outputs for all blocks in the workflow.',
          items: {
            type: 'string',
          },
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID. If not provided, uses the current workflow in context.',
        },
      },
    },
    resultSchema: undefined,
  },
  get_block_upstream_references: {
    parameters: {
      type: 'object',
      properties: {
        blockIds: {
          type: 'array',
          description:
            'Required array of block UUIDs (minimum 1). Returns what each block can reference based on its position in the workflow graph.',
          items: {
            type: 'string',
          },
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID. If not provided, uses the current workflow in context.',
        },
      },
      required: ['blockIds'],
    },
    resultSchema: undefined,
  },
  get_deployed_workflow_state: {
    parameters: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID. If not provided, uses the current workflow in context.',
        },
      },
    },
    resultSchema: undefined,
  },
  get_deployment_log: {
    parameters: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID. If not provided, uses the current workflow in context.',
        },
      },
    },
    resultSchema: undefined,
  },
  get_page_contents: {
    parameters: {
      type: 'object',
      properties: {
        include_highlights: {
          type: 'boolean',
          description: 'Include key highlights (default false)',
        },
        include_summary: {
          type: 'boolean',
          description: 'Include AI-generated summary (default false)',
        },
        include_text: {
          type: 'boolean',
          description: 'Include full page text (default true)',
        },
        urls: {
          type: 'array',
          description: 'URLs to get content from (max 10)',
          items: {
            type: 'string',
          },
        },
      },
      required: ['urls'],
    },
    resultSchema: undefined,
  },
  get_platform_actions: {
    parameters: {
      type: 'object',
      properties: {},
    },
    resultSchema: undefined,
  },
  get_scheduled_task_logs: {
    parameters: {
      type: 'object',
      properties: {
        executionId: {
          type: 'string',
          description: 'Optional execution ID for a specific run.',
        },
        includeDetails: {
          type: 'boolean',
          description: 'Include tool calls, outputs, and cost details.',
        },
        jobId: {
          type: 'string',
          description: 'The scheduled task (schedule) ID to get logs for.',
        },
        limit: {
          type: 'number',
          description: 'Max number of entries (default: 3, max: 5)',
        },
      },
      required: ['jobId'],
    },
    resultSchema: undefined,
  },
  get_workflow_data: {
    parameters: {
      type: 'object',
      properties: {
        data_type: {
          type: 'string',
          description: 'The type of workflow data to retrieve',
          enum: ['global_variables', 'custom_tools', 'mcp_tools', 'files'],
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID. If not provided, uses the current workflow in context.',
        },
      },
      required: ['data_type'],
    },
    resultSchema: undefined,
  },
  get_workflow_run_options: {
    parameters: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID. If not provided, uses the current workflow in context.',
        },
      },
    },
    resultSchema: undefined,
  },
  glob: {
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description:
            'Glob pattern to match file paths. Supports * (any segment) and ** (any depth).',
        },
        toolTitle: {
          type: 'string',
          description:
            'Optional target-only UI phrase for the search row. The UI verb is supplied for you, so pass text like "workflow configs" or "knowledge bases", not a full sentence like "Finding workflow configs".',
        },
      },
      required: ['pattern', 'toolTitle'],
    },
    resultSchema: undefined,
  },
  grep: {
    parameters: {
      type: 'object',
      properties: {
        context: {
          type: 'number',
          description:
            "Number of lines to show before and after each match. Only applies to output_mode 'content'.",
        },
        ignoreCase: {
          type: 'boolean',
          description: 'Case insensitive search (default false).',
        },
        lineNumbers: {
          type: 'boolean',
          description:
            "Include line numbers in output (default true). Only applies to output_mode 'content'.",
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of matches to return (default 50).',
        },
        output_mode: {
          type: 'string',
          description:
            "Output mode: 'content' shows matching lines (default), 'files_with_matches' shows only file paths, 'count' shows match counts per file.",
          enum: ['content', 'files_with_matches', 'count'],
        },
        path: {
          type: 'string',
          description:
            "Optional scope. A prefix (e.g. 'workflows/', 'environment/', 'internal/') searches the VFS map under it. An exact single-file path under files/ or uploads/ (optionally with /content) searches that file's content only; folders and multi-file trees are rejected for content search.",
        },
        pattern: {
          type: 'string',
          description:
            "Regex pattern to search for. Searches VFS map entries (workflow JSON, metadata, plans, memories) by default; searches a single file's extracted text when path is one files/ or uploads/ file leaf.",
        },
        toolTitle: {
          type: 'string',
          description:
            'Optional target-only UI phrase for the search row. The UI verb is supplied for you, so pass text like "Slack integrations" or "deployed workflows", not a full sentence like "Searching for Slack integrations".',
        },
      },
      required: ['pattern', 'toolTitle'],
    },
    resultSchema: undefined,
  },
  knowledge: {
    parameters: {
      properties: {
        request: {
          description: 'What knowledge base action is needed.',
          type: 'string',
        },
      },
      required: ['request'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  knowledge_base: {
    parameters: {
      type: 'object',
      properties: {
        args: {
          type: 'object',
          description: 'Arguments for the operation',
          properties: {
            apiKey: {
              type: 'string',
              description:
                'API key for API-key-based connectors (required when connector auth mode is apiKey)',
            },
            chunkingConfig: {
              type: 'object',
              description: "Chunking configuration (optional for 'create')",
              properties: {
                maxSize: {
                  type: 'number',
                  description: 'Maximum chunk size (100-4000, default: 1024)',
                  default: 1024,
                },
                minSize: {
                  type: 'number',
                  description: 'Minimum chunk size (1-2000, default: 1)',
                  default: 1,
                },
                overlap: {
                  type: 'number',
                  description: 'Overlap between chunks (0-500, default: 200)',
                  default: 200,
                },
              },
            },
            connectorId: {
              type: 'string',
              description:
                'Connector ID (required for update_connector, delete_connector, sync_connector)',
            },
            connectorStatus: {
              type: 'string',
              description: 'Connector status (optional for update_connector)',
              enum: ['active', 'paused'],
            },
            connectorType: {
              type: 'string',
              description:
                "Connector type from registry, e.g. 'confluence', 'google_drive', 'notion' (required for add_connector). Read knowledgebases/connectors/{type}.json for the config schema.",
            },
            credentialId: {
              type: 'string',
              description:
                'OAuth credential ID from environment/credentials.json (required for OAuth connectors)',
            },
            description: {
              type: 'string',
              description: "Description of the knowledge base (optional for 'create')",
            },
            disabledTagIds: {
              type: 'array',
              description:
                'Tag definition IDs to opt out of (optional for add_connector). See tagDefinitions in the connector schema.',
            },
            documentId: {
              type: 'string',
              description: 'Document ID (required for update_document)',
            },
            documentIds: {
              type: 'array',
              description: 'Document IDs (for batch delete_document)',
              items: {
                type: 'string',
              },
            },
            documentTags: {
              type: 'array',
              description:
                'Tag values to persist on a document (optional for update_document). Use tag display names from list_tags.',
              items: {
                type: 'object',
                properties: {
                  tagName: {
                    type: 'string',
                    description: 'Tag display name as returned by list_tags',
                  },
                  tagValue: {
                    type: ['string', 'number', 'boolean'],
                    description: 'Typed tag value',
                  },
                },
                required: ['tagName', 'tagValue'],
              },
            },
            enabled: {
              type: 'boolean',
              description: 'Enable/disable a document (optional for update_document)',
            },
            filePaths: {
              type: 'array',
              description:
                'Canonical workspace file VFS paths to add as documents (for add_file), e.g. ["files/Docs/handbook.pdf"].',
              items: {
                type: 'string',
              },
            },
            filename: {
              type: 'string',
              description: 'New filename for a document (optional for update_document)',
            },
            knowledgeBaseId: {
              type: 'string',
              description:
                'Knowledge base ID (required for get, query, add_file, list_tags, create_tag, get_tag_usage)',
            },
            knowledgeBaseIds: {
              type: 'array',
              description: 'Knowledge base IDs (for batch delete)',
              items: {
                type: 'string',
              },
            },
            name: {
              type: 'string',
              description: "Name of the knowledge base (required for 'create')",
            },
            query: {
              type: 'string',
              description: "Search query text (required for 'query')",
            },
            sourceConfig: {
              type: 'object',
              description:
                'Connector-specific configuration matching the configFields in knowledgebases/connectors/{type}.json',
            },
            syncIntervalMinutes: {
              type: 'number',
              description:
                'Sync interval in minutes. Accepted values: 60 (hourly), 360 (6h), 1440 (daily), 10080 (weekly), 0 (manual only). Default: 1440',
              default: 1440,
            },
            tagDefinitionId: {
              type: 'string',
              description: 'Tag definition ID (required for update_tag, delete_tag)',
            },
            tagDisplayName: {
              type: 'string',
              description:
                'Display name for the tag (required for create_tag, optional for update_tag)',
            },
            tagFieldType: {
              type: 'string',
              description:
                'Field type: text, number, date, boolean (optional for create_tag, defaults to text)',
              enum: ['text', 'number', 'date', 'boolean'],
            },
            tagFilters: {
              type: 'array',
              description:
                'Tag filters applied to the query. Use tag display names from list_tags.',
              items: {
                type: 'object',
                properties: {
                  operator: {
                    type: 'string',
                    description: 'Comparison operator (defaults to eq)',
                    enum: [
                      'eq',
                      'neq',
                      'contains',
                      'not_contains',
                      'starts_with',
                      'ends_with',
                      'gt',
                      'gte',
                      'lt',
                      'lte',
                      'between',
                    ],
                  },
                  tagName: {
                    type: 'string',
                    description: 'Tag display name as returned by list_tags',
                  },
                  tagValue: {
                    type: ['string', 'number', 'boolean'],
                    description: 'Typed tag value',
                  },
                  valueTo: {
                    type: ['string', 'number'],
                    description: 'Upper bound required by the between operator',
                  },
                },
                required: ['tagName', 'tagValue'],
              },
            },
            topK: {
              type: 'number',
              description: 'Number of results to return (1-50, default: 5)',
              default: 5,
            },
            workspaceId: {
              type: 'string',
              description:
                "Workspace ID. Required for 'create' when there is no workspace in context; otherwise the current workspace context is used.",
            },
          },
        },
        operation: {
          type: 'string',
          description: 'The operation to perform',
          enum: [
            'create',
            'get',
            'query',
            'add_file',
            'update',
            'delete',
            'delete_document',
            'update_document',
            'list_tags',
            'create_tag',
            'update_tag',
            'delete_tag',
            'get_tag_usage',
            'add_connector',
            'update_connector',
            'delete_connector',
            'sync_connector',
          ],
        },
      },
      required: ['operation'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: 'Operation-specific result payload.',
        },
        message: {
          type: 'string',
          description: 'Human-readable outcome summary.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the operation succeeded.',
        },
      },
      required: ['success', 'message'],
    },
  },
  list_integration_tools: {
    parameters: {
      properties: {
        integration: {
          description:
            'The integration service name — the folder under components/integrations/ (e.g. "slack", "gmail", "google_sheets"). Returns every operation\'s id, name, and description for that service.',
          type: 'string',
        },
      },
      required: ['integration'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  list_user_workspaces: {
    parameters: {
      type: 'object',
      properties: {},
    },
    resultSchema: undefined,
  },
  list_workspace_mcp_servers: {
    parameters: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description:
            'Workspace ID. Required when no current workspace context is available, such as headless MCP calls.',
        },
      },
    },
    resultSchema: undefined,
  },
  load_deployment: {
    parameters: {
      type: 'object',
      properties: {
        version: {
          type: 'string',
          description:
            'A string: a deployment version number (e.g. "5"), or "live" for the active deployment. (Unlike promote_to_live, which takes a numeric version, "live" is accepted here.)',
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID. If not provided, uses the current workflow in context.',
        },
      },
      required: ['version'],
    },
    resultSchema: undefined,
  },
  load_integration_tool: {
    parameters: {
      properties: {
        tool_ids: {
          description:
            'Exact integration tool ids to load before calling them, e.g. ["gmail_send_v2"]. Copy the "id" field verbatim from components/integrations/{service}/{operation}.json (including any version suffix).',
          items: {
            type: 'string',
          },
          type: 'array',
        },
      },
      required: ['tool_ids'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  manage_credential: {
    parameters: {
      type: 'object',
      properties: {
        credentialId: {
          type: 'string',
          description: 'The credential ID (required for rename)',
        },
        credentialIds: {
          type: 'array',
          description: 'Array of credential IDs (for batch delete)',
          items: {
            type: 'string',
          },
        },
        displayName: {
          type: 'string',
          description: 'New display name (required for rename)',
        },
        operation: {
          type: 'string',
          description: 'The operation to perform',
          enum: ['rename', 'delete'],
        },
      },
      required: ['operation'],
    },
    resultSchema: undefined,
  },
  manage_custom_tool: {
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'The JavaScript code that executes when the tool is called (required for add). Parameters from schema are available as variables. Function body only - no signature or wrapping braces.',
        },
        operation: {
          type: 'string',
          description:
            "The operation to perform: 'add', 'edit', 'list', or 'delete'. These verbs are tool-specific — manage_scheduled_task uses create/update instead of add/edit.",
          enum: ['add', 'edit', 'delete', 'list'],
        },
        schema: {
          type: 'object',
          description: 'The tool schema in OpenAI function calling format (required for add).',
          properties: {
            function: {
              type: 'object',
              description: 'The function definition',
              properties: {
                description: {
                  type: 'string',
                  description: 'What the function does',
                },
                name: {
                  type: 'string',
                  description: 'The function name (camelCase)',
                },
                parameters: {
                  type: 'object',
                  description: 'The function parameters schema',
                  properties: {
                    properties: {
                      type: 'object',
                      description: 'Parameter definitions as key-value pairs',
                    },
                    required: {
                      type: 'array',
                      description: 'Array of required parameter names',
                      items: {
                        type: 'string',
                      },
                    },
                    type: {
                      type: 'string',
                      description: "Must be 'object'",
                    },
                  },
                  required: ['type', 'properties'],
                },
              },
              required: ['name', 'parameters'],
            },
            type: {
              type: 'string',
              description: "Must be 'function'",
            },
          },
          required: ['type', 'function'],
        },
        toolId: {
          type: 'string',
          description:
            "The ID of the custom tool. Get it from the `list` operation or the `id` field inside the tool's VFS file (agent/custom-tools/{name}.json — the filename is the display name, not the id); get_workflow_data also returns it where that tool is available. Do not guess or construct it. Required for edit and delete; omit for add and list.",
        },
        toolIds: {
          type: 'array',
          description: 'Array of custom tool IDs (for batch delete)',
          items: {
            type: 'string',
          },
        },
      },
      required: ['operation'],
    },
    resultSchema: undefined,
  },
  manage_folder: {
    parameters: {
      type: 'object',
      properties: {
        folderId: {
          type: 'string',
          description:
            'Target folder ID, used as a fallback when path is not given. Readable from a contained workflow\'s meta.json "folderId".',
        },
        operation: {
          type: 'string',
          description: 'The operation to perform.',
          enum: ['delete'],
        },
        path: {
          type: 'string',
          description:
            'Target folder\'s VFS path (e.g. "workflows/Marketing/Q3 Campaigns"), per-segment percent-encoded like every VFS path.',
        },
      },
      required: ['operation'],
    },
    resultSchema: undefined,
  },
  manage_mcp_tool: {
    parameters: {
      type: 'object',
      properties: {
        config: {
          type: 'object',
          description: 'Required for add and edit. The MCP server configuration.',
          properties: {
            enabled: {
              type: 'boolean',
              description: 'Whether the server is enabled (default: true)',
            },
            headers: {
              type: 'object',
              description: 'Optional HTTP headers to send with requests (key-value pairs)',
            },
            name: {
              type: 'string',
              description: 'Display name for the MCP server',
            },
            timeout: {
              type: 'number',
              description: 'Request timeout in milliseconds (default: 30000)',
            },
            transport: {
              type: 'string',
              description: "Transport protocol: 'streamable-http' or 'sse'",
              enum: ['streamable-http', 'sse'],
              default: 'streamable-http',
            },
            url: {
              type: 'string',
              description: 'The MCP server endpoint URL (required for add)',
            },
          },
        },
        operation: {
          type: 'string',
          description:
            "The operation to perform: 'add', 'edit', 'list', or 'delete'. These verbs are tool-specific — manage_scheduled_task uses create/update instead of add/edit.",
          enum: ['add', 'edit', 'delete', 'list'],
        },
        serverId: {
          type: 'string',
          description:
            "The MCP server's id — the `id` field inside the VFS file agent/mcp-servers/{name}.json (the {name} filename is the display name, not the id). Required for edit and delete; omit for add and list.",
        },
      },
      required: ['operation'],
    },
    resultSchema: undefined,
  },
  manage_scheduled_task: {
    parameters: {
      type: 'object',
      properties: {
        args: {
          type: 'object',
          description:
            'Operation-specific arguments. For create: {title, prompt, cron?, time?, timezone?, lifecycle?, successCondition?, maxRuns?}. For get/delete: {jobId}. For update: {jobId, title?, prompt?, cron?, timezone?, status?, lifecycle?, successCondition?, maxRuns?}. For list: no args needed.',
          properties: {
            cron: {
              type: 'string',
              description:
                "Cron expression for a recurring scheduled task (e.g. '0 9 * * *'). Set exactly one of cron or time: recurring -> cron; one-time -> time.",
            },
            jobId: {
              type: 'string',
              description: 'Scheduled task ID (required for get, update)',
            },
            jobIds: {
              type: 'array',
              description: 'Array of scheduled task IDs (for batch delete)',
              items: {
                type: 'string',
              },
            },
            lifecycle: {
              type: 'string',
              description:
                "'persistent' (default) or 'until_complete'. Until_complete scheduled tasks stop when complete_scheduled_task is called.",
              enum: ['persistent', 'until_complete'],
            },
            maxRuns: {
              type: 'integer',
              description: 'Max executions before auto-completing. Safety limit.',
            },
            prompt: {
              type: 'string',
              description: 'The prompt to execute when the scheduled task fires',
            },
            status: {
              type: 'string',
              description: 'Scheduled task status: active, paused',
              enum: ['active', 'paused'],
            },
            successCondition: {
              type: 'string',
              description:
                'What must happen for the scheduled task to be considered complete (until_complete lifecycle).',
            },
            time: {
              type: 'string',
              description:
                "ISO 8601 datetime. One-time scheduled task -> set time and omit cron. May also anchor a recurring cron task's first-fire time.",
            },
            timezone: {
              type: 'string',
              description: 'IANA timezone (e.g. America/New_York). Defaults to UTC.',
            },
            title: {
              type: 'string',
              description: "Short descriptive title for the scheduled task (e.g. 'Email Poller')",
            },
          },
        },
        operation: {
          type: 'string',
          description:
            'The operation to perform: create, list, get, update, delete. These verbs are tool-specific — the custom-tool/MCP/skill managers use add/edit instead of create/update.',
          enum: ['create', 'list', 'get', 'update', 'delete'],
        },
      },
      required: ['operation'],
    },
    resultSchema: undefined,
  },
  manage_skill: {
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Markdown instructions for the skill. Required for add, optional for edit.',
        },
        description: {
          type: 'string',
          description: 'Short description of the skill. Required for add, optional for edit.',
        },
        name: {
          type: 'string',
          description:
            "Skill name in kebab-case (e.g. 'my-skill'). Required for add, optional for edit.",
        },
        operation: {
          type: 'string',
          description:
            "The operation to perform: 'add', 'edit', 'list', or 'delete'. These verbs are tool-specific — manage_scheduled_task uses create/update instead of add/edit.",
          enum: ['add', 'edit', 'delete', 'list'],
        },
        skillId: {
          type: 'string',
          description:
            "The skill's id — the `id` field inside the VFS file agent/skills/{name}.json (the {name} filename is the display name, not the id). Required for edit and delete; omit for add and list.",
        },
      },
      required: ['operation'],
    },
    resultSchema: undefined,
  },
  materialize_file: {
    parameters: {
      type: 'object',
      properties: {
        fileNames: {
          type: 'array',
          description:
            'The names of the uploaded files to materialize (e.g. ["report.pdf", "data.csv"])',
          items: {
            type: 'string',
          },
        },
        operation: {
          type: 'string',
          description:
            'What to do with the file. "save" promotes it to a permanent files/ path. "import" imports a workflow JSON as a workspace workflow. Defaults to "save".',
          enum: ['save', 'import'],
          default: 'save',
        },
      },
      required: ['fileNames'],
    },
    resultSchema: undefined,
  },
  media: {
    parameters: {
      properties: {
        prompt: {
          description:
            "Optional brief instruction (one short sentence) to scope the task. The agent inherits the full conversation history — do NOT restate or rewrite conversation content, only add scoping the history doesn't convey.",
          type: 'string',
        },
      },
      type: 'object',
    },
    resultSchema: undefined,
  },
  mkdir: {
    parameters: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          description:
            'Canonical folder VFS paths to create, e.g. ["files/Reports/2026"]. Missing parent segments are created automatically.',
          items: {
            type: 'string',
          },
        },
        toolTitle: {
          type: 'string',
          description:
            'Target-only UI phrase for the action row, e.g. "Reports/2026" or "2 folders", not a full sentence like "Creating Reports".',
        },
      },
      required: ['paths', 'toolTitle'],
    },
    resultSchema: undefined,
  },
  mv: {
    parameters: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description:
            'Target path. A path ending in "/" (or naming an existing folder) moves sources into it keeping their names — always use the trailing "/" form when targeting a folder. Otherwise the last segment is the new name and the preceding segments are the target folder (created automatically when missing).',
        },
        sources: {
          type: 'array',
          description:
            'Canonical VFS paths to move or rename, e.g. ["files/draft.md"]. All sources must share one category. Copy paths verbatim from glob/grep/read output.',
          items: {
            type: 'string',
          },
        },
        toolTitle: {
          type: 'string',
          description:
            'Target-only UI phrase for the action row, e.g. "draft.md to Reports" or "3 files to Images", not a full sentence like "Moving draft.md".',
        },
      },
      required: ['sources', 'destination', 'toolTitle'],
    },
    resultSchema: undefined,
  },
  oauth_get_auth_link: {
    parameters: {
      type: 'object',
      properties: {
        credentialId: {
          type: 'string',
          description:
            'Optional. The id of an EXISTING credential (from environment/credentials.json) to reconnect/re-authorize in place. Only when the user explicitly asks to reconnect or repair that credential — never for adding another account.',
        },
        providerName: {
          type: 'string',
          description:
            "The OAuth provider to connect. Pass the integration's provider value (e.g. `google-email`, `slack`); the service display name or providerId resolves case-insensitively/fuzzily, so avoid bare base providers like `google`.",
        },
      },
      required: ['providerName'],
    },
    resultSchema: undefined,
  },
  oauth_request_access: {
    parameters: {
      type: 'object',
      properties: {
        providerName: {
          type: 'string',
          description:
            "The OAuth provider to connect. Pass the integration's provider value (e.g. `google-email`, `slack`); the service display name or providerId resolves case-insensitively/fuzzily, so avoid bare base providers like `google`.",
        },
      },
      required: ['providerName'],
    },
    resultSchema: undefined,
  },
  open_resource: {
    parameters: {
      type: 'object',
      properties: {
        resources: {
          type: 'array',
          description:
            'Array of resources to open. Each item must have type and either id or, for files, path.',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Canonical resource ID for non-file resources.',
              },
              path: {
                type: 'string',
                description:
                  'Encoded VFS path for type "file" (percent-encoded per segment, e.g. "files/Reports/Q4%20Report.pdf"). Copy it verbatim from glob/read/workspace context output — do not decode it to a display name or re-encode it.',
              },
              type: {
                type: 'string',
                description: 'The resource type.',
                enum: ['workflow', 'table', 'knowledgebase', 'file', 'log', 'scheduledtask'],
              },
            },
            required: ['type'],
          },
        },
      },
      required: ['resources'],
    },
    resultSchema: undefined,
  },
  promote_to_live: {
    parameters: {
      type: 'object',
      properties: {
        version: {
          type: 'number',
          description:
            'The numeric deployment version number to promote to live (e.g. 5). "live" is not accepted here — pass the version number (use load_deployment to change the draft).',
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID. If not provided, uses the current workflow in context.',
        },
      },
      required: ['version'],
    },
    resultSchema: undefined,
  },
  query_logs: {
    parameters: {
      type: 'object',
      properties: {
        blockId: {
          type: 'string',
          description: "Optional (view='full'): only return this block's span subtree.",
        },
        blockName: {
          type: 'string',
          description: "Optional (view='full'): only return spans for this block name.",
        },
        costOperator: {
          type: 'string',
          description: "Filter (view='list'): comparison operator for cost.",
          enum: ['=', '>', '<', '>=', '<=', '!='],
        },
        costValue: {
          type: 'number',
          description: "Filter (view='list'): cost threshold paired with costOperator.",
        },
        cursor: {
          type: 'string',
          description: "Pagination cursor (view='list') from a prior response's nextCursor.",
        },
        durationOperator: {
          type: 'string',
          description: "Filter (view='list'): comparison operator for duration (ms).",
          enum: ['=', '>', '<', '>=', '<=', '!='],
        },
        durationValue: {
          type: 'number',
          description:
            "Filter (view='list'): duration threshold (ms) paired with durationOperator.",
        },
        endDate: {
          type: 'string',
          description: "Filter (view='list'): ISO end of the time range.",
        },
        executionId: {
          type: 'string',
          description:
            "Required for 'overview'/'full': the execution to read. For 'list', an optional exact-match filter.",
        },
        folderIds: {
          type: 'string',
          description: "Filter (view='list'): comma-separated folder IDs (descendants included).",
        },
        folderName: {
          type: 'string',
          description: "Filter (view='list'): substring match on folder name.",
        },
        level: {
          type: 'string',
          description:
            "Filter (view='list'): comma-separated levels: error, info, running, pending. Default all.",
        },
        limit: {
          type: 'number',
          description: "Max results (view='list'), 1-200 (default 100).",
        },
        pattern: {
          type: 'string',
          description:
            "Optional separate parameter (not a 'view' value): with view 'overview' or 'full', greps the execution's trace spans (requires executionId), returning matching spans with snippets instead of the full log.",
        },
        search: {
          type: 'string',
          description: "Filter (view='list'): substring match on executionId.",
        },
        sortBy: {
          type: 'string',
          description: "Sort field (view='list').",
          enum: ['date', 'duration', 'cost', 'status'],
        },
        sortOrder: {
          type: 'string',
          description: "Sort order (view='list').",
          enum: ['asc', 'desc'],
        },
        startDate: {
          type: 'string',
          description: "Filter (view='list'): ISO start of the time range.",
        },
        triggers: {
          type: 'string',
          description: "Filter (view='list'): comma-separated trigger types.",
        },
        view: {
          type: 'string',
          description:
            "Disclosure level: 'list' (summaries), 'overview' (one execution's trace tree, no I/O), or 'full' (one execution's trace spans with I/O).",
          enum: ['list', 'overview', 'full'],
        },
        workflowIds: {
          type: 'string',
          description: "Filter (view='list'): comma-separated workflow IDs.",
        },
        workflowName: {
          type: 'string',
          description: "Filter (view='list'): substring match on workflow name.",
        },
        workspaceId: {
          type: 'string',
          description: 'Workspace ID to scope to.',
        },
      },
      required: ['view'],
    },
    resultSchema: undefined,
  },
  query_user_table: {
    parameters: {
      type: 'object',
      properties: {
        args: {
          type: 'object',
          description: 'Arguments for the operation',
          properties: {
            filter: {
              type: 'object',
              description: 'MongoDB-style filter for query_rows',
            },
            limit: {
              type: 'number',
              description: 'Maximum rows to return (optional, default 100, max 1000 per call)',
            },
            offset: {
              type: 'number',
              description: 'Number of rows to skip (optional for query_rows, default 0)',
            },
            rowId: {
              type: 'string',
              description: 'Row ID (required for get_row)',
            },
            sort: {
              type: 'object',
              description:
                "Sort specification as { field: 'asc' | 'desc' } (optional for query_rows)",
            },
            tableId: {
              type: 'string',
              description: 'Table ID (required for all operations)',
            },
          },
        },
        operation: {
          type: 'string',
          description: 'The read operation to perform',
          enum: ['get', 'get_schema', 'get_row', 'query_rows'],
        },
      },
      required: ['operation', 'args'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: 'Operation-specific result payload.',
        },
        message: {
          type: 'string',
          description: 'Human-readable outcome summary.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the operation succeeded.',
        },
      },
      required: ['success', 'message'],
    },
  },
  read: {
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of lines to read.',
        },
        offset: {
          type: 'number',
          description: 'Line offset to start reading from (0-indexed).',
        },
        outputTable: {
          type: 'string',
          description:
            'Table ID to import the file contents into (CSV/JSON). All existing rows are replaced. Example: "tbl_abc123"',
        },
        path: {
          type: 'string',
          description:
            "Path to the VFS resource to read (e.g. 'workflows/My%20Workflow/state.json', 'files/Q4%20Report.pdf/content' for file bytes/parsed text, or 'uploads/data.csv' for a chat upload). Copy paths verbatim from glob/grep/read output.",
        },
      },
      required: ['path'],
    },
    resultSchema: undefined,
  },
  redeploy: {
    parameters: {
      type: 'object',
      properties: {
        versionDescription: {
          type: 'string',
          description:
            'REQUIRED: a concise (1-3 sentence) description of what changed in this deployment version. If unsure what changed, call diff_workflows(ref1: "live", ref2: "draft") first.',
        },
        versionName: {
          type: 'string',
          description:
            'REQUIRED: a short human-readable name/label for this deployment version, shown in deployment history.',
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID to redeploy (required in workspace context)',
        },
      },
      required: ['versionDescription', 'versionName'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        apiEndpoint: {
          type: 'string',
          description: 'Canonical workflow execution endpoint.',
        },
        baseUrl: {
          type: 'string',
          description: 'Base URL used to construct deployment URLs.',
        },
        deployedAt: {
          type: 'string',
          description: 'Deployment timestamp when the workflow is deployed.',
        },
        deploymentConfig: {
          type: 'object',
          description:
            'Structured deployment configuration keyed by surface name. For API deploys this includes endpoint, auth, and sync/stream/async mode details.',
        },
        deploymentStatus: {
          type: 'object',
          description:
            'Structured per-surface deployment status keyed by surface name, such as api.',
        },
        deploymentType: {
          type: 'string',
          description:
            'Deployment surface this result describes. For deploy_api and redeploy this is always "api".',
        },
        examples: {
          type: 'object',
          description:
            'Invocation examples keyed by surface name. For API deploys this includes curl examples for sync, stream, async, and polling.',
        },
        isDeployed: {
          type: 'boolean',
          description: 'Whether the workflow API is currently deployed after this tool call.',
        },
        version: {
          type: 'number',
          description: 'Deployment version for the current API deployment.',
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID that was deployed or undeployed.',
        },
      },
      required: [
        'workflowId',
        'isDeployed',
        'deploymentType',
        'deploymentStatus',
        'deploymentConfig',
        'examples',
      ],
    },
  },
  respond: {
    parameters: {
      additionalProperties: true,
      properties: {
        output: {
          description:
            'The result — facts, status, VFS paths to persisted data, whatever the caller needs to act on.',
          type: 'string',
        },
        paths: {
          description:
            'Affected VFS file paths. Required when the File Agent reports a successful file mutation.',
          items: {
            type: 'string',
          },
          type: 'array',
        },
        success: {
          description: 'Whether the task completed successfully',
          type: 'boolean',
        },
        type: {
          description: 'Optional logical result type override',
          type: 'string',
        },
      },
      required: ['output', 'success'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  restore_resource: {
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The canonical resource ID to restore.',
        },
        type: {
          type: 'string',
          description: 'The resource type to restore.',
          enum: ['workflow', 'table', 'file', 'knowledgebase', 'folder', 'file_folder'],
        },
      },
      required: ['type', 'id'],
    },
    resultSchema: undefined,
  },
  run: {
    parameters: {
      properties: {
        context: {
          description: 'Pre-gathered context: workflow state, block IDs, input requirements.',
          type: 'string',
        },
        request: {
          description: 'What to run or what logs to check.',
          type: 'string',
        },
      },
      required: ['request'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  run_block: {
    parameters: {
      type: 'object',
      properties: {
        blockId: {
          type: 'string',
          description: 'The block ID to run in isolation.',
        },
        executionId: {
          type: 'string',
          description:
            'Optional execution ID to load the snapshot from. Uses latest execution if omitted.',
        },
        useDeployedState: {
          type: 'boolean',
          description:
            'When true, runs the deployed version instead of the live draft. Default: false (draft).',
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID to run. If not provided, uses the current workflow in context.',
        },
        workflow_input: {
          type: 'object',
          description: 'JSON object with key-value mappings where each key is an input field name',
        },
      },
      required: ['blockId'],
    },
    resultSchema: undefined,
  },
  run_code: {
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'Code to execute. For JS: raw statements auto-wrapped in async context. For Python: full script. For shell: bash script with access to pre-installed CLI tools and workspace env vars as $VAR_NAME.',
        },
        inputs: {
          type: 'object',
          description:
            'Workspace resources to mount into the sandbox. Copy paths verbatim from glob/read/grep output — they are percent-encoded per segment (spaces are %20, an in-name slash is %2F; parentheses and dots stay literal). Both the encoded path and the plain name resolve, so copy the returned path exactly rather than retyping or decoding it.',
          properties: {
            directories: {
              type: 'array',
              description:
                'Workspace folders to mount recursively into the sandbox, including nested files and empty folders.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description:
                      'Canonical VFS folder path, e.g. "files/Reports". By default this mounts at "/home/user/{path}".',
                  },
                  sandboxPath: {
                    type: 'string',
                    description:
                      'Optional full sandbox directory path override. Omit to mount at /home/user/{path}.',
                  },
                },
                required: ['path'],
              },
            },
            files: {
              type: 'array',
              description: 'Workspace files to mount into the sandbox.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description:
                      'Canonical VFS file path, e.g. "files/Reports/sales.csv". By default this mounts at "/home/user/{path}".',
                  },
                  sandboxPath: {
                    type: 'string',
                    description:
                      'Full sandbox path to mount at, e.g. /home/user/inputs/data.csv. STRONGLY RECOMMENDED whenever the file name has spaces or special characters: the default mount path is the percent-ENCODED canonical path (e.g. /home/user/files/Q4%20Sales%20(Final).csv), which code using the human-readable name will not find. Set a simple sandboxPath and read exactly that.',
                  },
                },
                required: ['path'],
              },
            },
            tables: {
              type: 'array',
              description: 'Workspace tables to mount as CSV files.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'Canonical VFS table path when available.',
                  },
                  sandboxPath: {
                    type: 'string',
                    description: 'Optional full sandbox path for the mounted CSV.',
                  },
                  tableId: {
                    type: 'string',
                    description: 'Workspace table ID.',
                  },
                },
              },
            },
          },
        },
        language: {
          type: 'string',
          description: 'Execution language.',
          enum: ['javascript', 'python', 'shell'],
        },
        title: {
          type: 'string',
          description:
            'Short user-visible label for this execution, e.g. "Sum June invoices" or "Verify email formats".',
        },
      },
      required: ['code'],
    },
    resultSchema: undefined,
  },
  run_from_block: {
    parameters: {
      type: 'object',
      properties: {
        executionId: {
          type: 'string',
          description:
            'Optional execution ID to load the snapshot from. Uses latest execution if omitted.',
        },
        startBlockId: {
          type: 'string',
          description: 'The block ID to start execution from.',
        },
        useDeployedState: {
          type: 'boolean',
          description:
            'When true, runs the deployed version instead of the live draft. Default: false (draft).',
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID to run. If not provided, uses the current workflow in context.',
        },
        workflow_input: {
          type: 'object',
          description: 'JSON object with key-value mappings where each key is an input field name',
        },
      },
      required: ['startBlockId'],
    },
    resultSchema: undefined,
  },
  run_workflow: {
    parameters: {
      type: 'object',
      properties: {
        inputFromExecutionId: {
          type: 'string',
          description:
            'Reuse the recorded input from a past execution of this workflow (from query_logs) instead of supplying workflow_input — handy for replaying a run without retyping inputs. The reused input is re-validated against the trigger. Mutually exclusive with workflow_input and useMockPayload.',
        },
        triggerBlockId: {
          type: 'string',
          description:
            'Trigger block ID to run from (from get_workflow_run_options). Required when the workflow has multiple entrypoints.',
        },
        useDeployedState: {
          type: 'boolean',
          description:
            'When true, runs the deployed version instead of the live draft. Default: false (draft).',
        },
        useMockPayload: {
          type: 'boolean',
          description:
            "When true, run with the trigger's generated mock payload instead of workflow_input. Prefer building your own workflow_input; use this only when you can't.",
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID to run. If not provided, uses the current workflow in context.',
        },
        workflow_input: {
          type: 'object',
          description:
            "JSON object matching the target trigger's inputSchema (from get_workflow_run_options). For external/webhook triggers this is the event payload; for API/Input triggers it is the form fields.",
        },
      },
    },
    resultSchema: undefined,
  },
  run_workflow_until_block: {
    parameters: {
      type: 'object',
      properties: {
        inputFromExecutionId: {
          type: 'string',
          description:
            'Reuse the recorded input from a past execution of this workflow (from query_logs) instead of supplying workflow_input. The reused input is re-validated against the trigger. Mutually exclusive with workflow_input and useMockPayload.',
        },
        stopAfterBlockId: {
          type: 'string',
          description: 'The block ID to stop after. Execution halts once this block completes.',
        },
        triggerBlockId: {
          type: 'string',
          description:
            'Trigger block ID to run from (from get_workflow_run_options). Required when the workflow has multiple entrypoints.',
        },
        useDeployedState: {
          type: 'boolean',
          description:
            'When true, runs the deployed version instead of the live draft. Default: false (draft).',
        },
        useMockPayload: {
          type: 'boolean',
          description:
            "When true, run with the trigger's generated mock payload instead of workflow_input. Prefer building your own workflow_input; use this only when you can't.",
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID to run. If not provided, uses the current workflow in context.',
        },
        workflow_input: {
          type: 'object',
          description:
            "JSON object matching the target trigger's inputSchema (from get_workflow_run_options). For external/webhook triggers this is the event payload; for API/Input triggers it is the form fields.",
        },
      },
      required: ['stopAfterBlockId'],
    },
    resultSchema: undefined,
  },
  scheduled_task: {
    parameters: {
      properties: {
        request: {
          description: 'What scheduled task action is needed.',
          type: 'string',
        },
      },
      required: ['request'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  scrape_page: {
    parameters: {
      type: 'object',
      properties: {
        include_links: {
          type: 'boolean',
          description: 'Extract all links from the page (default false)',
        },
        url: {
          type: 'string',
          description: 'The URL to scrape (must include https://)',
        },
        wait_for: {
          type: 'string',
          description: 'CSS selector to wait for before scraping (for JS-heavy pages)',
        },
      },
      required: ['url'],
    },
    resultSchema: undefined,
  },
  search: {
    parameters: {
      properties: {
        task: {
          description:
            "One short scoping sentence — the search agent has full conversation context. Example: 'find current Stripe metered-billing API limits' or 'count how many rows in the leads table have invalid emails'.",
          type: 'string',
        },
      },
      required: ['task'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  search_documentation: {
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query',
        },
        topK: {
          type: 'number',
          description: 'Number of results (max 10)',
        },
      },
      required: ['query'],
    },
    resultSchema: undefined,
  },
  search_integration_tools: {
    parameters: {
      properties: {
        limit: {
          description: 'Maximum matches to return. Defaults to 5.',
          maximum: 10,
          minimum: 1,
          type: 'integer',
        },
        query: {
          description: 'What the service operation must do, in plain language.',
          type: 'string',
        },
        service: {
          description:
            'Optional canonical service name, such as "gmail", "slack", or "google_sheets".',
          type: 'string',
        },
      },
      required: ['query'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  search_knowledge_base: {
    parameters: {
      type: 'object',
      properties: {
        args: {
          type: 'object',
          description: 'Arguments for the operation',
          properties: {
            knowledgeBaseId: {
              type: 'string',
              description: 'Knowledge base ID (required for all operations)',
            },
            query: {
              type: 'string',
              description: "Search query text (required for 'query')",
            },
            tagFilters: {
              type: 'array',
              description:
                'Tag filters applied to the query. Use tag display names from list_tags.',
              items: {
                type: 'object',
                properties: {
                  operator: {
                    type: 'string',
                    description: 'Comparison operator (defaults to eq)',
                    enum: [
                      'eq',
                      'neq',
                      'contains',
                      'not_contains',
                      'starts_with',
                      'ends_with',
                      'gt',
                      'gte',
                      'lt',
                      'lte',
                      'between',
                    ],
                  },
                  tagName: {
                    type: 'string',
                    description: 'Tag display name as returned by list_tags',
                  },
                  tagValue: {
                    type: ['string', 'number', 'boolean'],
                    description: 'Typed tag value',
                  },
                  valueTo: {
                    type: ['string', 'number'],
                    description: 'Upper bound required by the between operator',
                  },
                },
                required: ['tagName', 'tagValue'],
              },
            },
            topK: {
              type: 'number',
              description: 'Number of results to return (1-50, default: 5)',
              default: 5,
            },
          },
        },
        operation: {
          type: 'string',
          description: 'The read operation to perform',
          enum: ['get', 'query', 'list_tags'],
        },
      },
      required: ['operation', 'args'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: 'Operation-specific result payload.',
        },
        message: {
          type: 'string',
          description: 'Human-readable outcome summary.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the operation succeeded.',
        },
      },
      required: ['success', 'message'],
    },
  },
  search_library_docs: {
    parameters: {
      type: 'object',
      properties: {
        library_name: {
          type: 'string',
          description: "Name of the library to search for (e.g., 'nextjs', 'stripe', 'langchain')",
        },
        query: {
          type: 'string',
          description: 'The question or topic to find documentation for - be specific',
        },
        version: {
          type: 'string',
          description: "Specific version (optional, e.g., '14', 'v2')",
        },
      },
      required: ['library_name', 'query'],
    },
    resultSchema: undefined,
  },
  search_online: {
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Filter by category',
          enum: [
            'news',
            'tweet',
            'github',
            'company',
            'research paper',
            'linkedin profile',
            'pdf',
            'personal site',
          ],
        },
        include_text: {
          type: 'boolean',
          description: 'Include page text content (default true)',
        },
        num_results: {
          type: 'number',
          description: 'Number of results (default 10, max 25)',
        },
        query: {
          type: 'string',
          description: 'Natural language search query',
        },
        toolTitle: {
          type: 'string',
          description:
            "Required short UI label fragment (e.g. 'Slack integrations'), not a full sentence.",
        },
      },
      required: ['query', 'toolTitle'],
    },
    resultSchema: undefined,
  },
  search_patterns: {
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Maximum number of unique pattern examples to return (defaults to 3).',
        },
        queries: {
          type: 'array',
          description:
            'Up to 3 descriptive strings explaining the workflow pattern(s) you need. Focus on intent and desired outcomes.',
          items: {
            type: 'string',
            description: 'Example: "how to automate wealthbox meeting notes into follow-up tasks"',
          },
        },
      },
      required: ['queries'],
    },
    resultSchema: undefined,
  },
  set_block_enabled: {
    parameters: {
      type: 'object',
      properties: {
        blockId: {
          type: 'string',
          description: 'The block ID whose enabled state should be changed.',
        },
        enabled: {
          type: 'boolean',
          description: 'Set to true to enable the block, or false to disable it.',
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID to edit. If not provided, uses the current workflow in context.',
        },
      },
      required: ['blockId', 'enabled'],
    },
    resultSchema: undefined,
  },
  set_environment_variables: {
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description:
            'Whether to set workspace or personal environment variables. Defaults to workspace.',
          enum: ['personal', 'workspace'],
          default: 'workspace',
        },
        variables: {
          type: 'array',
          description: 'List of env vars to set',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Variable name',
              },
              value: {
                type: 'string',
                description: 'Variable value',
              },
            },
            required: ['name', 'value'],
          },
        },
      },
      required: ['variables'],
    },
    resultSchema: undefined,
  },
  set_global_workflow_variables: {
    parameters: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          description: 'List of operations to apply',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Variable name.',
              },
              operation: {
                type: 'string',
                enum: ['add', 'delete', 'edit'],
              },
              type: {
                type: 'string',
                description: 'Variable type. Required for add/edit; ignored for delete.',
                enum: ['plain', 'number', 'boolean', 'array', 'object'],
              },
              value: {
                type: 'string',
                description: 'Variable value. Required for add/edit; ignored for delete.',
              },
            },
            required: ['operation', 'name'],
          },
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID. If not provided, uses the current workflow in context.',
        },
      },
      required: ['operations'],
    },
    resultSchema: undefined,
  },
  share_file: {
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Whether to create/update the share link or deactivate it.',
          enum: ['share', 'unshare'],
          default: 'share',
        },
        allowedEmails: {
          type: 'array',
          description:
            'Allowed emails or "@domain" patterns for authType "email" or "sso". Ignored for other auth types.',
          items: {
            type: 'string',
          },
        },
        authType: {
          type: 'string',
          description: 'How viewers authenticate to open the link. Ignored for unshare.',
          enum: ['public', 'password', 'email', 'sso'],
          default: 'public',
        },
        password: {
          type: 'string',
          description:
            'Password for authType "password". Leave empty to keep the file\'s existing password when re-sharing an already password-protected file. Ignored for other auth types.',
        },
        path: {
          type: 'string',
          description: 'Canonical workspace file VFS path to share, e.g. "files/Reports/Q4.md".',
        },
      },
      required: ['path'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description:
            'Share state. Contains url (the {baseUrl}/f/{token} link), token, authType, hasPassword, and isActive.',
        },
        message: {
          type: 'string',
          description: 'Human-readable outcome.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the share action succeeded.',
        },
      },
      required: ['success', 'message'],
    },
  },
  table: {
    parameters: {
      properties: {
        request: {
          description: 'What table action is needed.',
          type: 'string',
        },
      },
      required: ['request'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  update_deployment_version: {
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description:
            'New description for the deployment version. Provide name and/or description.',
        },
        name: {
          type: 'string',
          description:
            'New name/label for the deployment version. Provide name and/or description.',
        },
        version: {
          type: 'number',
          description:
            'The numeric deployment version number to update (use get_deployment_log to find it).',
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID. If not provided, uses the current workflow in context.',
        },
      },
      required: ['version'],
    },
    resultSchema: undefined,
  },
  update_scheduled_task_history: {
    parameters: {
      type: 'object',
      properties: {
        jobId: {
          type: 'string',
          description: 'The scheduled task ID.',
        },
        summary: {
          type: 'string',
          description:
            "A concise summary of what was done this run (e.g., 'Sent follow-up emails to 3 leads: Alice, Bob, Carol').",
        },
      },
      required: ['jobId', 'summary'],
    },
    resultSchema: undefined,
  },
  update_workspace_mcp_server: {
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'New description for the server',
        },
        isPublic: {
          type: 'boolean',
          description: 'Whether the server is publicly accessible',
        },
        name: {
          type: 'string',
          description: 'New name for the server',
        },
        serverId: {
          type: 'string',
          description: 'Required: the MCP server ID to update',
        },
      },
      required: ['serverId'],
    },
    resultSchema: undefined,
  },
  user_table: {
    parameters: {
      type: 'object',
      properties: {
        args: {
          type: 'object',
          description: 'Arguments for the operation',
          properties: {
            autoRun: {
              type: 'boolean',
              description:
                "Optional flag for add_workflow_group, add_enrichment, and update_workflow_group. On add (workflow group or enrichment): when true, existing rows whose dependencies are already filled run immediately; default false stages the group silently — call run_column when ready to fire rows. On update: toggle a group's auto-fire behavior on an existing group — false stages it (no auto-runs on dep satisfaction; only manual run_column fires rows), true re-enables auto-fire (rows whose deps fill will be scheduled). Set true on add only if the user explicitly asked to start runs immediately.",
            },
            blockId: {
              type: 'string',
              description:
                'Source block ID inside the workflow. Used by add_workflow_group_output.',
            },
            column: {
              type: 'object',
              description: 'Column definition for add_column: { name, type, unique?, position? }',
            },
            columnName: {
              type: 'string',
              description:
                'Column name. Required for rename_column, update_column, and delete_workflow_group_output (the bound column to drop). Optional for add_workflow_group_output (auto-derived from path when omitted). Use columnNames array for batch delete_column.',
            },
            columnNames: {
              type: 'array',
              description:
                'Array of column names to delete at once (for delete_column). Preferred over columnName when deleting multiple columns.',
            },
            data: {
              type: 'object',
              description: 'Row data as key-value pairs (required for insert_row, update_row)',
            },
            dependencies: {
              type: 'object',
              description:
                "Dependencies the group requires before running a row. { columns?: string[] } lists input column names that must be filled. Workflow output columns count too — depend on the column produced by an upstream group, not the group itself. The dep graph is column-induced. A group can't depend on its own output columns. Used by add_workflow_group and update_workflow_group, and optionally by add_enrichment (omit and the handler defaults deps to the mapped input columns).",
              properties: {
                columns: {
                  type: 'array',
                  description:
                    'Input column names that must be filled before the group runs. Plain columns and upstream-group output columns are both valid here.',
                  items: {
                    type: 'string',
                  },
                },
              },
            },
            description: {
              type: 'string',
              description: "Table description (optional for 'create')",
            },
            enrichmentId: {
              type: 'string',
              description:
                "Enrichment registry ID for add_enrichment. Discover the available IDs (and each one's inputs/outputs) via list_enrichments first — don't hardcode. Examples: work-email, phone-number, company-domain, company-info.",
            },
            filePath: {
              type: 'string',
              description:
                'Canonical workspace file VFS path for create_from_file/import_file, e.g. files/{path}/{name}.',
            },
            filter: {
              type: 'object',
              description:
                'MongoDB-style filter for query_rows, update_rows_by_filter, delete_rows_by_filter',
            },
            groupId: {
              type: 'string',
              description:
                'Workflow group ID. Required for update_workflow_group, delete_workflow_group, add_workflow_group_output, delete_workflow_group_output.',
            },
            groupIds: {
              type: 'array',
              description:
                'Array of workflow group IDs. Required for run_column — non-empty list of columns to run.',
              items: {
                type: 'string',
              },
            },
            inputMappings: {
              type: 'array',
              description:
                'For add_enrichment: maps each enrichment input to an existing table column. Each item is { inputName, columnName } where inputName is the enrichment input id (from list_enrichments) and columnName is an existing column on the table. Provide a mapping for every required input. (The field is named inputName for consistency with workflow-group input mappings; for enrichments it holds the enrichment input id.)',
              items: {
                type: 'object',
                properties: {
                  columnName: {
                    type: 'string',
                    description: 'Existing table column name that supplies this input.',
                  },
                  inputName: {
                    type: 'string',
                    description: 'Enrichment input id to bind (from list_enrichments).',
                  },
                },
                required: ['inputName', 'columnName'],
              },
            },
            limit: {
              type: 'number',
              description:
                'Maximum rows to return or affect (optional, default 100). Omit on update_rows_by_filter / delete_rows_by_filter to act on every match.',
            },
            mapping: {
              type: 'object',
              description:
                'Optional explicit CSV-header → table-column mapping for import_file, as { "csvHeader": "columnName" | null }. A string maps the CSV header to that table column; null skips that CSV header (it won\'t be imported); omit a header entirely to fall back to auto-mapping by sanitized name (case-insensitive).',
              additionalProperties: {
                type: ['string', 'null'],
                description:
                  "Target column name on the table. null skips that CSV header (it won't be imported); omit it entirely to fall back to auto-mapping.",
              },
            },
            mappingUpdates: {
              type: 'array',
              description:
                "Surgical per-output remap for update_workflow_group. Each entry repoints ONE existing output column to a new (blockId, path) without touching the rest of the group. Use this when the user wants to swap which block output flows into a column (e.g. 'point the score column at the new agent block') — the bound column stays, only its source pair changes. Stale row data for remapped columns is cleared and backfilled from saved execution logs where possible (no re-run needed). Use this INSTEAD of resending the full outputs array when the change is scoped to a few columns; use outputs only when the whole group's output set is being restructured. Discover valid (blockId, path) pairs via list_workflow_outputs first.",
              items: {
                type: 'object',
                properties: {
                  blockId: {
                    type: 'string',
                    description: 'New source block ID for this column.',
                  },
                  columnName: {
                    type: 'string',
                    description:
                      'The existing output column to remap. Must already be bound to this group.',
                  },
                  path: {
                    type: 'string',
                    description: 'New dotted output path on the new block.',
                  },
                },
                required: ['columnName', 'blockId', 'path'],
              },
            },
            mode: {
              type: 'string',
              description:
                "Import mode for import_file. 'append' (default) adds rows; 'replace' truncates existing rows in a transaction before inserting the new rows.",
              enum: ['append', 'replace'],
            },
            name: {
              type: 'string',
              description:
                "Table name (required for 'create'). Also the optional display name for add_enrichment — defaults to the enrichment's registry name when omitted.",
            },
            newName: {
              type: 'string',
              description:
                'New name. Required for rename_column (new column name) and for rename (new table name).',
            },
            newType: {
              type: 'string',
              description:
                'New column type (optional for update_column). Types: string, number, boolean, date, json',
            },
            offset: {
              type: 'number',
              description: 'Number of rows to skip (optional for query_rows, default 0)',
            },
            outputColumnNames: {
              type: 'object',
              description:
                'Optional output column name overrides for add_enrichment, as { "<outputId>": "<columnName>" }. Omit to use each enrichment output\'s default name.',
              additionalProperties: {
                type: 'string',
                description: 'Target column name for this enrichment output id.',
              },
            },
            outputFormat: {
              type: 'string',
              description:
                'Explicit format override for outputPath. Usually unnecessary — the file extension determines the format automatically. Only use this to force a different format than what the extension implies.',
              enum: ['json', 'csv', 'txt', 'md', 'html'],
            },
            outputPath: {
              type: 'string',
              description:
                'Pipe query_rows results directly to a NEW workspace file. The format is auto-inferred from the file extension: .csv → CSV, .json → JSON, .md → Markdown, etc. Use a root output path like "files/export.csv" — nested output paths are not supported.',
            },
            outputs: {
              type: 'array',
              description:
                "Outputs to surface as columns. Each entry maps a workflow block output to a table column: { blockId, path, columnName?, columnType? }. blockId is the source block; path is the dotted output path; columnName auto-derives from the path when omitted; columnType defaults from the leaf type when omitted. Used by add_workflow_group for the full output set. For update_workflow_group, prefer add_workflow_group_output / delete_workflow_group_output for individual outputs and mappingUpdates for surgical remap; only pass outputs here when restructuring the whole group's output set in one shot. If unsure about valid (blockId, path) pairs, call list_workflow_outputs first — paths are validated against the live workflow and invalid picks return an error with the valid options. For Agent blocks with structured outputs, the structured fields appear as top-level paths (e.g. summary, industry); there is NO response.content path on a structured agent.",
              items: {
                type: 'object',
                properties: {
                  blockId: {
                    type: 'string',
                    description: 'Source block ID inside the workflow.',
                  },
                  columnName: {
                    type: 'string',
                    description:
                      'Optional target column name. Auto-derived from the path when omitted.',
                  },
                  columnType: {
                    type: 'string',
                    description: 'Optional column type. Defaults from the leaf type when omitted.',
                    enum: ['string', 'number', 'boolean', 'date', 'json'],
                  },
                  path: {
                    type: 'string',
                    description: 'Dotted output path on the block.',
                  },
                },
                required: ['blockId', 'path'],
              },
            },
            path: {
              type: 'string',
              description: 'Dotted output path on the block. Used by add_workflow_group_output.',
            },
            position: {
              type: 'integer',
              description:
                'Zero-based index at which to insert the row (optional, insert_row only). Rows at and below that index shift down. Omit to append at the end.',
            },
            positions: {
              type: 'array',
              description:
                'Per-row insertion indices for batch_insert_rows (optional). Must be the same length as rows and contain no duplicates. Values are final positions in the resulting table — lower-index shifts are applied automatically. Omit to append all rows at the end.',
              items: {
                type: 'integer',
              },
            },
            rowId: {
              type: 'string',
              description:
                "Row ID. Required for get_row, update_row, delete_row, and for cancel_table_runs when scope:'row'.",
            },
            rowIds: {
              type: 'array',
              description:
                'Array of row IDs. Used by batch_delete_rows (rows to delete) and run_column (optional row scope — when omitted, runs across the whole table; when provided, only these rows are candidates and the server eligibility predicate still applies).',
              items: {
                type: 'string',
              },
            },
            rows: {
              type: 'array',
              description: 'Array of row data objects (required for batch_insert_rows)',
            },
            runMode: {
              type: 'string',
              description:
                "Run mode for run_column. 'incomplete' (default) re-runs only rows that never produced output or last failed; 'all' re-runs every dep-satisfied row.",
              enum: ['incomplete', 'all'],
            },
            schema: {
              type: 'object',
              description:
                "Table schema with columns array (required for 'create'). Each column: { name, type, unique? }",
            },
            scope: {
              type: 'string',
              description:
                "Cancellation scope for cancel_table_runs. 'all' cancels in-flight runs across the whole table; 'row' cancels only the row identified by rowId.",
              enum: ['all', 'row'],
            },
            sort: {
              type: 'object',
              description:
                "Sort specification as { field: 'asc' | 'desc' } (optional for query_rows)",
            },
            tableId: {
              type: 'string',
              description:
                "Table ID (required for most operations except 'create' and batch 'delete')",
            },
            tableIds: {
              type: 'array',
              description: 'Array of table IDs (for batch delete)',
              items: {
                type: 'string',
              },
            },
            unique: {
              type: 'boolean',
              description: 'Set column unique constraint (optional for update_column)',
            },
            updates: {
              type: 'array',
              description:
                'Array of per-row updates: [{ rowId, data: { col: val } }] (for batch_update_rows)',
            },
            values: {
              type: 'object',
              description:
                'Map of rowId to value for single-column batch update: { "rowId1": val1, "rowId2": val2 } (for batch_update_rows with columnName)',
            },
            workflowId: {
              type: 'string',
              description:
                'ID of the workflow (required for add_workflow_group and list_workflow_outputs).',
            },
          },
        },
        operation: {
          type: 'string',
          description: 'The operation to perform',
          enum: [
            'create',
            'create_from_file',
            'import_file',
            'get',
            'get_schema',
            'delete',
            'rename',
            'insert_row',
            'batch_insert_rows',
            'get_row',
            'query_rows',
            'update_row',
            'delete_row',
            'update_rows_by_filter',
            'delete_rows_by_filter',
            'batch_update_rows',
            'batch_delete_rows',
            'add_column',
            'rename_column',
            'delete_column',
            'update_column',
            'add_workflow_group',
            'update_workflow_group',
            'delete_workflow_group',
            'add_workflow_group_output',
            'delete_workflow_group_output',
            'run_column',
            'cancel_table_runs',
            'list_workflow_outputs',
            'list_enrichments',
            'add_enrichment',
          ],
        },
      },
      required: ['operation', 'args'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: 'Operation-specific result payload.',
        },
        message: {
          type: 'string',
          description: 'Human-readable outcome summary.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the operation succeeded.',
        },
      },
      required: ['success', 'message'],
    },
  },
  workflow: {
    parameters: {
      properties: {
        prompt: {
          description:
            'Optional brief instruction (one short sentence) to add scoping that the conversation does not convey. Usually omit it: a new session inherits the current conversation, and a resumed session receives the parent messages it has not yet seen. Do NOT restate or rewrite conversation content.',
          type: 'string',
        },
        sessionId: {
          description:
            'Reusable session ID returned by an earlier workflow call in this chat. Supply it only on a later user message that continues the same task, and at most once per user message — never re-pass a sessionId already used this turn; the agent resumes from its saved transcript and receives unseen parent conversation messages. Omit it for a new or independent task.',
          type: 'string',
        },
        title: {
          description:
            "Required private orchestration label (3–8 words) for this session's stable objective. It is stored in the request-local, chat-scoped Subagent Registry supplied only to the main orchestrator and is not shown to or used as an instruction for the workflow agent. When resuming with sessionId, copy the registry title unchanged.",
          maxLength: 120,
          minLength: 1,
          type: 'string',
        },
      },
      required: ['title'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  workspace_file: {
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          description: 'The file operation to perform.',
          enum: ['append', 'update', 'patch'],
        },
        target: {
          type: 'object',
          description: 'Explicit file target. Use kind=path + path for existing files.',
          properties: {
            kind: {
              type: 'string',
              description: 'How the file target is identified.',
              enum: ['path'],
            },
            path: {
              type: 'string',
              description:
                'Canonical existing workspace file VFS path, e.g. "files/Reports/report.md". Required when target.kind=path.',
            },
          },
          required: ['kind'],
        },
        title: {
          type: 'string',
          description:
            'Required short UI label for this content unit, e.g. "Chapter 1", "Slide 3", or "Fix footer spacing".',
        },
        contentType: {
          type: 'string',
          description:
            'Optional MIME type override. Usually omit and let the system infer from the target file extension.',
          enum: [
            'text/markdown',
            'text/html',
            'text/plain',
            'application/json',
            'text/csv',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/pdf',
          ],
        },
        edit: {
          type: 'object',
          description:
            'Patch metadata. Use strategy=search_replace for exact text replacement, or strategy=anchored for line-based inserts/replacements/deletions. The actual replacement/insert content is provided via the paired edit_content tool call.',
          properties: {
            after_anchor: {
              type: 'string',
              description:
                'Boundary line kept after inserted replacement content. Required for mode=replace_between.',
            },
            anchor: {
              type: 'string',
              description:
                'Anchor line after which new content is inserted. Required for mode=insert_after.',
            },
            before_anchor: {
              type: 'string',
              description:
                'Boundary line kept before inserted replacement content. Required for mode=replace_between.',
            },
            end_anchor: {
              type: 'string',
              description: 'First line to keep after deletion. Required for mode=delete_between.',
            },
            mode: {
              type: 'string',
              description: 'Anchored edit mode when strategy=anchored.',
              enum: ['replace_between', 'insert_after', 'delete_between'],
            },
            occurrence: {
              type: 'number',
              description: '1-based occurrence for repeated anchor lines. Optional; defaults to 1.',
            },
            replaceAll: {
              type: 'boolean',
              description:
                'When true and strategy=search_replace, replace every match instead of requiring a unique single match.',
            },
            search: {
              type: 'string',
              description:
                'Exact text to find when strategy=search_replace. Must match exactly once unless replaceAll=true.',
            },
            start_anchor: {
              type: 'string',
              description: 'First line to delete. Required for mode=delete_between.',
            },
            strategy: {
              type: 'string',
              description: 'Patch strategy.',
              enum: ['search_replace', 'anchored'],
            },
          },
        },
      },
      required: ['operation', 'target', 'title'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description:
            'Optional operation metadata such as file id, file name, size, and content type.',
        },
        message: {
          type: 'string',
          description: 'Human-readable summary of the outcome.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the file operation succeeded.',
        },
      },
      required: ['success', 'message'],
    },
  },
}
