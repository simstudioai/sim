interface OperationActivity {
  label: string
  parameter: 'operation' | 'action'
  defaultOperation?: string
  operations: Readonly<Record<string, string>>
}

const DEPLOYMENT_ACTIVITY: OperationActivity = {
  label: 'used deployments',
  parameter: 'action',
  defaultOperation: 'deploy',
  operations: { deploy: 'deployed workflows', undeploy: 'undeployed workflows' },
}

const QUERY_USER_TABLE_OPERATIONS = {
  get: 'read tables',
  get_schema: 'read tables',
  get_row: 'read rows',
  query_rows: 'searched rows',
} as const

const TABLE_MANAGE_OPERATIONS = {
  create: 'created tables',
  create_from_file: 'created tables',
  import_file: 'imported table data',
  rename: 'renamed tables',
} as const

const TABLE_ROWS_OPERATIONS = {
  insert_row: 'added rows',
  batch_insert_rows: 'added rows',
  update_row: 'updated rows',
  batch_update_rows: 'updated rows',
  delete_row: 'deleted rows',
  batch_delete_rows: 'deleted rows',
  update_rows_by_filter: 'updated rows',
  delete_rows_by_filter: 'deleted rows',
} as const

const TABLE_COLUMNS_OPERATIONS = {
  add_column: 'edited table columns',
  rename_column: 'edited table columns',
  delete_column: 'edited table columns',
  update_column: 'edited table columns',
} as const

const TABLE_AUTOMATIONS_OPERATIONS = {
  list_workflow_outputs: 'read table automations',
  add_workflow_group: 'edited table automations',
  update_workflow_group: 'edited table automations',
  delete_workflow_group: 'edited table automations',
  add_workflow_group_output: 'edited table automations',
  delete_workflow_group_output: 'edited table automations',
  run_column: 'ran table automations',
  cancel_table_runs: 'stopped table runs',
} as const

const TABLE_ENRICHMENTS_OPERATIONS = {
  list_enrichments: 'read table enrichments',
  add_enrichment: 'configured enrichments',
} as const

/** Client-owned summaries; the executable tool registry stays outside the UI bundle. */
export const TOOL_ACTIVITIES: Readonly<Record<string, string | OperationActivity>> = {
  apply_file_edit: 'edited files',
  browser_click: 'clicked elements',
  browser_click_at: 'clicked elements',
  browser_close_tab: 'closed tabs',
  browser_drag: 'dragged elements',
  browser_extract: 'read pages',
  browser_fill_form: 'filled forms',
  browser_find: 'searched pages',
  browser_go_back: 'navigated pages',
  browser_go_forward: 'navigated pages',
  browser_hover: 'hovered over elements',
  browser_insert_text: 'entered text',
  browser_list_downloads: 'listed downloads',
  browser_list_sessions: 'checked signed-in sites',
  browser_list_tabs: 'listed tabs',
  browser_navigate: 'navigated pages',
  browser_open_tab: 'opened tabs',
  browser_open_url: 'navigated pages',
  browser_press_key: 'pressed keys',
  browser_read_text: 'read pages',
  browser_reload: 'navigated pages',
  browser_request_takeover: 'resumed browser control',
  browser_screenshot: 'captured screenshots',
  browser_scroll: 'scrolled pages',
  browser_select_option: 'selected options',
  browser_set_checked: 'updated selections',
  browser_snapshot: 'read pages',
  browser_switch_tab: 'switched tabs',
  browser_type: 'entered text',
  browser_wait_for: 'waited',
  browser_zoom: {
    label: 'adjusted page zoom',
    parameter: 'action',
    operations: {
      in: 'adjusted page zoom',
      out: 'adjusted page zoom',
      reset: 'adjusted page zoom',
    },
  },
  call_integration_tool: 'used integrations',
  cancel_workflow_run: 'stopped workflow runs',
  connect_slack_bot: 'connected integrations',
  cp: 'copied resources',
  create_empty_file: 'created files',
  create_workflow: 'created workflows',
  create_workspace_mcp_server: 'created MCP servers',
  delete_workspace_mcp_server: 'deleted MCP servers',
  deploy_as_api: DEPLOYMENT_ACTIVITY,
  deploy_as_chat: DEPLOYMENT_ACTIVITY,
  deploy_as_mcp: DEPLOYMENT_ACTIVITY,
  diff_workflows: 'compared workflows',
  download_file: 'downloaded files',
  edit_workflow: 'edited workflows',
  extract_doc_assets: 'extracted document assets',
  ffmpeg: {
    label: 'used media tools',
    parameter: 'operation',
    operations: {
      overlay_audio: 'edited media',
      mix_audio: 'edited media',
      concat: 'edited media',
      trim: 'edited media',
      scale_pad: 'edited media',
      overlay_image: 'edited media',
      add_text: 'edited media',
      fade: 'edited media',
      extract_audio: 'edited media',
      convert: 'edited media',
      thumbnail: 'edited media',
      probe: 'inspected media',
    },
  },
  generate_api_key: 'created API keys',
  generate_audio: 'generated audio',
  generate_image: 'generated images',
  generate_video: 'generated video',
  get_block_outputs: 'read workflow outputs',
  get_block_upstream_references: 'read workflows',
  get_deployed_workflow_state: 'read deployments',
  get_deployment_status: 'read deployments',
  get_workflow_data: 'read workflows',
  get_workflow_run_options: 'read workflows',
  glob: 'found files',
  grep: 'searched files',
  interrupt_agent: 'stopped agents',
  list_deployment_versions: 'read deployments',
  list_integration_tools: 'read integration tools',
  list_integrations: 'read integrations',
  list_workspace_mcp_servers: 'read MCP servers',
  load_deployment: 'loaded workflow versions',
  manage_credential: {
    label: 'managed credentials',
    parameter: 'operation',
    operations: {
      rename: 'renamed credentials',
      delete: 'deleted credentials',
    },
  },
  manage_custom_tool: {
    label: 'managed custom tools',
    parameter: 'operation',
    operations: {
      add: 'created custom tools',
      edit: 'edited custom tools',
      delete: 'deleted custom tools',
      list: 'read custom tools',
    },
  },
  manage_knowledge_base: {
    label: 'used knowledge bases',
    parameter: 'operation',
    operations: {
      create: 'created knowledge bases',
      get: 'read knowledge bases',
      query: 'searched sources',
      add_file: 'added source documents',
      update: 'updated knowledge bases',
      delete_document: 'deleted source documents',
      update_document: 'updated source documents',
      list_tags: 'read source tags',
      create_tag: 'edited source tags',
      update_tag: 'edited source tags',
      delete_tag: 'edited source tags',
      get_tag_usage: 'read source tags',
      add_connector: 'created connections',
      update_connector: 'edited connections',
      delete_connector: 'deleted connections',
      sync_connector: 'synced sources',
    },
  },
  manage_mcp_connection: {
    label: 'managed connections',
    parameter: 'operation',
    operations: {
      add: 'created connections',
      edit: 'edited connections',
      delete: 'deleted connections',
      list: 'read connections',
    },
  },
  manage_sandbox: {
    label: 'managed sandboxes',
    parameter: 'operation',
    operations: {
      add: 'created sandboxes',
      edit: 'edited sandboxes',
      delete: 'deleted sandboxes',
      list: 'read sandboxes',
    },
  },
  manage_skill: {
    label: 'managed skills',
    parameter: 'operation',
    operations: {
      add: 'created skills',
      edit: 'edited skills',
      delete: 'deleted skills',
      list: 'read skills',
    },
  },
  mkdir: 'created folders',
  mv: 'moved resources',
  oauth_get_auth_link: 'prepared sign-in links',
  oauth_request_access: 'requested access',
  open_resource: 'opened resources',
  prepare_file_edit: {
    label: 'prepared file edits',
    parameter: 'operation',
    operations: {
      append: 'prepared file edits',
      update: 'prepared file edits',
      patch: 'prepared file edits',
    },
  },
  promote_to_live: 'deployed workflows',
  publish_custom_block: {
    label: 'managed custom blocks',
    parameter: 'action',
    defaultOperation: 'deploy',
    operations: {
      deploy: 'published custom blocks',
      undeploy: 'unpublished custom blocks',
    },
  },
  query_logs: 'read logs',
  query_user_table: {
    label: 'read tables',
    parameter: 'operation',
    operations: QUERY_USER_TABLE_OPERATIONS,
  },
  read: 'read files',
  read_document: 'read documents',
  redeploy: 'deployed workflows',
  restore_resource: 'restored resources',
  rm: 'deleted resources',
  run_block: 'ran workflows',
  run_code: 'ran code',
  run_enrichment: 'ran enrichments',
  run_from_block: 'ran workflows',
  run_function: 'ran code',
  run_workflow: 'ran workflows',
  run_workflow_until_block: 'ran workflows',
  save_upload: {
    label: 'used uploaded files',
    parameter: 'operation',
    defaultOperation: 'save',
    operations: {
      save: 'saved files',
      import: 'imported workflows',
      extract: 'extracted files',
    },
  },
  search_docs: 'read documentation',
  search_knowledge_base: {
    label: 'searched sources',
    parameter: 'operation',
    operations: {
      get: 'read knowledge bases',
      query: 'searched sources',
      list_tags: 'read source tags',
    },
  },
  search_library_docs: 'read documentation',
  search_workspace: 'searched the workspace',
  set_block_enabled: 'edited workflows',
  set_environment_variables: 'updated environment variables',
  set_global_workflow_variables: 'updated workflow variables',
  share_file: {
    label: 'managed file sharing',
    parameter: 'action',
    defaultOperation: 'share',
    operations: {
      share: 'shared files',
      unshare: 'stopped sharing files',
    },
  },
  steer_agent: 'guided agents',
  table_automations: {
    label: 'used table automations',
    parameter: 'operation',
    operations: TABLE_AUTOMATIONS_OPERATIONS,
  },
  table_columns: {
    label: 'used table columns',
    parameter: 'operation',
    operations: TABLE_COLUMNS_OPERATIONS,
  },
  table_enrichments: {
    label: 'used table enrichments',
    parameter: 'operation',
    operations: TABLE_ENRICHMENTS_OPERATIONS,
  },
  table_manage: {
    label: 'used tables',
    parameter: 'operation',
    operations: TABLE_MANAGE_OPERATIONS,
  },
  table_rows: {
    label: 'used tables',
    parameter: 'operation',
    operations: TABLE_ROWS_OPERATIONS,
  },
  table_views: {
    label: 'used table views',
    parameter: 'operation',
    operations: {
      list_views: 'read table views',
      get_view: 'read table views',
      create_view: 'edited table views',
      update_view: 'edited table views',
      delete_view: 'edited table views',
      set_default_view: 'edited table views',
    },
  },
  tail_agent: 'read agent progress',
  terminal: {
    label: 'used the terminal',
    parameter: 'operation',
    operations: {
      run: 'ran commands',
      read: 'read terminal output',
      input: 'sent terminal input',
      kill: 'stopped commands',
      cwd: 'checked terminal locations',
      list: 'listed terminals',
      new: 'opened terminals',
      switch: 'switched terminals',
      close: 'closed terminals',
      panes: 'listed terminal panes',
      handoff: 'handed over terminal control',
    },
  },
  terminal_cwd: 'checked terminal locations',
  terminal_input: 'sent terminal input',
  terminal_kill: 'stopped commands',
  terminal_read: 'read terminal output',
  terminal_run: 'ran commands',
  update_deployment_version: 'updated deployment details',
  update_workspace_mcp_server: 'updated MCP servers',
  user_table: {
    label: 'used tables',
    parameter: 'operation',
    operations: {
      ...QUERY_USER_TABLE_OPERATIONS,
      ...TABLE_MANAGE_OPERATIONS,
      ...TABLE_ROWS_OPERATIONS,
      ...TABLE_COLUMNS_OPERATIONS,
      ...TABLE_AUTOMATIONS_OPERATIONS,
      ...TABLE_ENRICHMENTS_OPERATIONS,
    },
  },
  wait: 'waited',
  wait_agents: 'waited',
  web_crawl: 'read web pages',
  web_fetch: 'read web pages',
  web_scrape: 'read web pages',
  web_search: 'searched the web',
}

/** Unknown tools and operations retain a neutral summary for historical/custom calls. */
export function getToolActivityLabel(toolName: string, params?: Record<string, unknown>): string {
  const activity = Object.hasOwn(TOOL_ACTIVITIES, toolName) ? TOOL_ACTIVITIES[toolName] : undefined
  if (!activity) return toolName.startsWith('browser_') ? 'used the browser' : 'used tools'
  if (typeof activity === 'string') return activity
  const suppliedOperation = params?.[activity.parameter]
  const operation = suppliedOperation === undefined ? activity.defaultOperation : suppliedOperation
  return typeof operation === 'string' && Object.hasOwn(activity.operations, operation)
    ? activity.operations[operation]
    : activity.label
}
