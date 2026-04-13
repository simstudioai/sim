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
  complete_job: {
    parameters: {
      type: 'object',
      properties: {
        jobId: {
          type: 'string',
          description: 'The ID of the job to mark as completed.',
        },
      },
      required: ['jobId'],
    },
    resultSchema: undefined,
  },
  context_write: {
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Full content to write to the file (replaces existing content)',
        },
        file_path: {
          type: 'string',
          description: "Path of the file to write (e.g. 'SESSION.md')",
        },
      },
      required: ['file_path', 'content'],
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
            'Plain workspace filename including extension, e.g. "main.py" or "report.md". Must not contain slashes.',
        },
      },
      required: ['fileName'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: 'Contains id (the fileId) and name.',
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
  create_folder: {
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Folder name.',
        },
        parentId: {
          type: 'string',
          description: 'Optional parent folder ID.',
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
  create_job: {
    parameters: {
      type: 'object',
      properties: {
        cron: {
          type: 'string',
          description:
            "Cron expression for recurring jobs (e.g., '*/5 * * * *' for every 5 minutes, '0 9 * * *' for daily at 9 AM). Omit for one-time jobs.",
        },
        lifecycle: {
          type: 'string',
          description:
            "'persistent' (default) or 'until_complete'. Until_complete jobs stop when complete_job is called after the success condition is met.",
          enum: ['persistent', 'until_complete'],
        },
        maxRuns: {
          type: 'integer',
          description:
            'Maximum number of executions before the job auto-completes. Safety limit to prevent runaway polling.',
        },
        prompt: {
          type: 'string',
          description:
            'The prompt to execute when the job fires. This is sent to the Mothership as a user message.',
        },
        successCondition: {
          type: 'string',
          description:
            "What must happen for the job to be considered complete. Used with until_complete lifecycle (e.g., 'John has replied to the partnership email').",
        },
        time: {
          type: 'string',
          description:
            "ISO 8601 datetime for one-time execution or as the start time for a cron schedule (e.g., '2026-03-06T09:00:00'). Include timezone offset or use the timezone parameter.",
        },
        timezone: {
          type: 'string',
          description:
            "IANA timezone for the schedule (e.g., 'America/New_York', 'Europe/London'). Defaults to UTC.",
        },
        title: {
          type: 'string',
          description:
            "A short, descriptive title for the job (e.g., 'Email Poller', 'Daily Report'). Used as the display name.",
        },
      },
      required: ['title', 'prompt'],
    },
    resultSchema: undefined,
  },
  create_workflow: {
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Optional workflow description.',
        },
        folderId: {
          type: 'string',
          description: 'Optional folder ID.',
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
        name: {
          type: 'string',
          description: 'Required: server name',
        },
        workspaceId: {
          type: 'string',
          description: 'Workspace ID (defaults to current workspace)',
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
        fileIds: {
          type: 'array',
          description: 'Canonical workspace file IDs of the files to delete.',
          items: {
            type: 'string',
          },
        },
      },
      required: ['fileIds'],
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
  delete_folder: {
    parameters: {
      type: 'object',
      properties: {
        folderIds: {
          type: 'array',
          description: 'The folder IDs to delete.',
          items: {
            type: 'string',
          },
        },
      },
      required: ['folderIds'],
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
            'Detailed deployment instructions. Include deployment type (api/chat) and ALL user-specified options: identifier, title, description, authType, password, allowedEmails, welcomeMessage, outputConfigs (block outputs to display).',
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
          description: 'Optional description for the chat',
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
                description: "The output path (e.g. 'response', 'response.content')",
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
  download_to_workspace_file: {
    parameters: {
      type: 'object',
      properties: {
        fileName: {
          type: 'string',
          description:
            'Optional workspace file name to save as. If omitted, the name is inferred from the response or URL.',
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
                  'Parameters for the operation. \nFor edit: {"inputs": {"temperature": 0.5}} NOT {"subBlocks": {"temperature": {"value": 0.5}}}\nFor add: {"type": "agent", "name": "My Agent", "inputs": {"model": "gpt-4o"}}\nFor delete: {} (empty object)',
              },
            },
            required: ['operation_type', 'block_id', 'params'],
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
  file: {
    parameters: {
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
        inputFiles: {
          type: 'array',
          description:
            'Canonical workspace file IDs to mount in the sandbox. Discover IDs via read("files/{name}/meta.json") or glob("files/by-id/*/meta.json"). Mounted path: /home/user/files/{fileId}/{originalName}. Example: ["wf_123"]',
          items: {
            type: 'string',
          },
        },
        inputTables: {
          type: 'array',
          description:
            'Table IDs to mount as CSV files in the sandbox. Each table appears at /home/user/tables/{tableId}.csv with a header row. Example: ["tbl_abc123"]',
          items: {
            type: 'string',
          },
        },
        language: {
          type: 'string',
          description: 'Execution language.',
          enum: ['javascript', 'python', 'shell'],
        },
        outputFormat: {
          type: 'string',
          description:
            'Format for outputPath. Determines how the code result is serialized. If omitted, inferred from outputPath file extension.',
          enum: ['json', 'csv', 'txt', 'md', 'html'],
        },
        outputMimeType: {
          type: 'string',
          description:
            'MIME type for outputSandboxPath export. Required for binary files: image/png, image/jpeg, application/pdf, etc. Omit for text files.',
        },
        outputPath: {
          type: 'string',
          description:
            'Pipe output directly to a NEW workspace file instead of returning in context. ALWAYS use this instead of a separate workspace_file write call. Use a flat path like "files/result.json" — nested paths are not supported.',
        },
        outputSandboxPath: {
          type: 'string',
          description:
            'Path to a file created inside the sandbox that should be exported to the workspace. Use together with outputPath.',
        },
        outputTable: {
          type: 'string',
          description:
            'Table ID to overwrite with the code\'s return value. Code MUST return an array of objects where keys match column names. All existing rows are replaced. Example: "tbl_abc123"',
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
  generate_image: {
    parameters: {
      type: 'object',
      properties: {
        aspectRatio: {
          type: 'string',
          description: 'Aspect ratio for the generated image.',
          enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
        },
        fileName: {
          type: 'string',
          description:
            'Output file name. Defaults to "generated-image.png". Workspace files are flat, so pass a plain file name, not a nested path.',
        },
        overwriteFileId: {
          type: 'string',
          description:
            'If provided, overwrites the existing workspace file with this ID instead of creating a new file. Use this when the user asks to update, refine, or redo a previously generated image so the existing chat resource stays current instead of creating a duplicate like "image (1).png". The file ID is returned by previous generate_image or generate_visualization calls (fileId field), or can be found via read("files/by-id/{fileId}/meta.json").',
        },
        prompt: {
          type: 'string',
          description:
            'Detailed text description of the image to generate, or editing instructions when used with editFileId.',
        },
        referenceFileIds: {
          type: 'array',
          description:
            'File IDs of workspace images to include as context for the generation. All images are sent alongside the prompt. Use for: editing a single image (1 file), compositing multiple images together (2+ files), style transfer, face swapping, etc. Order matters — list the primary/base image first. When revising an existing image in place, pair the primary file ID here with overwriteFileId set to that same ID.',
          items: {
            type: 'string',
          },
        },
      },
      required: ['prompt'],
    },
    resultSchema: undefined,
  },
  generate_visualization: {
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            "Python code that generates a visualization using matplotlib. MUST call plt.savefig('/home/user/output.png', dpi=150, bbox_inches='tight') to produce output.",
        },
        fileName: {
          type: 'string',
          description:
            'Output file name. Defaults to "chart.png". Workspace files are flat, so pass a plain file name, not a nested path.',
        },
        inputFiles: {
          type: 'array',
          description:
            'Canonical workspace file IDs to mount in the sandbox. Discover IDs via read("files/{name}/meta.json") or glob("files/by-id/*/meta.json"). Mounted path: /home/user/files/{fileId}/{originalName}.',
          items: {
            type: 'string',
          },
        },
        inputTables: {
          type: 'array',
          description:
            "Table IDs to mount as CSV files in the sandbox. Each table appears at /home/user/tables/{tableId}.csv with a header row. Read with pandas: pd.read_csv('/home/user/tables/tbl_xxx.csv')",
          items: {
            type: 'string',
          },
        },
        overwriteFileId: {
          type: 'string',
          description:
            'If provided, overwrites the existing workspace file with this ID instead of creating a new file. Use this when the user asks to update, refine, or redo a previously generated chart so the existing chat resource stays current instead of creating a duplicate like "chart (1).png". The file ID is returned by previous generate_visualization or generate_image calls (fileId field), or can be found via read("files/by-id/{fileId}/meta.json").',
        },
      },
      required: ['code'],
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
  get_deployment_version: {
    parameters: {
      type: 'object',
      properties: {
        version: {
          type: 'number',
          description: 'The deployment version number',
        },
        workflowId: {
          type: 'string',
          description: 'The workflow ID',
        },
      },
      required: ['workflowId', 'version'],
    },
    resultSchema: undefined,
  },
  get_execution_summary: {
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max number of executions to return (default: 10, max: 20).',
        },
        status: {
          type: 'string',
          description: "Filter by status: 'success', 'error', or 'all' (default: 'all').",
          enum: ['success', 'error', 'all'],
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID. If omitted, returns executions across all workflows in the workspace.',
        },
        workspaceId: {
          type: 'string',
          description: 'Workspace ID to scope executions to.',
        },
      },
      required: ['workspaceId'],
    },
    resultSchema: undefined,
  },
  get_job_logs: {
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
          description: 'The job (schedule) ID to get logs for.',
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
  get_workflow_logs: {
    parameters: {
      type: 'object',
      properties: {
        executionId: {
          type: 'string',
          description:
            'Optional execution ID to get logs for a specific execution. Use with get_execution_summary to find execution IDs first.',
        },
        includeDetails: {
          type: 'boolean',
          description: 'Include detailed info',
        },
        limit: {
          type: 'number',
          description: 'Max number of entries (hard limit: 3)',
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
            "Optional path prefix to scope the search (e.g. 'workflows/', 'environment/', 'internal/', 'components/blocks/').",
        },
        pattern: {
          type: 'string',
          description: 'Regex pattern to search for in file contents.',
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
  job: {
    parameters: {
      properties: {
        request: {
          description: 'What job action is needed.',
          type: 'string',
        },
      },
      required: ['request'],
      type: 'object',
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
            enabled: {
              type: 'boolean',
              description: 'Enable/disable a document (optional for update_document)',
            },
            fileIds: {
              type: 'array',
              description:
                'Canonical workspace file IDs to add as documents (for add_file). Discover via read("files/{name}/meta.json") or glob("files/by-id/*/meta.json").',
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
                'Sync interval in minutes: 60 (hourly), 360 (6h), 1440 (daily), 10080 (weekly), 0 (manual only). Default: 1440',
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
            topK: {
              type: 'number',
              description: 'Number of results to return (1-50, default: 5)',
              default: 5,
            },
            workspaceId: {
              type: 'string',
              description: "Workspace ID (required for 'create', optional filter for 'list')",
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
  list_folders: {
    parameters: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace ID to list folders for.',
        },
      },
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
          description: 'Workspace ID (defaults to current workspace)',
        },
      },
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
          description: "The operation to perform: 'add', 'edit', 'list', or 'delete'",
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
            "The ID of the custom tool (required for edit). Must be the exact toolId from the get_workflow_data custom tool response - do not guess or construct it. DO NOT PROVIDE THE TOOL ID IF THE OPERATION IS 'ADD'.",
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
  manage_job: {
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
              description: 'Cron expression for recurring jobs',
            },
            jobId: {
              type: 'string',
              description: 'Job ID (required for get, update)',
            },
            jobIds: {
              type: 'array',
              description: 'Array of job IDs (for batch delete)',
              items: {
                type: 'string',
              },
            },
            lifecycle: {
              type: 'string',
              description:
                "'persistent' (default) or 'until_complete'. Until_complete jobs stop when complete_job is called.",
            },
            maxRuns: {
              type: 'integer',
              description: 'Max executions before auto-completing. Safety limit.',
            },
            prompt: {
              type: 'string',
              description: 'The prompt to execute when the job fires',
            },
            status: {
              type: 'string',
              description: 'Job status: active, paused',
            },
            successCondition: {
              type: 'string',
              description:
                'What must happen for the job to be considered complete (until_complete lifecycle).',
            },
            time: {
              type: 'string',
              description: 'ISO 8601 datetime for one-time jobs or cron start time',
            },
            timezone: {
              type: 'string',
              description: 'IANA timezone (e.g. America/New_York). Defaults to UTC.',
            },
            title: {
              type: 'string',
              description: "Short descriptive title for the job (e.g. 'Email Poller')",
            },
          },
        },
        operation: {
          type: 'string',
          description: 'The operation to perform: create, list, get, update, delete',
          enum: ['create', 'list', 'get', 'update', 'delete'],
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
          description: "The operation to perform: 'add', 'edit', 'list', or 'delete'",
          enum: ['add', 'edit', 'delete', 'list'],
        },
        serverId: {
          type: 'string',
          description:
            "Required for edit and delete. The database ID of the MCP server. DO NOT PROVIDE if operation is 'add' or 'list'.",
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
          description: "The operation to perform: 'add', 'edit', 'list', or 'delete'",
          enum: ['add', 'edit', 'delete', 'list'],
        },
        skillId: {
          type: 'string',
          description:
            "The ID of the skill (required for edit/delete). Must be the exact ID from the VFS or list. DO NOT PROVIDE if operation is 'add' or 'list'.",
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
        knowledgeBaseId: {
          type: 'string',
          description:
            'ID of an existing knowledge base to add the file to (only used with operation "knowledge_base"). If omitted, a new KB is created.',
        },
        operation: {
          type: 'string',
          description:
            'What to do with the file. "save" promotes it to files/. "import" imports a workflow JSON. "table" converts CSV/TSV/JSON to a table. "knowledge_base" saves and adds to a KB. Defaults to "save".',
          enum: ['save', 'import', 'table', 'knowledge_base'],
          default: 'save',
        },
        tableName: {
          type: 'string',
          description:
            'Custom name for the table (only used with operation "table"). Defaults to the file name without extension.',
        },
      },
      required: ['fileNames'],
    },
    resultSchema: undefined,
  },
  move_folder: {
    parameters: {
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
    resultSchema: undefined,
  },
  move_workflow: {
    parameters: {
      type: 'object',
      properties: {
        folderId: {
          type: 'string',
          description: 'Target folder ID. Omit or pass empty string to move to workspace root.',
        },
        workflowIds: {
          type: 'array',
          description: 'The workflow IDs to move.',
          items: {
            type: 'string',
          },
        },
      },
      required: ['workflowIds'],
    },
    resultSchema: undefined,
  },
  oauth_get_auth_link: {
    parameters: {
      type: 'object',
      properties: {
        providerName: {
          type: 'string',
          description:
            "The name of the OAuth provider to connect (e.g., 'Slack', 'Gmail', 'Google Calendar', 'GitHub')",
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
            "The name of the OAuth provider to connect (e.g., 'Slack', 'Gmail', 'Google Calendar')",
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
          description: 'Array of resources to open. Each item must have type and id.',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The resource ID.',
              },
              type: {
                type: 'string',
                description: 'The resource type.',
                enum: ['workflow', 'table', 'knowledgebase', 'file', 'log'],
              },
            },
            required: ['type', 'id'],
          },
        },
      },
      required: ['resources'],
    },
    resultSchema: undefined,
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
          description: "Path to the file to read (e.g. 'workflows/My Workflow/state.json').",
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
        workflowId: {
          type: 'string',
          description: 'Workflow ID to redeploy (required in workspace context)',
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
  rename_file: {
    parameters: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'Canonical workspace file ID of the file to rename.',
        },
        newName: {
          type: 'string',
          description:
            'New filename including extension, e.g. "draft_v2.md". Must not contain slashes.',
        },
      },
      required: ['fileId', 'newName'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: 'Contains id and the new name.',
        },
        message: {
          type: 'string',
          description: 'Human-readable outcome.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the rename succeeded.',
        },
      },
      required: ['success', 'message'],
    },
  },
  rename_workflow: {
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The new name for the workflow.',
        },
        workflowId: {
          type: 'string',
          description: 'The workflow ID to rename.',
        },
      },
      required: ['workflowId', 'name'],
    },
    resultSchema: undefined,
  },
  research: {
    parameters: {
      properties: {
        topic: {
          description: 'The topic to research.',
          type: 'string',
        },
      },
      required: ['topic'],
      type: 'object',
    },
    resultSchema: undefined,
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
          enum: ['workflow', 'table', 'file', 'knowledgebase', 'folder'],
        },
      },
      required: ['type', 'id'],
    },
    resultSchema: undefined,
  },
  revert_to_version: {
    parameters: {
      type: 'object',
      properties: {
        version: {
          type: 'number',
          description: 'The deployment version number to revert to',
        },
        workflowId: {
          type: 'string',
          description: 'The workflow ID',
        },
      },
      required: ['workflowId', 'version'],
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
        triggerBlockId: {
          type: 'string',
          description:
            'Optional trigger block ID when the workflow has multiple entrypoints and you need to target a specific one.',
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
      required: ['workflow_input'],
    },
    resultSchema: undefined,
  },
  run_workflow_until_block: {
    parameters: {
      type: 'object',
      properties: {
        stopAfterBlockId: {
          type: 'string',
          description: 'The block ID to stop after. Execution halts once this block completes.',
        },
        triggerBlockId: {
          type: 'string',
          description:
            'Optional trigger block ID when the workflow has multiple entrypoints and you need to target a specific one.',
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
      required: ['stopAfterBlockId'],
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
            'paper',
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
            'Optional target-only UI phrase for the search row. The UI verb is supplied for you, so pass text like "pricing changes" or "Slack webhook docs", not a full sentence like "Searching online for pricing changes".',
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
              },
              operation: {
                type: 'string',
                enum: ['add', 'delete', 'edit'],
              },
              type: {
                type: 'string',
                enum: ['plain', 'number', 'boolean', 'array', 'object'],
              },
              value: {
                type: 'string',
              },
            },
            required: ['operation', 'name', 'type', 'value'],
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
  superagent: {
    parameters: {
      properties: {
        task: {
          description:
            "A single sentence — the agent has full conversation context. Do NOT pre-read credentials or look up configs. Example: 'send the email we discussed' or 'check my calendar for tomorrow'.",
          type: 'string',
        },
      },
      required: ['task'],
      type: 'object',
    },
    resultSchema: undefined,
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
  tool_search_tool_regex: {
    parameters: {
      properties: {
        case_insensitive: {
          description: 'Whether the regex should be case-insensitive (default true).',
          type: 'boolean',
        },
        max_results: {
          description: 'Maximum number of tools to return (optional).',
          type: 'integer',
        },
        pattern: {
          description: 'Regular expression to match tool names or descriptions.',
          type: 'string',
        },
      },
      required: ['pattern'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  update_job_history: {
    parameters: {
      type: 'object',
      properties: {
        jobId: {
          type: 'string',
          description: 'The job ID.',
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
  user_memory: {
    parameters: {
      type: 'object',
      properties: {
        confidence: {
          type: 'number',
          description: 'Confidence level 0-1 (default 1.0 for explicit, 0.8 for inferred)',
        },
        correct_value: {
          type: 'string',
          description: "The correct value to replace the wrong one (for 'correct' operation)",
        },
        key: {
          type: 'string',
          description: "Unique key for the memory (e.g., 'preferred_model', 'slack_credential')",
        },
        limit: {
          type: 'number',
          description: 'Number of results for search (default 10)',
        },
        memory_type: {
          type: 'string',
          description: "Type of memory: 'preference', 'entity', 'history', or 'correction'",
          enum: ['preference', 'entity', 'history', 'correction'],
        },
        operation: {
          type: 'string',
          description: "Operation: 'add', 'search', 'delete', 'correct', or 'list'",
          enum: ['add', 'search', 'delete', 'correct', 'list'],
        },
        query: {
          type: 'string',
          description: 'Search query to find relevant memories',
        },
        source: {
          type: 'string',
          description: "Source: 'explicit' (user told you) or 'inferred' (you observed)",
          enum: ['explicit', 'inferred'],
        },
        value: {
          type: 'string',
          description: 'Value to remember',
        },
      },
      required: ['operation'],
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
            column: {
              type: 'object',
              description: 'Column definition for add_column: { name, type, unique?, position? }',
            },
            columnName: {
              type: 'string',
              description:
                'Column name (required for rename_column, update_column; use columnNames array for batch delete_column)',
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
            description: {
              type: 'string',
              description: "Table description (optional for 'create')",
            },
            fileId: {
              type: 'string',
              description:
                'Canonical workspace file ID for create_from_file/import_file. Discover via read("files/{name}/meta.json") or glob("files/by-id/*/meta.json").',
            },
            filePath: {
              type: 'string',
              description:
                'Legacy workspace file reference for create_from_file/import_file. Prefer fileId.',
            },
            filter: {
              type: 'object',
              description:
                'MongoDB-style filter for query_rows, update_rows_by_filter, delete_rows_by_filter',
            },
            limit: {
              type: 'number',
              description: 'Maximum rows to return or affect (optional, default 100)',
            },
            name: {
              type: 'string',
              description: "Table name (required for 'create')",
            },
            newName: {
              type: 'string',
              description: 'New column name (required for rename_column)',
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
            outputFormat: {
              type: 'string',
              description:
                'Explicit format override for outputPath. Usually unnecessary — the file extension determines the format automatically. Only use this to force a different format than what the extension implies.',
              enum: ['json', 'csv', 'txt', 'md', 'html'],
            },
            outputPath: {
              type: 'string',
              description:
                'Pipe query_rows results directly to a NEW workspace file. The format is auto-inferred from the file extension: .csv → CSV, .json → JSON, .md → Markdown, etc. Use .csv for tabular exports. Use a flat path like "files/export.csv" — nested paths are not supported.',
            },
            rowId: {
              type: 'string',
              description: 'Row ID (required for get_row, update_row, delete_row)',
            },
            rowIds: {
              type: 'array',
              description: 'Array of row IDs to delete (for batch_delete_rows)',
            },
            rows: {
              type: 'array',
              description: 'Array of row data objects (required for batch_insert_rows)',
            },
            schema: {
              type: 'object',
              description:
                "Table schema with columns array (required for 'create'). Each column: { name, type, unique? }",
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
          description: 'Explicit file target. Use kind=file_id + fileId for existing files.',
          properties: {
            fileId: {
              type: 'string',
              description:
                'Canonical existing workspace file ID. Required when target.kind=file_id.',
            },
            fileName: {
              type: 'string',
              description:
                'Plain workspace filename including extension, e.g. "main.py" or "report.docx". Required when target.kind=new_file.',
            },
            kind: {
              type: 'string',
              description: 'How the file target is identified.',
              enum: ['new_file', 'file_id'],
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
        newName: {
          type: 'string',
          description:
            'New file name for rename. Must be a plain workspace filename like "main.py".',
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
