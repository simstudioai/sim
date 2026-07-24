// AUTO-GENERATED FILE. DO NOT EDIT.
// Generated from copilot/contracts/tool-catalog-v1.json
//

export interface ToolCatalogEntry {
  capabilities?: unknown
  clientExecutable?: boolean
  hidden?: boolean
  id:
    | 'agent'
    | 'auth'
    | 'browser'
    | 'browser_click'
    | 'browser_close_tab'
    | 'browser_extract'
    | 'browser_go_back'
    | 'browser_go_forward'
    | 'browser_hover'
    | 'browser_list_sessions'
    | 'browser_list_tabs'
    | 'browser_navigate'
    | 'browser_open_tab'
    | 'browser_press_key'
    | 'browser_read_text'
    | 'browser_request_takeover'
    | 'browser_screenshot'
    | 'browser_scroll'
    | 'browser_select_option'
    | 'browser_snapshot'
    | 'browser_switch_tab'
    | 'browser_type'
    | 'browser_wait_for'
    | 'call_integration_tool'
    | 'check_deployment_status'
    | 'complete_scheduled_task'
    | 'cp'
    | 'crawl_website'
    | 'create_file'
    | 'create_workflow'
    | 'create_workspace_mcp_server'
    | 'delete_file'
    | 'delete_file_folder'
    | 'delete_workflow'
    | 'delete_workspace_mcp_server'
    | 'deploy'
    | 'deploy_api'
    | 'deploy_chat'
    | 'deploy_custom_block'
    | 'deploy_mcp'
    | 'diff_workflows'
    | 'download_to_workspace_file'
    | 'edit_content'
    | 'edit_workflow'
    | 'enrichment_run'
    | 'ffmpeg'
    | 'file'
    | 'function_execute'
    | 'generate_api_key'
    | 'generate_audio'
    | 'generate_image'
    | 'generate_video'
    | 'get_block_outputs'
    | 'get_block_upstream_references'
    | 'get_deployed_workflow_state'
    | 'get_deployment_log'
    | 'get_page_contents'
    | 'get_platform_actions'
    | 'get_scheduled_task_logs'
    | 'get_workflow_data'
    | 'get_workflow_run_options'
    | 'glob'
    | 'grep'
    | 'knowledge'
    | 'knowledge_base'
    | 'list_integration_tools'
    | 'list_user_workspaces'
    | 'list_workspace_mcp_servers'
    | 'load_deployment'
    | 'load_integration_tool'
    | 'manage_credential'
    | 'manage_custom_tool'
    | 'manage_folder'
    | 'manage_mcp_tool'
    | 'manage_scheduled_task'
    | 'manage_skill'
    | 'materialize_file'
    | 'media'
    | 'mkdir'
    | 'mv'
    | 'oauth_get_auth_link'
    | 'oauth_request_access'
    | 'open_resource'
    | 'promote_to_live'
    | 'query_logs'
    | 'query_user_table'
    | 'read'
    | 'redeploy'
    | 'respond'
    | 'restore_resource'
    | 'run'
    | 'run_block'
    | 'run_code'
    | 'run_from_block'
    | 'run_workflow'
    | 'run_workflow_until_block'
    | 'scheduled_task'
    | 'scrape_page'
    | 'search'
    | 'search_docs'
    | 'search_integration_tools'
    | 'search_knowledge_base'
    | 'search_library_docs'
    | 'search_online'
    | 'search_patterns'
    | 'set_block_enabled'
    | 'set_environment_variables'
    | 'set_global_workflow_variables'
    | 'table'
    | 'update_deployment_version'
    | 'update_scheduled_task_history'
    | 'update_workspace_mcp_server'
    | 'user_table'
    | 'workflow'
    | 'workspace_file'
  internal?: boolean
  mode: 'async' | 'sync'
  name:
    | 'agent'
    | 'auth'
    | 'browser'
    | 'browser_click'
    | 'browser_close_tab'
    | 'browser_extract'
    | 'browser_go_back'
    | 'browser_go_forward'
    | 'browser_hover'
    | 'browser_list_sessions'
    | 'browser_list_tabs'
    | 'browser_navigate'
    | 'browser_open_tab'
    | 'browser_press_key'
    | 'browser_read_text'
    | 'browser_request_takeover'
    | 'browser_screenshot'
    | 'browser_scroll'
    | 'browser_select_option'
    | 'browser_snapshot'
    | 'browser_switch_tab'
    | 'browser_type'
    | 'browser_wait_for'
    | 'call_integration_tool'
    | 'check_deployment_status'
    | 'complete_scheduled_task'
    | 'cp'
    | 'crawl_website'
    | 'create_file'
    | 'create_workflow'
    | 'create_workspace_mcp_server'
    | 'delete_file'
    | 'delete_file_folder'
    | 'delete_workflow'
    | 'delete_workspace_mcp_server'
    | 'deploy'
    | 'deploy_api'
    | 'deploy_chat'
    | 'deploy_custom_block'
    | 'deploy_mcp'
    | 'diff_workflows'
    | 'download_to_workspace_file'
    | 'edit_content'
    | 'edit_workflow'
    | 'enrichment_run'
    | 'ffmpeg'
    | 'file'
    | 'function_execute'
    | 'generate_api_key'
    | 'generate_audio'
    | 'generate_image'
    | 'generate_video'
    | 'get_block_outputs'
    | 'get_block_upstream_references'
    | 'get_deployed_workflow_state'
    | 'get_deployment_log'
    | 'get_page_contents'
    | 'get_platform_actions'
    | 'get_scheduled_task_logs'
    | 'get_workflow_data'
    | 'get_workflow_run_options'
    | 'glob'
    | 'grep'
    | 'knowledge'
    | 'knowledge_base'
    | 'list_integration_tools'
    | 'list_user_workspaces'
    | 'list_workspace_mcp_servers'
    | 'load_deployment'
    | 'load_integration_tool'
    | 'manage_credential'
    | 'manage_custom_tool'
    | 'manage_folder'
    | 'manage_mcp_tool'
    | 'manage_scheduled_task'
    | 'manage_skill'
    | 'materialize_file'
    | 'media'
    | 'mkdir'
    | 'mv'
    | 'oauth_get_auth_link'
    | 'oauth_request_access'
    | 'open_resource'
    | 'promote_to_live'
    | 'query_logs'
    | 'query_user_table'
    | 'read'
    | 'redeploy'
    | 'respond'
    | 'restore_resource'
    | 'run'
    | 'run_block'
    | 'run_code'
    | 'run_from_block'
    | 'run_workflow'
    | 'run_workflow_until_block'
    | 'scheduled_task'
    | 'scrape_page'
    | 'search'
    | 'search_docs'
    | 'search_integration_tools'
    | 'search_knowledge_base'
    | 'search_library_docs'
    | 'search_online'
    | 'search_patterns'
    | 'set_block_enabled'
    | 'set_environment_variables'
    | 'set_global_workflow_variables'
    | 'table'
    | 'update_deployment_version'
    | 'update_scheduled_task_history'
    | 'update_workspace_mcp_server'
    | 'user_table'
    | 'workflow'
    | 'workspace_file'
  parameters: unknown
  requiredPermission?: 'admin' | 'write'
  resultSchema?: unknown
  route: 'client' | 'go' | 'sim' | 'subagent'
  subagentId?:
    | 'agent'
    | 'auth'
    | 'browser'
    | 'deploy'
    | 'file'
    | 'knowledge'
    | 'media'
    | 'run'
    | 'scheduled_task'
    | 'search'
    | 'table'
    | 'workflow'
}

export const Agent: ToolCatalogEntry = {
  id: 'agent',
  name: 'agent',
  route: 'subagent',
  mode: 'async',
  parameters: {
    properties: {
      request: { description: 'What tool/skill/MCP action is needed.', type: 'string' },
    },
    required: ['request'],
    type: 'object',
  },
  subagentId: 'agent',
  internal: true,
  requiredPermission: 'write',
}

export const Auth: ToolCatalogEntry = {
  id: 'auth',
  name: 'auth',
  route: 'subagent',
  mode: 'async',
  parameters: {
    properties: {
      request: { description: 'What authentication/credential action is needed.', type: 'string' },
    },
    required: ['request'],
    type: 'object',
  },
  subagentId: 'auth',
  internal: true,
}

export const Browser: ToolCatalogEntry = {
  id: 'browser',
  name: 'browser',
  route: 'subagent',
  mode: 'async',
  parameters: {
    properties: {
      task: {
        description:
          'The web task to complete, in plain language (include the target site/URL if known).',
        type: 'string',
      },
    },
    required: ['task'],
    type: 'object',
  },
  subagentId: 'browser',
  internal: true,
}

export const BrowserClick: ToolCatalogEntry = {
  id: 'browser_click',
  name: 'browser_click',
  route: 'client',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      elementId: {
        type: 'number',
        description: 'The element id to act on (from the most recent browser_snapshot).',
      },
    },
    required: ['elementId'],
  },
  clientExecutable: true,
}

export const BrowserCloseTab: ToolCatalogEntry = {
  id: 'browser_close_tab',
  name: 'browser_close_tab',
  route: 'client',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      tabId: {
        type: 'string',
        description: 'The id of the tab to close (from browser_list_tabs).',
      },
    },
    required: ['tabId'],
  },
  clientExecutable: true,
}

export const BrowserExtract: ToolCatalogEntry = {
  id: 'browser_extract',
  name: 'browser_extract',
  route: 'client',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      instruction: { type: 'string', description: 'What to extract, in plain language.' },
    },
    required: ['instruction'],
  },
  clientExecutable: true,
}

export const BrowserGoBack: ToolCatalogEntry = {
  id: 'browser_go_back',
  name: 'browser_go_back',
  route: 'client',
  mode: 'async',
  parameters: { type: 'object', properties: {} },
  clientExecutable: true,
}

export const BrowserGoForward: ToolCatalogEntry = {
  id: 'browser_go_forward',
  name: 'browser_go_forward',
  route: 'client',
  mode: 'async',
  parameters: { type: 'object', properties: {} },
  clientExecutable: true,
}

export const BrowserHover: ToolCatalogEntry = {
  id: 'browser_hover',
  name: 'browser_hover',
  route: 'client',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      elementId: {
        type: 'number',
        description: 'The element id to act on (from the most recent browser_snapshot).',
      },
    },
    required: ['elementId'],
  },
  clientExecutable: true,
}

export const BrowserListSessions: ToolCatalogEntry = {
  id: 'browser_list_sessions',
  name: 'browser_list_sessions',
  route: 'client',
  mode: 'async',
  parameters: { type: 'object', properties: {} },
  clientExecutable: true,
}

export const BrowserListTabs: ToolCatalogEntry = {
  id: 'browser_list_tabs',
  name: 'browser_list_tabs',
  route: 'client',
  mode: 'async',
  parameters: { type: 'object', properties: {} },
  clientExecutable: true,
}

export const BrowserNavigate: ToolCatalogEntry = {
  id: 'browser_navigate',
  name: 'browser_navigate',
  route: 'client',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description:
          'The absolute URL to navigate to, including scheme (https:// or http:// — localhost/local dev URLs are supported).',
      },
    },
    required: ['url'],
  },
  clientExecutable: true,
}

export const BrowserOpenTab: ToolCatalogEntry = {
  id: 'browser_open_tab',
  name: 'browser_open_tab',
  route: 'client',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string', description: 'Optional URL to open the new tab at.' } },
  },
  clientExecutable: true,
}

export const BrowserPressKey: ToolCatalogEntry = {
  id: 'browser_press_key',
  name: 'browser_press_key',
  route: 'client',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: "Key or combination, e.g. 'Enter', 'Backspace', or 'Cmd+A'.",
      },
    },
    required: ['key'],
  },
  clientExecutable: true,
}

export const BrowserReadText: ToolCatalogEntry = {
  id: 'browser_read_text',
  name: 'browser_read_text',
  route: 'client',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      elementId: {
        type: 'number',
        description:
          'Optional element id (from browser_snapshot) to read text from. Omit to read the whole page.',
      },
    },
  },
  clientExecutable: true,
}

export const BrowserRequestTakeover: ToolCatalogEntry = {
  id: 'browser_request_takeover',
  name: 'browser_request_takeover',
  route: 'client',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      purpose: {
        type: 'string',
        description:
          'Why takeover is needed. Set sign_in for a login/password flow so the desktop can remember a privacy-preserving session hint after the user finishes.',
        enum: ['sign_in', 'captcha', 'payment', 'sensitive_confirmation', 'other'],
      },
      reason: {
        type: 'string',
        description:
          "Short explanation shown to the user of what they need to do (e.g. 'Sign in to Notion').",
      },
    },
    required: ['reason'],
  },
  clientExecutable: true,
}

export const BrowserScreenshot: ToolCatalogEntry = {
  id: 'browser_screenshot',
  name: 'browser_screenshot',
  route: 'client',
  mode: 'async',
  parameters: { type: 'object', properties: {} },
  clientExecutable: true,
}

export const BrowserScroll: ToolCatalogEntry = {
  id: 'browser_scroll',
  name: 'browser_scroll',
  route: 'client',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      amount: {
        type: 'number',
        description: 'Optional distance to scroll in pixels (default one viewport).',
      },
      direction: { type: 'string', description: 'Scroll direction.', enum: ['up', 'down'] },
    },
    required: ['direction'],
  },
  clientExecutable: true,
}

export const BrowserSelectOption: ToolCatalogEntry = {
  id: 'browser_select_option',
  name: 'browser_select_option',
  route: 'client',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      elementId: {
        type: 'number',
        description: 'The element id to act on (from the most recent browser_snapshot).',
      },
      value: { type: 'string', description: "The option's visible label or its value." },
    },
    required: ['elementId', 'value'],
  },
  clientExecutable: true,
}

export const BrowserSnapshot: ToolCatalogEntry = {
  id: 'browser_snapshot',
  name: 'browser_snapshot',
  route: 'client',
  mode: 'async',
  parameters: { type: 'object', properties: {} },
  clientExecutable: true,
}

export const BrowserSwitchTab: ToolCatalogEntry = {
  id: 'browser_switch_tab',
  name: 'browser_switch_tab',
  route: 'client',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      tabId: {
        type: 'string',
        description: 'The id of the tab to activate (from browser_list_tabs).',
      },
    },
    required: ['tabId'],
  },
  clientExecutable: true,
}

export const BrowserType: ToolCatalogEntry = {
  id: 'browser_type',
  name: 'browser_type',
  route: 'client',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      elementId: {
        type: 'number',
        description: 'The element id to act on (from the most recent browser_snapshot).',
      },
      submit: { type: 'boolean', description: 'Press Enter after typing. Default false.' },
      text: {
        type: 'string',
        description: "The text to type. Replaces the element's current content.",
      },
    },
    required: ['elementId', 'text'],
  },
  clientExecutable: true,
}

export const BrowserWaitFor: ToolCatalogEntry = {
  id: 'browser_wait_for',
  name: 'browser_wait_for',
  route: 'client',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Optional visible text to wait for.' },
      timeoutMs: {
        type: 'number',
        description: 'Maximum time to wait, in milliseconds (default 10000).',
      },
    },
  },
  clientExecutable: true,
}

export const CallIntegrationTool: ToolCatalogEntry = {
  id: 'call_integration_tool',
  name: 'call_integration_tool',
  route: 'go',
  mode: 'sync',
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
      toolId: { description: 'Exact toolId returned by search_integration_tools.', type: 'string' },
    },
    required: ['toolId', 'description', 'arguments'],
    type: 'object',
  },
}

export const CheckDeploymentStatus: ToolCatalogEntry = {
  id: 'check_deployment_status',
  name: 'check_deployment_status',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      workflowId: {
        type: 'string',
        description: 'Workflow ID to check (defaults to current workflow)',
      },
    },
  },
}

export const CompleteScheduledTask: ToolCatalogEntry = {
  id: 'complete_scheduled_task',
  name: 'complete_scheduled_task',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      jobId: { type: 'string', description: 'The ID of the scheduled task to mark as completed.' },
    },
    required: ['jobId'],
  },
}

export const Cp: ToolCatalogEntry = {
  id: 'cp',
  name: 'cp',
  route: 'sim',
  mode: 'async',
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
        items: { type: 'string' },
      },
      toolTitle: {
        type: 'string',
        description:
          'Target-only UI phrase for the action row, e.g. "My Workflow" or "Template to Archive", not a full sentence like "Copying My Workflow".',
      },
    },
    required: ['sources', 'destination', 'toolTitle'],
  },
  requiredPermission: 'write',
}

export const CrawlWebsite: ToolCatalogEntry = {
  id: 'crawl_website',
  name: 'crawl_website',
  route: 'go',
  mode: 'sync',
  parameters: {
    type: 'object',
    properties: {
      exclude_paths: {
        type: 'array',
        description: 'Skip URLs matching these patterns',
        items: { type: 'string' },
      },
      include_paths: {
        type: 'array',
        description: 'Only crawl URLs matching these patterns',
        items: { type: 'string' },
      },
      limit: { type: 'number', description: 'Maximum pages to crawl (default 10, max 50)' },
      max_depth: { type: 'number', description: 'How deep to follow links (default 2)' },
      url: { type: 'string', description: 'Starting URL to crawl from' },
    },
    required: ['url'],
  },
}

export const CreateFile: ToolCatalogEntry = {
  id: 'create_file',
  name: 'create_file',
  route: 'sim',
  mode: 'async',
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
      message: { type: 'string', description: 'Human-readable outcome.' },
      success: { type: 'boolean', description: 'Whether the file was created.' },
    },
    required: ['success', 'message'],
  },
  requiredPermission: 'write',
  capabilities: ['file_output'],
}

export const CreateWorkflow: ToolCatalogEntry = {
  id: 'create_workflow',
  name: 'create_workflow',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      folderPath: {
        type: 'string',
        description:
          'Optional canonical workflow-folder VFS path copied from glob("workflows/**"), for example "workflows/Dream" or "workflows/Client%20Work/Intake". Omit for the workspace root.',
      },
      name: { type: 'string', description: 'Workflow name.' },
      workspaceId: { type: 'string', description: 'Optional workspace ID.' },
    },
    required: ['name'],
  },
  requiredPermission: 'write',
}

export const CreateWorkspaceMcpServer: ToolCatalogEntry = {
  id: 'create_workspace_mcp_server',
  name: 'create_workspace_mcp_server',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'Optional description for the server' },
      isPublic: {
        type: 'boolean',
        description: 'Whether the workflow MCP server is publicly accessible',
      },
      name: { type: 'string', description: 'Required: server name' },
      workflowIds: {
        type: 'array',
        description: 'Optional deployed workflow IDs to publish as tools on the new server',
        items: { type: 'string' },
      },
      workspaceId: {
        type: 'string',
        description:
          'Workspace ID. Required when no current workspace context is available, such as headless MCP calls.',
      },
    },
    required: ['name'],
  },
  requiredPermission: 'admin',
}

export const DeleteFile: ToolCatalogEntry = {
  id: 'delete_file',
  name: 'delete_file',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      paths: {
        type: 'array',
        description:
          'Canonical workspace file VFS paths to delete, e.g. ["files/Reports/draft.md"].',
        items: { type: 'string' },
      },
    },
    required: ['paths'],
  },
  resultSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Human-readable outcome.' },
      success: { type: 'boolean', description: 'Whether the delete succeeded.' },
    },
    required: ['success', 'message'],
  },
  requiredPermission: 'write',
}

export const DeleteFileFolder: ToolCatalogEntry = {
  id: 'delete_file_folder',
  name: 'delete_file_folder',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      paths: {
        type: 'array',
        description: 'Canonical folder VFS paths to delete, e.g. ["files/Archive"].',
        items: { type: 'string' },
      },
    },
    required: ['paths'],
  },
  requiredPermission: 'write',
}

export const DeleteWorkflow: ToolCatalogEntry = {
  id: 'delete_workflow',
  name: 'delete_workflow',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      workflowIds: {
        type: 'array',
        description: 'The workflow IDs to delete.',
        items: { type: 'string' },
      },
    },
    required: ['workflowIds'],
  },
  requiredPermission: 'write',
}

export const DeleteWorkspaceMcpServer: ToolCatalogEntry = {
  id: 'delete_workspace_mcp_server',
  name: 'delete_workspace_mcp_server',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      serverId: { type: 'string', description: 'Required: the MCP server ID to delete' },
    },
    required: ['serverId'],
  },
  requiredPermission: 'admin',
}

export const Deploy: ToolCatalogEntry = {
  id: 'deploy',
  name: 'deploy',
  route: 'subagent',
  mode: 'async',
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
  subagentId: 'deploy',
  internal: true,
}

export const DeployApi: ToolCatalogEntry = {
  id: 'deploy_api',
  name: 'deploy_api',
  route: 'sim',
  mode: 'async',
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
      apiEndpoint: { type: 'string', description: 'Canonical workflow execution endpoint.' },
      baseUrl: { type: 'string', description: 'Base URL used to construct deployment URLs.' },
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
        description: 'Structured per-surface deployment status keyed by surface name, such as api.',
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
      workflowId: { type: 'string', description: 'Workflow ID that was deployed or undeployed.' },
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
  requiredPermission: 'admin',
}

export const DeployChat: ToolCatalogEntry = {
  id: 'deploy_chat',
  name: 'deploy_chat',
  route: 'sim',
  mode: 'async',
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
        items: { type: 'string' },
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
            blockId: { type: 'string', description: 'The block UUID' },
            path: {
              type: 'string',
              description:
                'The output path (e.g. `content` for an agent; structured fields are top-level paths). Call get_block_outputs for real paths.',
            },
          },
          required: ['blockId', 'path'],
        },
      },
      password: { type: 'string', description: 'Password for password-protected chats' },
      title: { type: 'string', description: 'Display title for the chat interface' },
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
      welcomeMessage: { type: 'string', description: 'Welcome message shown to users' },
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
      baseUrl: { type: 'string', description: 'Base URL used to construct deployment URLs.' },
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
      identifier: { type: 'string', description: 'Chat identifier or slug.' },
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
  requiredPermission: 'admin',
}

export const DeployCustomBlock: ToolCatalogEntry = {
  id: 'deploy_custom_block',
  name: 'deploy_custom_block',
  route: 'sim',
  mode: 'async',
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
            blockId: { type: 'string', description: 'Block UUID inside the workflow' },
            name: { type: 'string', description: 'Friendly output name shown on the block' },
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
            id: { type: 'string', description: 'Stable id of the input trigger field' },
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
      workflowId: { type: 'string', description: 'Workflow ID (defaults to active workflow)' },
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
      blockId: { type: 'string', description: 'Custom block record ID.' },
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
      name: { type: 'string', description: 'Display name of the custom block.' },
      removed: {
        type: 'boolean',
        description: 'Whether the custom block was unpublished during an undeploy action.',
      },
      updated: {
        type: 'boolean',
        description: 'Whether an existing custom block was updated instead of created.',
      },
      workflowId: { type: 'string', description: 'Workflow ID the custom block is bound to.' },
    },
    required: ['deploymentType', 'deploymentStatus'],
  },
  requiredPermission: 'admin',
}

export const DeployMcp: ToolCatalogEntry = {
  id: 'deploy_mcp',
  name: 'deploy_mcp',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      parameterDescriptions: {
        type: 'array',
        description: 'Array of parameter descriptions for the tool',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'Parameter description' },
            name: { type: 'string', description: 'Parameter name' },
          },
          required: ['name', 'description'],
        },
      },
      serverId: {
        type: 'string',
        description: 'Required: server ID from list_workspace_mcp_servers',
      },
      toolDescription: { type: 'string', description: 'Description for the MCP tool' },
      toolName: {
        type: 'string',
        description: 'Name for the MCP tool (defaults to workflow name)',
      },
      workflowId: { type: 'string', description: 'Workflow ID (defaults to active workflow)' },
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
      baseUrl: { type: 'string', description: 'Base URL used to construct deployment URLs.' },
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
      mcpServerUrl: { type: 'string', description: 'HTTP MCP server URL to configure in clients.' },
      removed: {
        type: 'boolean',
        description: 'Whether the MCP deployment was removed during an undeploy action.',
      },
      serverId: { type: 'string', description: 'Workspace MCP server ID.' },
      serverName: { type: 'string', description: 'Workspace MCP server name.' },
      toolDescription: {
        type: 'string',
        description: 'MCP tool description exposed on the server.',
      },
      toolId: { type: 'string', description: 'MCP tool ID when deployed.' },
      toolName: { type: 'string', description: 'MCP tool name exposed on the server.' },
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
  requiredPermission: 'admin',
}

export const DiffWorkflows: ToolCatalogEntry = {
  id: 'diff_workflows',
  name: 'diff_workflows',
  route: 'sim',
  mode: 'async',
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
        description: 'Optional workflow ID. If not provided, uses the current workflow in context.',
      },
    },
    required: ['ref1', 'ref2'],
  },
}

export const DownloadToWorkspaceFile: ToolCatalogEntry = {
  id: 'download_to_workspace_file',
  name: 'download_to_workspace_file',
  route: 'sim',
  mode: 'async',
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
  requiredPermission: 'write',
  capabilities: ['file_output'],
}

export const EditContent: ToolCatalogEntry = {
  id: 'edit_content',
  name: 'edit_content',
  route: 'sim',
  mode: 'async',
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
      message: { type: 'string', description: 'Human-readable summary of the outcome.' },
      success: { type: 'boolean', description: 'Whether the content was applied successfully.' },
    },
    required: ['success', 'message'],
  },
  requiredPermission: 'write',
}

export const EditWorkflow: ToolCatalogEntry = {
  id: 'edit_workflow',
  name: 'edit_workflow',
  route: 'sim',
  mode: 'async',
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
  requiredPermission: 'write',
}

export const EnrichmentRun: ToolCatalogEntry = {
  id: 'enrichment_run',
  name: 'enrichment_run',
  route: 'sim',
  mode: 'async',
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
  requiredPermission: 'write',
}

export const Ffmpeg: ToolCatalogEntry = {
  id: 'ffmpeg',
  name: 'ffmpeg',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      aspectRatio: {
        type: 'string',
        description: 'Target aspect ratio for scale_pad, e.g. 9:16, 16:9, 1:1.',
      },
      end: { type: 'number', description: 'End time in seconds (trim).' },
      format: {
        type: 'string',
        description: 'Target format/extension for convert (e.g. mp4, mp3, wav, gif).',
      },
      height: { type: 'number', description: 'Target height in pixels (scale_pad).' },
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
                path: { type: 'string', description: 'Canonical VFS table path when available.' },
                sandboxPath: {
                  type: 'string',
                  description: 'Optional full sandbox path for the mounted CSV.',
                },
                tableId: { type: 'string', description: 'Workspace table ID.' },
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
      start: { type: 'number', description: 'Start time in seconds (trim, thumbnail, fade).' },
      text: { type: 'string', description: 'Text to burn in for add_text.' },
      volume: {
        type: 'number',
        description: 'Volume multiplier for the primary track (mix_audio / overlay_audio).',
      },
      width: { type: 'number', description: 'Target width in pixels (scale_pad).' },
    },
    required: ['operation', 'inputs'],
  },
  requiredPermission: 'write',
  capabilities: ['file_input', 'file_output'],
}

export const File: ToolCatalogEntry = {
  id: 'file',
  name: 'file',
  route: 'subagent',
  mode: 'async',
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
  subagentId: 'file',
  internal: true,
}

export const FunctionExecute: ToolCatalogEntry = {
  id: 'function_execute',
  name: 'function_execute',
  route: 'sim',
  mode: 'async',
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
                path: { type: 'string', description: 'Canonical VFS table path when available.' },
                sandboxPath: {
                  type: 'string',
                  description: 'Optional full sandbox path for the mounted CSV.',
                },
                tableId: { type: 'string', description: 'Workspace table ID.' },
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
  requiredPermission: 'write',
  capabilities: ['file_input', 'directory_input', 'file_output', 'table_input', 'table_output'],
}

export const GenerateApiKey: ToolCatalogEntry = {
  id: 'generate_api_key',
  name: 'generate_api_key',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: "A descriptive name for the API key (e.g., 'production-key', 'dev-testing').",
      },
      workspaceId: {
        type: 'string',
        description: "Optional workspace ID. Defaults to user's default workspace.",
      },
    },
    required: ['name'],
  },
  requiredPermission: 'admin',
}

export const GenerateAudio: ToolCatalogEntry = {
  id: 'generate_audio',
  name: 'generate_audio',
  route: 'sim',
  mode: 'async',
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
                path: { type: 'string', description: 'Canonical VFS table path when available.' },
                sandboxPath: {
                  type: 'string',
                  description: 'Optional full sandbox path for the mounted CSV.',
                },
                tableId: { type: 'string', description: 'Workspace table ID.' },
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
      voice: { type: 'string', description: 'Optional voice name or id for speech.' },
    },
    required: ['prompt'],
  },
  requiredPermission: 'write',
  capabilities: ['file_input', 'file_output', 'generated_media'],
}

export const GenerateImage: ToolCatalogEntry = {
  id: 'generate_image',
  name: 'generate_image',
  route: 'sim',
  mode: 'async',
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
                path: { type: 'string', description: 'Canonical VFS table path when available.' },
                sandboxPath: {
                  type: 'string',
                  description: 'Optional full sandbox path for the mounted CSV.',
                },
                tableId: { type: 'string', description: 'Workspace table ID.' },
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
  requiredPermission: 'write',
  capabilities: ['file_input', 'file_output', 'generated_media'],
}

export const GenerateVideo: ToolCatalogEntry = {
  id: 'generate_video',
  name: 'generate_video',
  route: 'sim',
  mode: 'async',
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
                path: { type: 'string', description: 'Canonical VFS table path when available.' },
                sandboxPath: {
                  type: 'string',
                  description: 'Optional full sandbox path for the mounted CSV.',
                },
                tableId: { type: 'string', description: 'Workspace table ID.' },
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
  requiredPermission: 'write',
  capabilities: ['file_input', 'file_output', 'generated_media'],
}

export const GetBlockOutputs: ToolCatalogEntry = {
  id: 'get_block_outputs',
  name: 'get_block_outputs',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      blockIds: {
        type: 'array',
        description:
          'Optional array of block UUIDs. If provided, returns outputs only for those blocks. If not provided, returns outputs for all blocks in the workflow.',
        items: { type: 'string' },
      },
      workflowId: {
        type: 'string',
        description: 'Optional workflow ID. If not provided, uses the current workflow in context.',
      },
    },
  },
}

export const GetBlockUpstreamReferences: ToolCatalogEntry = {
  id: 'get_block_upstream_references',
  name: 'get_block_upstream_references',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      blockIds: {
        type: 'array',
        description:
          'Required array of block UUIDs (minimum 1). Returns what each block can reference based on its position in the workflow graph.',
        items: { type: 'string' },
      },
      workflowId: {
        type: 'string',
        description: 'Optional workflow ID. If not provided, uses the current workflow in context.',
      },
    },
    required: ['blockIds'],
  },
}

export const GetDeployedWorkflowState: ToolCatalogEntry = {
  id: 'get_deployed_workflow_state',
  name: 'get_deployed_workflow_state',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      workflowId: {
        type: 'string',
        description: 'Optional workflow ID. If not provided, uses the current workflow in context.',
      },
    },
  },
}

export const GetDeploymentLog: ToolCatalogEntry = {
  id: 'get_deployment_log',
  name: 'get_deployment_log',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      workflowId: {
        type: 'string',
        description: 'Optional workflow ID. If not provided, uses the current workflow in context.',
      },
    },
  },
}

export const GetPageContents: ToolCatalogEntry = {
  id: 'get_page_contents',
  name: 'get_page_contents',
  route: 'go',
  mode: 'sync',
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
      include_text: { type: 'boolean', description: 'Include full page text (default true)' },
      urls: {
        type: 'array',
        description: 'URLs to get content from (max 10)',
        items: { type: 'string' },
      },
    },
    required: ['urls'],
  },
}

export const GetPlatformActions: ToolCatalogEntry = {
  id: 'get_platform_actions',
  name: 'get_platform_actions',
  route: 'sim',
  mode: 'async',
  parameters: { type: 'object', properties: {} },
}

export const GetScheduledTaskLogs: ToolCatalogEntry = {
  id: 'get_scheduled_task_logs',
  name: 'get_scheduled_task_logs',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      executionId: { type: 'string', description: 'Optional execution ID for a specific run.' },
      includeDetails: {
        type: 'boolean',
        description: 'Include tool calls, outputs, and cost details.',
      },
      jobId: { type: 'string', description: 'The scheduled task (schedule) ID to get logs for.' },
      limit: { type: 'number', description: 'Max number of entries (default: 3, max: 5)' },
    },
    required: ['jobId'],
  },
}

export const GetWorkflowData: ToolCatalogEntry = {
  id: 'get_workflow_data',
  name: 'get_workflow_data',
  route: 'sim',
  mode: 'async',
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
        description: 'Optional workflow ID. If not provided, uses the current workflow in context.',
      },
    },
    required: ['data_type'],
  },
}

export const GetWorkflowRunOptions: ToolCatalogEntry = {
  id: 'get_workflow_run_options',
  name: 'get_workflow_run_options',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      workflowId: {
        type: 'string',
        description: 'Optional workflow ID. If not provided, uses the current workflow in context.',
      },
    },
  },
}

export const Glob: ToolCatalogEntry = {
  id: 'glob',
  name: 'glob',
  route: 'sim',
  mode: 'async',
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
}

export const Grep: ToolCatalogEntry = {
  id: 'grep',
  name: 'grep',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      context: {
        type: 'number',
        description:
          "Number of lines to show before and after each match. Only applies to output_mode 'content'.",
      },
      ignoreCase: { type: 'boolean', description: 'Case insensitive search (default false).' },
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
}

export const Knowledge: ToolCatalogEntry = {
  id: 'knowledge',
  name: 'knowledge',
  route: 'subagent',
  mode: 'async',
  parameters: {
    properties: {
      request: { description: 'What knowledge base action is needed.', type: 'string' },
    },
    required: ['request'],
    type: 'object',
  },
  subagentId: 'knowledge',
  internal: true,
}

export const KnowledgeBase: ToolCatalogEntry = {
  id: 'knowledge_base',
  name: 'knowledge_base',
  route: 'sim',
  mode: 'async',
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
          documentId: { type: 'string', description: 'Document ID (required for update_document)' },
          documentIds: {
            type: 'array',
            description: 'Document IDs (for batch delete_document)',
            items: { type: 'string' },
          },
          enabled: {
            type: 'boolean',
            description: 'Enable/disable a document (optional for update_document)',
          },
          filePaths: {
            type: 'array',
            description:
              'Canonical workspace file VFS paths to add as documents (for add_file), e.g. ["files/Docs/handbook.pdf"].',
            items: { type: 'string' },
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
            items: { type: 'string' },
          },
          name: {
            type: 'string',
            description: "Name of the knowledge base (required for 'create')",
          },
          query: { type: 'string', description: "Search query text (required for 'query')" },
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
      data: { type: 'object', description: 'Operation-specific result payload.' },
      message: { type: 'string', description: 'Human-readable outcome summary.' },
      success: { type: 'boolean', description: 'Whether the operation succeeded.' },
    },
    required: ['success', 'message'],
  },
}

export const ListIntegrationTools: ToolCatalogEntry = {
  id: 'list_integration_tools',
  name: 'list_integration_tools',
  route: 'sim',
  mode: 'async',
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
}

export const ListUserWorkspaces: ToolCatalogEntry = {
  id: 'list_user_workspaces',
  name: 'list_user_workspaces',
  route: 'sim',
  mode: 'async',
  parameters: { type: 'object', properties: {} },
}

export const ListWorkspaceMcpServers: ToolCatalogEntry = {
  id: 'list_workspace_mcp_servers',
  name: 'list_workspace_mcp_servers',
  route: 'sim',
  mode: 'async',
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
}

export const LoadDeployment: ToolCatalogEntry = {
  id: 'load_deployment',
  name: 'load_deployment',
  route: 'sim',
  mode: 'async',
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
        description: 'Optional workflow ID. If not provided, uses the current workflow in context.',
      },
    },
    required: ['version'],
  },
  requiredPermission: 'admin',
}

export const LoadIntegrationTool: ToolCatalogEntry = {
  id: 'load_integration_tool',
  name: 'load_integration_tool',
  route: 'sim',
  mode: 'async',
  parameters: {
    properties: {
      tool_ids: {
        description:
          'Exact integration tool ids to load before calling them, e.g. ["gmail_send_v2"]. Copy the "id" field verbatim from components/integrations/{service}/{operation}.json (including any version suffix).',
        items: { type: 'string' },
        type: 'array',
      },
    },
    required: ['tool_ids'],
    type: 'object',
  },
}

export const ManageCredential: ToolCatalogEntry = {
  id: 'manage_credential',
  name: 'manage_credential',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      credentialId: { type: 'string', description: 'The credential ID (required for rename)' },
      credentialIds: {
        type: 'array',
        description: 'Array of credential IDs (for batch delete)',
        items: { type: 'string' },
      },
      displayName: { type: 'string', description: 'New display name (required for rename)' },
      operation: {
        type: 'string',
        description: 'The operation to perform',
        enum: ['rename', 'delete'],
      },
    },
    required: ['operation'],
  },
  requiredPermission: 'admin',
}

export const ManageCustomTool: ToolCatalogEntry = {
  id: 'manage_custom_tool',
  name: 'manage_custom_tool',
  route: 'sim',
  mode: 'async',
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
              description: { type: 'string', description: 'What the function does' },
              name: { type: 'string', description: 'The function name (camelCase)' },
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
                    items: { type: 'string' },
                  },
                  type: { type: 'string', description: "Must be 'object'" },
                },
                required: ['type', 'properties'],
              },
            },
            required: ['name', 'parameters'],
          },
          type: { type: 'string', description: "Must be 'function'" },
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
        items: { type: 'string' },
      },
    },
    required: ['operation'],
  },
  requiredPermission: 'write',
}

export const ManageFolder: ToolCatalogEntry = {
  id: 'manage_folder',
  name: 'manage_folder',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      folderId: {
        type: 'string',
        description:
          'Target folder ID, used as a fallback when path is not given. Readable from a contained workflow\'s meta.json "folderId".',
      },
      operation: { type: 'string', description: 'The operation to perform.', enum: ['delete'] },
      path: {
        type: 'string',
        description:
          'Target folder\'s VFS path (e.g. "workflows/Marketing/Q3 Campaigns"), per-segment percent-encoded like every VFS path.',
      },
    },
    required: ['operation'],
  },
  requiredPermission: 'write',
}

export const ManageMcpTool: ToolCatalogEntry = {
  id: 'manage_mcp_tool',
  name: 'manage_mcp_tool',
  route: 'sim',
  mode: 'async',
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
          name: { type: 'string', description: 'Display name for the MCP server' },
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
          url: { type: 'string', description: 'The MCP server endpoint URL (required for add)' },
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
  requiredPermission: 'write',
}

export const ManageScheduledTask: ToolCatalogEntry = {
  id: 'manage_scheduled_task',
  name: 'manage_scheduled_task',
  route: 'sim',
  mode: 'async',
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
          jobId: { type: 'string', description: 'Scheduled task ID (required for get, update)' },
          jobIds: {
            type: 'array',
            description: 'Array of scheduled task IDs (for batch delete)',
            items: { type: 'string' },
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
}

export const ManageSkill: ToolCatalogEntry = {
  id: 'manage_skill',
  name: 'manage_skill',
  route: 'sim',
  mode: 'async',
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
  requiredPermission: 'write',
}

export const MaterializeFile: ToolCatalogEntry = {
  id: 'materialize_file',
  name: 'materialize_file',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      fileNames: {
        type: 'array',
        description:
          'The names of the uploaded files to materialize (e.g. ["report.pdf", "data.csv"])',
        items: { type: 'string' },
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
  requiredPermission: 'write',
}

export const Media: ToolCatalogEntry = {
  id: 'media',
  name: 'media',
  route: 'subagent',
  mode: 'async',
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
  subagentId: 'media',
  internal: true,
}

export const Mkdir: ToolCatalogEntry = {
  id: 'mkdir',
  name: 'mkdir',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      paths: {
        type: 'array',
        description:
          'Canonical folder VFS paths to create, e.g. ["files/Reports/2026"]. Missing parent segments are created automatically.',
        items: { type: 'string' },
      },
      toolTitle: {
        type: 'string',
        description:
          'Target-only UI phrase for the action row, e.g. "Reports/2026" or "2 folders", not a full sentence like "Creating Reports".',
      },
    },
    required: ['paths', 'toolTitle'],
  },
  requiredPermission: 'write',
}

export const Mv: ToolCatalogEntry = {
  id: 'mv',
  name: 'mv',
  route: 'sim',
  mode: 'async',
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
        items: { type: 'string' },
      },
      toolTitle: {
        type: 'string',
        description:
          'Target-only UI phrase for the action row, e.g. "draft.md to Reports" or "3 files to Images", not a full sentence like "Moving draft.md".',
      },
    },
    required: ['sources', 'destination', 'toolTitle'],
  },
  requiredPermission: 'write',
}

export const OauthGetAuthLink: ToolCatalogEntry = {
  id: 'oauth_get_auth_link',
  name: 'oauth_get_auth_link',
  route: 'sim',
  mode: 'async',
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
}

export const OauthRequestAccess: ToolCatalogEntry = {
  id: 'oauth_request_access',
  name: 'oauth_request_access',
  route: 'sim',
  mode: 'async',
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
}

export const OpenResource: ToolCatalogEntry = {
  id: 'open_resource',
  name: 'open_resource',
  route: 'sim',
  mode: 'async',
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
            id: { type: 'string', description: 'Canonical resource ID for non-file resources.' },
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
}

export const PromoteToLive: ToolCatalogEntry = {
  id: 'promote_to_live',
  name: 'promote_to_live',
  route: 'sim',
  mode: 'async',
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
        description: 'Optional workflow ID. If not provided, uses the current workflow in context.',
      },
    },
    required: ['version'],
  },
  requiredPermission: 'admin',
}

export const QueryLogs: ToolCatalogEntry = {
  id: 'query_logs',
  name: 'query_logs',
  route: 'sim',
  mode: 'async',
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
        description: "Filter (view='list'): duration threshold (ms) paired with durationOperator.",
      },
      endDate: { type: 'string', description: "Filter (view='list'): ISO end of the time range." },
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
      limit: { type: 'number', description: "Max results (view='list'), 1-200 (default 100)." },
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
      workspaceId: { type: 'string', description: 'Workspace ID to scope to.' },
    },
    required: ['view'],
  },
}

export const QueryUserTable: ToolCatalogEntry = {
  id: 'query_user_table',
  name: 'query_user_table',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      args: {
        type: 'object',
        description: 'Arguments for the operation',
        properties: {
          filter: { type: 'object', description: 'MongoDB-style filter for query_rows' },
          limit: {
            type: 'number',
            description: 'Maximum rows to return (optional, default 100, max 1000 per call)',
          },
          offset: {
            type: 'number',
            description: 'Number of rows to skip (optional for query_rows, default 0)',
          },
          rowId: { type: 'string', description: 'Row ID (required for get_row)' },
          sort: {
            type: 'object',
            description:
              "Sort specification as { field: 'asc' | 'desc' } (optional for query_rows)",
          },
          tableId: { type: 'string', description: 'Table ID (required for all operations)' },
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
      data: { type: 'object', description: 'Operation-specific result payload.' },
      message: { type: 'string', description: 'Human-readable outcome summary.' },
      success: { type: 'boolean', description: 'Whether the operation succeeded.' },
    },
    required: ['success', 'message'],
  },
}

export const Read: ToolCatalogEntry = {
  id: 'read',
  name: 'read',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Maximum number of lines to read.' },
      offset: { type: 'number', description: 'Line offset to start reading from (0-indexed).' },
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
}

export const Redeploy: ToolCatalogEntry = {
  id: 'redeploy',
  name: 'redeploy',
  route: 'sim',
  mode: 'async',
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
      apiEndpoint: { type: 'string', description: 'Canonical workflow execution endpoint.' },
      baseUrl: { type: 'string', description: 'Base URL used to construct deployment URLs.' },
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
        description: 'Structured per-surface deployment status keyed by surface name, such as api.',
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
      workflowId: { type: 'string', description: 'Workflow ID that was deployed or undeployed.' },
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
  requiredPermission: 'admin',
}

export const Respond: ToolCatalogEntry = {
  id: 'respond',
  name: 'respond',
  route: 'sim',
  mode: 'async',
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
        items: { type: 'string' },
        type: 'array',
      },
      success: { description: 'Whether the task completed successfully', type: 'boolean' },
      type: { description: 'Optional logical result type override', type: 'string' },
    },
    required: ['output', 'success'],
    type: 'object',
  },
  internal: true,
  hidden: true,
}

export const RestoreResource: ToolCatalogEntry = {
  id: 'restore_resource',
  name: 'restore_resource',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The canonical resource ID to restore.' },
      type: {
        type: 'string',
        description: 'The resource type to restore.',
        enum: ['workflow', 'table', 'file', 'knowledgebase', 'folder', 'file_folder'],
      },
    },
    required: ['type', 'id'],
  },
  requiredPermission: 'admin',
}

export const Run: ToolCatalogEntry = {
  id: 'run',
  name: 'run',
  route: 'subagent',
  mode: 'async',
  parameters: {
    properties: {
      context: {
        description: 'Pre-gathered context: workflow state, block IDs, input requirements.',
        type: 'string',
      },
      request: { description: 'What to run or what logs to check.', type: 'string' },
    },
    required: ['request'],
    type: 'object',
  },
  subagentId: 'run',
  internal: true,
}

export const RunBlock: ToolCatalogEntry = {
  id: 'run_block',
  name: 'run_block',
  route: 'client',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      blockId: { type: 'string', description: 'The block ID to run in isolation.' },
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
  clientExecutable: true,
}

export const RunCode: ToolCatalogEntry = {
  id: 'run_code',
  name: 'run_code',
  route: 'sim',
  mode: 'async',
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
                path: { type: 'string', description: 'Canonical VFS table path when available.' },
                sandboxPath: {
                  type: 'string',
                  description: 'Optional full sandbox path for the mounted CSV.',
                },
                tableId: { type: 'string', description: 'Workspace table ID.' },
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
  requiredPermission: 'write',
  capabilities: ['file_input', 'directory_input', 'table_input'],
}

export const RunFromBlock: ToolCatalogEntry = {
  id: 'run_from_block',
  name: 'run_from_block',
  route: 'client',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      executionId: {
        type: 'string',
        description:
          'Optional execution ID to load the snapshot from. Uses latest execution if omitted.',
      },
      startBlockId: { type: 'string', description: 'The block ID to start execution from.' },
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
  clientExecutable: true,
}

export const RunWorkflow: ToolCatalogEntry = {
  id: 'run_workflow',
  name: 'run_workflow',
  route: 'client',
  mode: 'async',
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
  clientExecutable: true,
}

export const RunWorkflowUntilBlock: ToolCatalogEntry = {
  id: 'run_workflow_until_block',
  name: 'run_workflow_until_block',
  route: 'client',
  mode: 'async',
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
  clientExecutable: true,
}

export const ScheduledTask: ToolCatalogEntry = {
  id: 'scheduled_task',
  name: 'scheduled_task',
  route: 'subagent',
  mode: 'async',
  parameters: {
    properties: {
      request: { description: 'What scheduled task action is needed.', type: 'string' },
    },
    required: ['request'],
    type: 'object',
  },
  subagentId: 'scheduled_task',
  internal: true,
}

export const ScrapePage: ToolCatalogEntry = {
  id: 'scrape_page',
  name: 'scrape_page',
  route: 'go',
  mode: 'sync',
  parameters: {
    type: 'object',
    properties: {
      include_links: {
        type: 'boolean',
        description: 'Extract all links from the page (default false)',
      },
      url: { type: 'string', description: 'The URL to scrape (must include https://)' },
      wait_for: {
        type: 'string',
        description: 'CSS selector to wait for before scraping (for JS-heavy pages)',
      },
    },
    required: ['url'],
  },
}

export const Search: ToolCatalogEntry = {
  id: 'search',
  name: 'search',
  route: 'subagent',
  mode: 'async',
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
  subagentId: 'search',
  internal: true,
}

export const SearchDocs: ToolCatalogEntry = {
  id: 'search_docs',
  name: 'search_docs',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Optional VFS path prefix starting with docs/documentation/ that limits the search scope',
      },
      query: { type: 'string', description: 'The search query' },
      topK: { type: 'number', description: 'Number of results (default 10, max 25)' },
    },
    required: ['query'],
  },
}

export const SearchIntegrationTools: ToolCatalogEntry = {
  id: 'search_integration_tools',
  name: 'search_integration_tools',
  route: 'go',
  mode: 'sync',
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
}

export const SearchKnowledgeBase: ToolCatalogEntry = {
  id: 'search_knowledge_base',
  name: 'search_knowledge_base',
  route: 'sim',
  mode: 'async',
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
          query: { type: 'string', description: "Search query text (required for 'query')" },
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
      data: { type: 'object', description: 'Operation-specific result payload.' },
      message: { type: 'string', description: 'Human-readable outcome summary.' },
      success: { type: 'boolean', description: 'Whether the operation succeeded.' },
    },
    required: ['success', 'message'],
  },
}

export const SearchLibraryDocs: ToolCatalogEntry = {
  id: 'search_library_docs',
  name: 'search_library_docs',
  route: 'go',
  mode: 'sync',
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
      version: { type: 'string', description: "Specific version (optional, e.g., '14', 'v2')" },
    },
    required: ['library_name', 'query'],
  },
}

export const SearchOnline: ToolCatalogEntry = {
  id: 'search_online',
  name: 'search_online',
  route: 'go',
  mode: 'sync',
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
      include_text: { type: 'boolean', description: 'Include page text content (default true)' },
      num_results: { type: 'number', description: 'Number of results (default 10, max 25)' },
      query: { type: 'string', description: 'Natural language search query' },
      toolTitle: {
        type: 'string',
        description:
          "Required short UI label fragment (e.g. 'Slack integrations'), not a full sentence.",
      },
    },
    required: ['query', 'toolTitle'],
  },
}

export const SearchPatterns: ToolCatalogEntry = {
  id: 'search_patterns',
  name: 'search_patterns',
  route: 'go',
  mode: 'sync',
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
}

export const SetBlockEnabled: ToolCatalogEntry = {
  id: 'set_block_enabled',
  name: 'set_block_enabled',
  route: 'sim',
  mode: 'async',
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
  requiredPermission: 'write',
}

export const SetEnvironmentVariables: ToolCatalogEntry = {
  id: 'set_environment_variables',
  name: 'set_environment_variables',
  route: 'sim',
  mode: 'async',
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
            name: { type: 'string', description: 'Variable name' },
            value: { type: 'string', description: 'Variable value' },
          },
          required: ['name', 'value'],
        },
      },
    },
    required: ['variables'],
  },
  requiredPermission: 'write',
}

export const SetGlobalWorkflowVariables: ToolCatalogEntry = {
  id: 'set_global_workflow_variables',
  name: 'set_global_workflow_variables',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      operations: {
        type: 'array',
        description: 'List of operations to apply',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Variable name.' },
            operation: { type: 'string', enum: ['add', 'delete', 'edit'] },
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
        description: 'Optional workflow ID. If not provided, uses the current workflow in context.',
      },
    },
    required: ['operations'],
  },
  requiredPermission: 'write',
}

export const Table: ToolCatalogEntry = {
  id: 'table',
  name: 'table',
  route: 'subagent',
  mode: 'async',
  parameters: {
    properties: { request: { description: 'What table action is needed.', type: 'string' } },
    required: ['request'],
    type: 'object',
  },
  subagentId: 'table',
  internal: true,
}

export const UpdateDeploymentVersion: ToolCatalogEntry = {
  id: 'update_deployment_version',
  name: 'update_deployment_version',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: 'New description for the deployment version. Provide name and/or description.',
      },
      name: {
        type: 'string',
        description: 'New name/label for the deployment version. Provide name and/or description.',
      },
      version: {
        type: 'number',
        description:
          'The numeric deployment version number to update (use get_deployment_log to find it).',
      },
      workflowId: {
        type: 'string',
        description: 'Optional workflow ID. If not provided, uses the current workflow in context.',
      },
    },
    required: ['version'],
  },
  requiredPermission: 'write',
}

export const UpdateScheduledTaskHistory: ToolCatalogEntry = {
  id: 'update_scheduled_task_history',
  name: 'update_scheduled_task_history',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      jobId: { type: 'string', description: 'The scheduled task ID.' },
      summary: {
        type: 'string',
        description:
          "A concise summary of what was done this run (e.g., 'Sent follow-up emails to 3 leads: Alice, Bob, Carol').",
      },
    },
    required: ['jobId', 'summary'],
  },
}

export const UpdateWorkspaceMcpServer: ToolCatalogEntry = {
  id: 'update_workspace_mcp_server',
  name: 'update_workspace_mcp_server',
  route: 'sim',
  mode: 'async',
  parameters: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'New description for the server' },
      isPublic: { type: 'boolean', description: 'Whether the server is publicly accessible' },
      name: { type: 'string', description: 'New name for the server' },
      serverId: { type: 'string', description: 'Required: the MCP server ID to update' },
    },
    required: ['serverId'],
  },
  requiredPermission: 'admin',
}

export const UserTable: ToolCatalogEntry = {
  id: 'user_table',
  name: 'user_table',
  route: 'sim',
  mode: 'async',
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
            description: 'Source block ID inside the workflow. Used by add_workflow_group_output.',
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
                items: { type: 'string' },
              },
            },
          },
          description: { type: 'string', description: "Table description (optional for 'create')" },
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
            items: { type: 'string' },
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
                blockId: { type: 'string', description: 'New source block ID for this column.' },
                columnName: {
                  type: 'string',
                  description:
                    'The existing output column to remap. Must already be bound to this group.',
                },
                path: { type: 'string', description: 'New dotted output path on the new block.' },
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
                blockId: { type: 'string', description: 'Source block ID inside the workflow.' },
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
                path: { type: 'string', description: 'Dotted output path on the block.' },
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
            items: { type: 'integer' },
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
            items: { type: 'string' },
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
            items: { type: 'string' },
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
      data: { type: 'object', description: 'Operation-specific result payload.' },
      message: { type: 'string', description: 'Human-readable outcome summary.' },
      success: { type: 'boolean', description: 'Whether the operation succeeded.' },
    },
    required: ['success', 'message'],
  },
}

export const Workflow: ToolCatalogEntry = {
  id: 'workflow',
  name: 'workflow',
  route: 'subagent',
  mode: 'async',
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
  subagentId: 'workflow',
  internal: true,
}

export const WorkspaceFile: ToolCatalogEntry = {
  id: 'workspace_file',
  name: 'workspace_file',
  route: 'sim',
  mode: 'async',
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
      message: { type: 'string', description: 'Human-readable summary of the outcome.' },
      success: { type: 'boolean', description: 'Whether the file operation succeeded.' },
    },
    required: ['success', 'message'],
  },
  requiredPermission: 'write',
}

export const FfmpegOperation = {
  overlayAudio: 'overlay_audio',
  mixAudio: 'mix_audio',
  concat: 'concat',
  trim: 'trim',
  scalePad: 'scale_pad',
  overlayImage: 'overlay_image',
  addText: 'add_text',
  fade: 'fade',
  extractAudio: 'extract_audio',
  convert: 'convert',
  thumbnail: 'thumbnail',
  probe: 'probe',
} as const

export type FfmpegOperation = (typeof FfmpegOperation)[keyof typeof FfmpegOperation]

export const FfmpegOperationValues = [
  FfmpegOperation.overlayAudio,
  FfmpegOperation.mixAudio,
  FfmpegOperation.concat,
  FfmpegOperation.trim,
  FfmpegOperation.scalePad,
  FfmpegOperation.overlayImage,
  FfmpegOperation.addText,
  FfmpegOperation.fade,
  FfmpegOperation.extractAudio,
  FfmpegOperation.convert,
  FfmpegOperation.thumbnail,
  FfmpegOperation.probe,
] as const

export const KnowledgeBaseOperation = {
  create: 'create',
  get: 'get',
  query: 'query',
  addFile: 'add_file',
  update: 'update',
  delete: 'delete',
  deleteDocument: 'delete_document',
  updateDocument: 'update_document',
  listTags: 'list_tags',
  createTag: 'create_tag',
  updateTag: 'update_tag',
  deleteTag: 'delete_tag',
  getTagUsage: 'get_tag_usage',
  addConnector: 'add_connector',
  updateConnector: 'update_connector',
  deleteConnector: 'delete_connector',
  syncConnector: 'sync_connector',
} as const

export type KnowledgeBaseOperation =
  (typeof KnowledgeBaseOperation)[keyof typeof KnowledgeBaseOperation]

export const KnowledgeBaseOperationValues = [
  KnowledgeBaseOperation.create,
  KnowledgeBaseOperation.get,
  KnowledgeBaseOperation.query,
  KnowledgeBaseOperation.addFile,
  KnowledgeBaseOperation.update,
  KnowledgeBaseOperation.delete,
  KnowledgeBaseOperation.deleteDocument,
  KnowledgeBaseOperation.updateDocument,
  KnowledgeBaseOperation.listTags,
  KnowledgeBaseOperation.createTag,
  KnowledgeBaseOperation.updateTag,
  KnowledgeBaseOperation.deleteTag,
  KnowledgeBaseOperation.getTagUsage,
  KnowledgeBaseOperation.addConnector,
  KnowledgeBaseOperation.updateConnector,
  KnowledgeBaseOperation.deleteConnector,
  KnowledgeBaseOperation.syncConnector,
] as const

export const ManageCredentialOperation = {
  rename: 'rename',
  delete: 'delete',
} as const

export type ManageCredentialOperation =
  (typeof ManageCredentialOperation)[keyof typeof ManageCredentialOperation]

export const ManageCredentialOperationValues = [
  ManageCredentialOperation.rename,
  ManageCredentialOperation.delete,
] as const

export const ManageCustomToolOperation = {
  add: 'add',
  edit: 'edit',
  delete: 'delete',
  list: 'list',
} as const

export type ManageCustomToolOperation =
  (typeof ManageCustomToolOperation)[keyof typeof ManageCustomToolOperation]

export const ManageCustomToolOperationValues = [
  ManageCustomToolOperation.add,
  ManageCustomToolOperation.edit,
  ManageCustomToolOperation.delete,
  ManageCustomToolOperation.list,
] as const

export const ManageFolderOperation = {
  delete: 'delete',
} as const

export type ManageFolderOperation =
  (typeof ManageFolderOperation)[keyof typeof ManageFolderOperation]

export const ManageFolderOperationValues = [ManageFolderOperation.delete] as const

export const ManageMcpToolOperation = {
  add: 'add',
  edit: 'edit',
  delete: 'delete',
  list: 'list',
} as const

export type ManageMcpToolOperation =
  (typeof ManageMcpToolOperation)[keyof typeof ManageMcpToolOperation]

export const ManageMcpToolOperationValues = [
  ManageMcpToolOperation.add,
  ManageMcpToolOperation.edit,
  ManageMcpToolOperation.delete,
  ManageMcpToolOperation.list,
] as const

export const ManageScheduledTaskOperation = {
  create: 'create',
  list: 'list',
  get: 'get',
  update: 'update',
  delete: 'delete',
} as const

export type ManageScheduledTaskOperation =
  (typeof ManageScheduledTaskOperation)[keyof typeof ManageScheduledTaskOperation]

export const ManageScheduledTaskOperationValues = [
  ManageScheduledTaskOperation.create,
  ManageScheduledTaskOperation.list,
  ManageScheduledTaskOperation.get,
  ManageScheduledTaskOperation.update,
  ManageScheduledTaskOperation.delete,
] as const

export const ManageSkillOperation = {
  add: 'add',
  edit: 'edit',
  delete: 'delete',
  list: 'list',
} as const

export type ManageSkillOperation = (typeof ManageSkillOperation)[keyof typeof ManageSkillOperation]

export const ManageSkillOperationValues = [
  ManageSkillOperation.add,
  ManageSkillOperation.edit,
  ManageSkillOperation.delete,
  ManageSkillOperation.list,
] as const

export const MaterializeFileOperation = {
  save: 'save',
  import: 'import',
} as const

export type MaterializeFileOperation =
  (typeof MaterializeFileOperation)[keyof typeof MaterializeFileOperation]

export const MaterializeFileOperationValues = [
  MaterializeFileOperation.save,
  MaterializeFileOperation.import,
] as const

export const QueryUserTableOperation = {
  get: 'get',
  getSchema: 'get_schema',
  getRow: 'get_row',
  queryRows: 'query_rows',
} as const

export type QueryUserTableOperation =
  (typeof QueryUserTableOperation)[keyof typeof QueryUserTableOperation]

export const QueryUserTableOperationValues = [
  QueryUserTableOperation.get,
  QueryUserTableOperation.getSchema,
  QueryUserTableOperation.getRow,
  QueryUserTableOperation.queryRows,
] as const

export const SearchKnowledgeBaseOperation = {
  get: 'get',
  query: 'query',
  listTags: 'list_tags',
} as const

export type SearchKnowledgeBaseOperation =
  (typeof SearchKnowledgeBaseOperation)[keyof typeof SearchKnowledgeBaseOperation]

export const SearchKnowledgeBaseOperationValues = [
  SearchKnowledgeBaseOperation.get,
  SearchKnowledgeBaseOperation.query,
  SearchKnowledgeBaseOperation.listTags,
] as const

export const UserTableOperation = {
  create: 'create',
  createFromFile: 'create_from_file',
  importFile: 'import_file',
  get: 'get',
  getSchema: 'get_schema',
  delete: 'delete',
  rename: 'rename',
  insertRow: 'insert_row',
  batchInsertRows: 'batch_insert_rows',
  getRow: 'get_row',
  queryRows: 'query_rows',
  updateRow: 'update_row',
  deleteRow: 'delete_row',
  updateRowsByFilter: 'update_rows_by_filter',
  deleteRowsByFilter: 'delete_rows_by_filter',
  batchUpdateRows: 'batch_update_rows',
  batchDeleteRows: 'batch_delete_rows',
  addColumn: 'add_column',
  renameColumn: 'rename_column',
  deleteColumn: 'delete_column',
  updateColumn: 'update_column',
  addWorkflowGroup: 'add_workflow_group',
  updateWorkflowGroup: 'update_workflow_group',
  deleteWorkflowGroup: 'delete_workflow_group',
  addWorkflowGroupOutput: 'add_workflow_group_output',
  deleteWorkflowGroupOutput: 'delete_workflow_group_output',
  runColumn: 'run_column',
  cancelTableRuns: 'cancel_table_runs',
  listWorkflowOutputs: 'list_workflow_outputs',
  listEnrichments: 'list_enrichments',
  addEnrichment: 'add_enrichment',
} as const

export type UserTableOperation = (typeof UserTableOperation)[keyof typeof UserTableOperation]

export const UserTableOperationValues = [
  UserTableOperation.create,
  UserTableOperation.createFromFile,
  UserTableOperation.importFile,
  UserTableOperation.get,
  UserTableOperation.getSchema,
  UserTableOperation.delete,
  UserTableOperation.rename,
  UserTableOperation.insertRow,
  UserTableOperation.batchInsertRows,
  UserTableOperation.getRow,
  UserTableOperation.queryRows,
  UserTableOperation.updateRow,
  UserTableOperation.deleteRow,
  UserTableOperation.updateRowsByFilter,
  UserTableOperation.deleteRowsByFilter,
  UserTableOperation.batchUpdateRows,
  UserTableOperation.batchDeleteRows,
  UserTableOperation.addColumn,
  UserTableOperation.renameColumn,
  UserTableOperation.deleteColumn,
  UserTableOperation.updateColumn,
  UserTableOperation.addWorkflowGroup,
  UserTableOperation.updateWorkflowGroup,
  UserTableOperation.deleteWorkflowGroup,
  UserTableOperation.addWorkflowGroupOutput,
  UserTableOperation.deleteWorkflowGroupOutput,
  UserTableOperation.runColumn,
  UserTableOperation.cancelTableRuns,
  UserTableOperation.listWorkflowOutputs,
  UserTableOperation.listEnrichments,
  UserTableOperation.addEnrichment,
] as const

export const WorkspaceFileOperation = {
  append: 'append',
  update: 'update',
  patch: 'patch',
} as const

export type WorkspaceFileOperation =
  (typeof WorkspaceFileOperation)[keyof typeof WorkspaceFileOperation]

export const WorkspaceFileOperationValues = [
  WorkspaceFileOperation.append,
  WorkspaceFileOperation.update,
  WorkspaceFileOperation.patch,
] as const

export const TOOL_CATALOG: Record<string, ToolCatalogEntry> = {
  [Agent.id]: Agent,
  [Auth.id]: Auth,
  [Browser.id]: Browser,
  [BrowserClick.id]: BrowserClick,
  [BrowserCloseTab.id]: BrowserCloseTab,
  [BrowserExtract.id]: BrowserExtract,
  [BrowserGoBack.id]: BrowserGoBack,
  [BrowserGoForward.id]: BrowserGoForward,
  [BrowserHover.id]: BrowserHover,
  [BrowserListSessions.id]: BrowserListSessions,
  [BrowserListTabs.id]: BrowserListTabs,
  [BrowserNavigate.id]: BrowserNavigate,
  [BrowserOpenTab.id]: BrowserOpenTab,
  [BrowserPressKey.id]: BrowserPressKey,
  [BrowserReadText.id]: BrowserReadText,
  [BrowserRequestTakeover.id]: BrowserRequestTakeover,
  [BrowserScreenshot.id]: BrowserScreenshot,
  [BrowserScroll.id]: BrowserScroll,
  [BrowserSelectOption.id]: BrowserSelectOption,
  [BrowserSnapshot.id]: BrowserSnapshot,
  [BrowserSwitchTab.id]: BrowserSwitchTab,
  [BrowserType.id]: BrowserType,
  [BrowserWaitFor.id]: BrowserWaitFor,
  [CallIntegrationTool.id]: CallIntegrationTool,
  [CheckDeploymentStatus.id]: CheckDeploymentStatus,
  [CompleteScheduledTask.id]: CompleteScheduledTask,
  [Cp.id]: Cp,
  [CrawlWebsite.id]: CrawlWebsite,
  [CreateFile.id]: CreateFile,
  [CreateWorkflow.id]: CreateWorkflow,
  [CreateWorkspaceMcpServer.id]: CreateWorkspaceMcpServer,
  [DeleteFile.id]: DeleteFile,
  [DeleteFileFolder.id]: DeleteFileFolder,
  [DeleteWorkflow.id]: DeleteWorkflow,
  [DeleteWorkspaceMcpServer.id]: DeleteWorkspaceMcpServer,
  [Deploy.id]: Deploy,
  [DeployApi.id]: DeployApi,
  [DeployChat.id]: DeployChat,
  [DeployCustomBlock.id]: DeployCustomBlock,
  [DeployMcp.id]: DeployMcp,
  [DiffWorkflows.id]: DiffWorkflows,
  [DownloadToWorkspaceFile.id]: DownloadToWorkspaceFile,
  [EditContent.id]: EditContent,
  [EditWorkflow.id]: EditWorkflow,
  [EnrichmentRun.id]: EnrichmentRun,
  [Ffmpeg.id]: Ffmpeg,
  [File.id]: File,
  [FunctionExecute.id]: FunctionExecute,
  [GenerateApiKey.id]: GenerateApiKey,
  [GenerateAudio.id]: GenerateAudio,
  [GenerateImage.id]: GenerateImage,
  [GenerateVideo.id]: GenerateVideo,
  [GetBlockOutputs.id]: GetBlockOutputs,
  [GetBlockUpstreamReferences.id]: GetBlockUpstreamReferences,
  [GetDeployedWorkflowState.id]: GetDeployedWorkflowState,
  [GetDeploymentLog.id]: GetDeploymentLog,
  [GetPageContents.id]: GetPageContents,
  [GetPlatformActions.id]: GetPlatformActions,
  [GetScheduledTaskLogs.id]: GetScheduledTaskLogs,
  [GetWorkflowData.id]: GetWorkflowData,
  [GetWorkflowRunOptions.id]: GetWorkflowRunOptions,
  [Glob.id]: Glob,
  [Grep.id]: Grep,
  [Knowledge.id]: Knowledge,
  [KnowledgeBase.id]: KnowledgeBase,
  [ListIntegrationTools.id]: ListIntegrationTools,
  [ListUserWorkspaces.id]: ListUserWorkspaces,
  [ListWorkspaceMcpServers.id]: ListWorkspaceMcpServers,
  [LoadDeployment.id]: LoadDeployment,
  [LoadIntegrationTool.id]: LoadIntegrationTool,
  [ManageCredential.id]: ManageCredential,
  [ManageCustomTool.id]: ManageCustomTool,
  [ManageFolder.id]: ManageFolder,
  [ManageMcpTool.id]: ManageMcpTool,
  [ManageScheduledTask.id]: ManageScheduledTask,
  [ManageSkill.id]: ManageSkill,
  [MaterializeFile.id]: MaterializeFile,
  [Media.id]: Media,
  [Mkdir.id]: Mkdir,
  [Mv.id]: Mv,
  [OauthGetAuthLink.id]: OauthGetAuthLink,
  [OauthRequestAccess.id]: OauthRequestAccess,
  [OpenResource.id]: OpenResource,
  [PromoteToLive.id]: PromoteToLive,
  [QueryLogs.id]: QueryLogs,
  [QueryUserTable.id]: QueryUserTable,
  [Read.id]: Read,
  [Redeploy.id]: Redeploy,
  [Respond.id]: Respond,
  [RestoreResource.id]: RestoreResource,
  [Run.id]: Run,
  [RunBlock.id]: RunBlock,
  [RunCode.id]: RunCode,
  [RunFromBlock.id]: RunFromBlock,
  [RunWorkflow.id]: RunWorkflow,
  [RunWorkflowUntilBlock.id]: RunWorkflowUntilBlock,
  [ScheduledTask.id]: ScheduledTask,
  [ScrapePage.id]: ScrapePage,
  [Search.id]: Search,
  [SearchDocs.id]: SearchDocs,
  [SearchIntegrationTools.id]: SearchIntegrationTools,
  [SearchKnowledgeBase.id]: SearchKnowledgeBase,
  [SearchLibraryDocs.id]: SearchLibraryDocs,
  [SearchOnline.id]: SearchOnline,
  [SearchPatterns.id]: SearchPatterns,
  [SetBlockEnabled.id]: SetBlockEnabled,
  [SetEnvironmentVariables.id]: SetEnvironmentVariables,
  [SetGlobalWorkflowVariables.id]: SetGlobalWorkflowVariables,
  [Table.id]: Table,
  [UpdateDeploymentVersion.id]: UpdateDeploymentVersion,
  [UpdateScheduledTaskHistory.id]: UpdateScheduledTaskHistory,
  [UpdateWorkspaceMcpServer.id]: UpdateWorkspaceMcpServer,
  [UserTable.id]: UserTable,
  [Workflow.id]: Workflow,
  [WorkspaceFile.id]: WorkspaceFile,
}
