import { isRecordLike } from '@sim/utils/object'
import { ToolActivity } from '@/lib/mothership/generated/protocol'
import {
  firstWordOf,
  getToolCompletedTitle,
  getToolDisplayTitle,
  getToolStatusDisplayTitle,
} from '@/lib/mothership/tools/tool-display'

/** One provider-independent activity shape for both parsed and still-streaming calls. */
export function readToolActivity(
  params?: Record<string, unknown>,
  streamingArgs?: string
): ToolActivity | undefined {
  const activity = params?.activity
  if (isRecordLike(activity)) {
    const parsed = ToolActivity.safeParse(activity)
    return parsed.success ? parsed.data : undefined
  }
  if (!streamingArgs) return undefined
  let depth = 0
  let quoted = false
  let escaped = false
  let stringStart = 0
  let offset: number | undefined
  for (let index = 0; index < streamingArgs.length; index++) {
    const char = streamingArgs[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (quoted && char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      if (!quoted) stringStart = index
      else if (depth === 1 && streamingArgs.slice(stringStart, index + 1) === '"activity"') {
        const objectStart = /^\s*:\s*\{/.exec(streamingArgs.slice(index + 1))
        if (objectStart) offset = index + objectStart[0].length
      }
      quoted = !quoted
      continue
    }
    if (quoted) continue
    if (char === '{' || char === '[') depth++
    if (char === '}' || char === ']') depth--
    if (offset === undefined || char !== '}' || depth !== 1) continue
    try {
      const parsed = ToolActivity.safeParse(JSON.parse(streamingArgs.slice(offset, index + 1)))
      return parsed.success ? parsed.data : undefined
    } catch {
      return undefined
    }
  }
  return undefined
}

/** Two actions on one object, so adjacent summary phrases can share it ("listed, read tables"). */
interface SharedObjectActivity {
  verb: string
  object: string
}

type ActivityPhrase = string | SharedObjectActivity

/** A tool whose action depends on one enumerated argument. */
interface OperationActivity {
  label: string
  parameter: 'operation' | 'action'
  defaultOperation?: string
  operations: Readonly<Record<string, ActivityPhrase>>
}

const PAGE_NAVIGATION = {
  verb: 'navigated',
  object: 'pages',
} as const satisfies SharedObjectActivity
const PAGE_READING = { verb: 'read', object: 'pages' } as const satisfies SharedObjectActivity
const PAGE_SEARCHING = { verb: 'searched', object: 'pages' } as const satisfies SharedObjectActivity
const PAGE_SCROLLING = { verb: 'scrolled', object: 'pages' } as const satisfies SharedObjectActivity

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

/**
 * Client-owned action phrases for completed-activity summaries, keyed by tool
 * name; the executable tool registry stays outside the UI bundle. Phrases are
 * past tense so several of them read as one sentence. Named `sim_cli` commands
 * (`cli_<command path>`) resolve through {@link CLI_ACTIVITY_OVERRIDES} and
 * {@link CLI_ACTIVITY_OBJECTS}; a command not yet named keeps its own title.
 */
export const TOOL_ACTIVITIES: Readonly<Record<string, ActivityPhrase | OperationActivity>> = {
  apply_file_edit: 'edited files',
  browser_batch: 'ran page actions',
  browser_click: 'clicked elements',
  browser_click_at: 'clicked elements',
  browser_close_tab: 'closed tabs',
  browser_drag: 'dragged elements',
  browser_extract: PAGE_READING,
  browser_fill_form: 'filled forms',
  browser_find: PAGE_SEARCHING,
  browser_go_back: PAGE_NAVIGATION,
  browser_go_forward: PAGE_NAVIGATION,
  browser_hover: 'hovered over elements',
  browser_insert_text: 'entered text',
  browser_list_downloads: 'listed downloads',
  browser_list_sessions: 'checked signed-in sites',
  browser_list_tabs: 'listed tabs',
  browser_navigate: PAGE_NAVIGATION,
  browser_open_tab: 'opened tabs',
  browser_open_url: PAGE_NAVIGATION,
  browser_press_key: 'pressed keys',
  browser_read_text: PAGE_READING,
  browser_reload: PAGE_NAVIGATION,
  browser_request_takeover: 'resumed browser control',
  browser_save_download: 'saved downloads',
  browser_screenshot: 'captured screenshots',
  browser_scroll: PAGE_SCROLLING,
  browser_select_option: 'selected options',
  browser_set_checked: 'updated selections',
  browser_snapshot: PAGE_READING,
  browser_switch_tab: 'switched tabs',
  browser_type: 'entered text',
  browser_upload_file: 'uploaded files',
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
  cli_help: 'read the CLI reference',
  connect_slack_bot: 'connected integrations',
  context_compaction: 'summarized context',
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
  import_local_files: 'imported local files',
  interrupt_agent: 'stopped agents',
  list_deployment_versions: 'read deployments',
  list_integration_tools: 'read integration tools',
  list_integrations: 'read integrations',
  list_workspace_mcp_servers: 'read MCP servers',
  list_workspaces: { verb: 'listed', object: 'workspaces' },
  load_deployment: 'loaded workflow versions',
  load_integration_tool: 'loaded integration tools',
  load_skill: 'loaded skills',
  load_slide_layout: 'loaded slide layouts',
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
      create: 'prepared file edits',
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
  read_local_file: 'read local files',
  read_output: 'read tool outputs',
  redeploy: 'deployed workflows',
  remember: 'updated memory',
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
  search_integration_tools: 'found integrations',
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
  search_sources: {
    label: 'checked search sources',
    parameter: 'action',
    operations: {
      list: 'read search sources',
      get: 'read search sources',
      providers: 'read search sources',
      setup: 'set up search sources',
      approve: 'updated search sources',
    },
  },
  search_workspace: 'searched the workspace',
  set_block_enabled: 'edited workflows',
  set_environment_variables: 'updated environment variables',
  set_global_workflow_variables: 'updated workflow variables',
  settings: {
    label: 'checked settings',
    parameter: 'action',
    operations: {
      list: { verb: 'read', object: 'settings' },
      get: { verb: 'read', object: 'settings' },
      describe: { verb: 'read', object: 'settings' },
      open: { verb: 'opened', object: 'settings' },
      update: { verb: 'updated', object: 'settings' },
      execute: { verb: 'updated', object: 'settings' },
    },
  },
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
  task: 'delegated tasks',
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
  workspaces: { verb: 'created', object: 'workspaces' },
}

/**
 * CLI commands whose action is not "<command verb> <resource>": guidance and
 * search helpers, connection links, verbs that need a particle, `mkdir`
 * (which creates a folder of its resource kind, not the resource itself), and
 * `tables upsert` (which inserts a row or updates the one it conflicts with).
 */
const CLI_ACTIVITY_OVERRIDES: Readonly<Record<string, ActivityPhrase>> = {
  cli_credentials_connect: 'created connection links',
  cli_credentials_reconnect: 'created connection links',
  cli_docs_search: 'searched Sim docs',
  cli_files_mkdir: { verb: 'created', object: 'file folders' },
  cli_knowledge_mkdir: { verb: 'created', object: 'knowledge folders' },
  cli_tables_mkdir: { verb: 'created', object: 'table folders' },
  cli_tables_upsert: { verb: 'wrote', object: 'table rows' },
  cli_workflows_mkdir: { verb: 'created', object: 'workflow folders' },
  cli_grep: 'searched the workspace',
  cli_integrations_list: 'found integration actions',
  cli_knowledge_tags_cleanup: 'cleaned up knowledge tags',
  cli_reference: 'read the CLI reference',
  cli_search_query: 'searched the workspace',
  cli_search_read: 'read documents',
  cli_to_sandbox: 'saved results',
  cli_workflows_rollback: 'rolled back workflows',
  cli_workflows_runs_wait: 'waited for workflow runs',
}

/**
 * Plural resource named by a `cli_<command path>` tool, keyed by command-path
 * prefix; the longest matching prefix wins. The verb comes from the command's
 * own display title, so every CLI command shares one resource vocabulary.
 */
const CLI_ACTIVITY_OBJECTS: Readonly<Record<string, string>> = {
  audit_logs: 'audit logs',
  billing_logs: 'billing logs',
  billing_status: 'billing status',
  blocks: 'blocks',
  chat_deployments: 'chat deployments',
  connector_types: 'connector types',
  credentials: 'credentials',
  credentials_providers: 'credential providers',
  custom_tools: 'custom tools',
  files: 'files',
  files_folders: 'file folders',
  files_share: 'file sharing',
  knowledge: 'knowledge bases',
  knowledge_chunks: 'knowledge chunks',
  knowledge_connectors: 'knowledge connectors',
  knowledge_connectors_documents: 'connector documents',
  knowledge_documents: 'documents',
  knowledge_folders: 'knowledge folders',
  knowledge_tags: 'knowledge tags',
  logs: 'run logs',
  mcp_servers: 'MCP servers',
  mcp_servers_tools: 'MCP server tools',
  meta: 'platform status',
  outputs: 'tool outputs',
  search_sources: 'search sources',
  secrets: 'secrets',
  settings: 'settings',
  skills: 'skills',
  skills_editors: 'skill editors',
  tables: 'tables',
  tables_cancel_runs: 'table runs',
  tables_columns: 'table columns',
  tables_dispatches: 'table runs',
  tables_enrichment: 'enrichment runs',
  tables_exports: 'table exports',
  tables_folders: 'table folders',
  tables_groups: 'workflow groups',
  tables_imports: 'table imports',
  tables_rows: 'table rows',
  tables_views: 'table views',
  tools: 'integration operations',
  workflow: 'workflows',
  workflow_blocks: 'workflow blocks',
  workflow_deps: 'workflow inputs',
  workflow_mcp_servers: 'workflow MCP servers',
  workflow_mcp_servers_tools: 'workflow MCP tools',
  workflow_trace: 'run traces',
  workflows: 'workflows',
  workflows_activate: 'workflow versions',
  workflows_chat: 'chat deployments',
  workflows_deployment: 'deployments',
  workflows_deps: 'workflow inputs',
  workflows_folders: 'workflow folders',
  workflows_runs: 'workflow runs',
  workflows_variables: 'workflow variables',
  workflows_versions: 'workflow versions',
  workspaces: 'workspaces',
  workspaces_members: 'workspace members',
}

const CLI_ACTIVITY_PREFIXES = Object.keys(CLI_ACTIVITY_OBJECTS).sort(
  (left, right) => right.length - left.length
)

/** A `sim_cli` command reads as "<past command verb> <resource>", e.g. "listed tables". */
function resolveCliActivity(toolName: string): ActivityPhrase | undefined {
  if (Object.hasOwn(CLI_ACTIVITY_OVERRIDES, toolName)) return CLI_ACTIVITY_OVERRIDES[toolName]
  if (!toolName.startsWith('cli_')) return undefined
  const path = toolName.slice('cli_'.length)
  const prefix = CLI_ACTIVITY_PREFIXES.find((key) => path === key || path.startsWith(`${key}_`))
  if (!prefix) return undefined
  const verb = getToolCompletedTitle(firstWordOf(getToolDisplayTitle(toolName)))
  return verb ? { verb: verb.toLowerCase(), object: CLI_ACTIVITY_OBJECTS[prefix] } : undefined
}

/** Sentence-case a title for use mid-summary without lowercasing a leading acronym. */
function toPhraseCase(title: string): string {
  return /^[A-Z][a-z]/.test(title) ? title.charAt(0).toLowerCase() + title.slice(1) : title
}

interface ToolActivitySubject {
  toolName: string
  params?: Record<string, unknown>
  /** Titles a call the catalog does not know, such as custom and MCP tools. */
  displayTitle?: string
  activityDescription?: string
}

/**
 * One call's action phrase: its catalog phrase (an unknown operation falls back to
 * the tool's label), else its `sim_cli` resource phrase, else a phrase from its own
 * completed title, else a neutral summary.
 */
function resolveToolActivity({
  toolName,
  params,
  displayTitle,
  activityDescription,
}: ToolActivitySubject): ActivityPhrase {
  const activity = Object.hasOwn(TOOL_ACTIVITIES, toolName) ? TOOL_ACTIVITIES[toolName] : undefined
  if (typeof activity === 'string' || (activity && 'verb' in activity)) return activity
  if (activity) {
    const suppliedOperation = params?.[activity.parameter]
    const operation =
      suppliedOperation === undefined ? activity.defaultOperation : suppliedOperation
    return typeof operation === 'string' && Object.hasOwn(activity.operations, operation)
      ? activity.operations[operation]
      : activity.label
  }
  const cliActivity = resolveCliActivity(toolName)
  if (cliActivity) return cliActivity
  const title = displayTitle?.trim()
    ? getToolStatusDisplayTitle(displayTitle, 'success', toolName, activityDescription)
    : ''
  if (title) return toPhraseCase(title)
  return toolName.startsWith('browser_') ? 'used the browser' : 'used tools'
}

function activityLabel(activity: ActivityPhrase): string {
  return typeof activity === 'string' ? activity : `${activity.verb} ${activity.object}`
}

/**
 * Up to `limit` distinct action phrases for a finished activity's successful
 * calls, e.g. `["navigated", "read pages", "clicked elements"]`.
 *
 * Phrases are chosen by first occurrence in transcript order, so the summary
 * reads in the order the work happened and stays stable across replays and as
 * more calls finish. Repeated actions collapse into one phrase, so a long run of one kind
 * of call cannot crowd out the other kinds. Adjacent chosen phrases that act on
 * the same object share it, compacted after the cap so the object stays visible.
 */
export function getToolActivitySummaryActions(
  tools: ReadonlyArray<ToolActivitySubject>,
  limit: number
): string[] {
  const unique = new Map<string, ActivityPhrase>()
  for (const tool of tools) {
    const activity = resolveToolActivity(tool)
    const label = activityLabel(activity)
    if (!unique.has(label)) unique.set(label, activity)
    if (unique.size === limit) break
  }
  const visible = [...unique.values()]
  return visible.map((activity, index) => {
    const next = visible[index + 1]
    return typeof activity !== 'string' &&
      typeof next !== 'string' &&
      next?.object === activity.object
      ? activity.verb
      : activityLabel(activity)
  })
}
