import { isRecordLike } from '@sim/utils/object'
import { stripVersionSuffix, truncate } from '@sim/utils/string'

/**
 * Single source of truth for copilot tool-call display titles.
 *
 * The mothership (Go) no longer emits any presentation metadata on the stream —
 * tool-call titles are derived entirely here, keyed by tool name (plus arguments
 * for the dynamic cases). The live client render layer (see
 * `home/hooks/stream/stream-helpers.ts`) wraps this with workspace/block-name
 * enrichment for the run_* tools; every other surface (server persistence,
 * transcript replay, fallback rendering) calls `getToolDisplayTitle` directly.
 *
 * Icons are likewise client-owned — see `getAgentIcon` in the message-content
 * utils. Nothing about tool presentation lives on the Go side anymore.
 */

type ToolArgs = Record<string, unknown> | undefined

export const CONTEXT_COMPACTION_DISPLAY_TITLE = 'Summarizing context'

/**
 * A machine id never belongs in a human title ("Running
 * 5bae7849-ffa5-4f57-984f-feab73e513df"). Matches the UUIDs `generateId()`
 * mints, in dashed and bare-hex form — what leaks when a model passes a
 * workflow or block id where a name was expected, whether through an explicit
 * `*Id` fallback key or by putting the id in a `name` field.
 *
 * Deliberately narrow. A looser "looks random" rule would swallow legitimate
 * names like `GoogleSheets_v2Block`, and a wrong suppression is invisible while
 * a leaked id is merely ugly.
 */
const OPAQUE_ID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i

/**
 * Reads a display-safe string argument. Every title in this module goes through
 * here, so suppressing opaque ids once covers each call site — including ones
 * whose fallback list ends in `blockId`, which then degrades to the generic
 * label instead of printing a UUID.
 */
function stringArg(args: ToolArgs, key: string): string {
  const value = args?.[key]
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return OPAQUE_ID_PATTERN.test(trimmed) ? '' : trimmed
}

function firstStringArg(args: ToolArgs, ...keys: string[]): string {
  for (const key of keys) {
    const value = stringArg(args, key)
    if (value) return value
  }
  return ''
}

function stringArrayArg(args: ToolArgs, key: string): string[] {
  const value = args?.[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function nestedStringArg(args: ToolArgs, parentKey: string, ...keys: string[]): string {
  const parent = args?.[parentKey]
  if (!parent || typeof parent !== 'object') return ''
  return firstStringArg(parent as Record<string, unknown>, ...keys)
}

function recordArg(args: ToolArgs, key: string): Record<string, unknown> | undefined {
  const value = args?.[key]
  return isRecordLike(value) ? (value as Record<string, unknown>) : undefined
}

function stringOrNumberArg(args: ToolArgs, key: string): string {
  const value = args?.[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

/**
 * The verb tokens of a table operation id. Ids are verb_noun compounds —
 * `insert_row`, `batch_update_rows`, `delete_rows_by_filter`, `list_views` —
 * so a title matches the verb as a token; whole-id equality never fired in
 * production and every row write rendered as the generic "Editing rows".
 */
function operationVerbs(op: string): Set<string> {
  return new Set(op.split('_'))
}

/**
 * Titles for the split table tools: each names its own action, refined by the
 * operation and the named target when the args carry one — a card full of
 * table work should read as adds, updates, and wiring, never a wall of
 * identical "Queried table" rows.
 */
function splitTableTitle(name: string, args: ToolArgs): string {
  const op = stringArg(args, 'operation')
  const verbs = operationVerbs(op)
  const is = (...candidates: string[]) => candidates.some((verb) => verbs.has(verb))
  const target = firstStringArg(args, 'columnName', 'viewName', 'name', 'title')
  const suffix = target ? ` ${target}` : ''
  // "in Runtimes" / "of Runtimes" — enrichment resolves the nested tableId.
  const table = stringArg(args, 'tableName')
  const inTable = table ? ` in ${table}` : ''
  const ofTable = table ? ` of ${table}` : ''
  switch (name) {
    case 'table_manage':
      if (is('create')) return `Creating table${suffix || (table ? ` ${table}` : '')}`
      if (is('delete')) return `Deleting table${table ? ` ${table}` : suffix}`
      if (is('read', 'get', 'list')) return `Reading${table ? ` ${table}` : ' table'}`
      return `Updating${table ? ` ${table}` : ' table'}`
    case 'table_rows':
      if (is('insert', 'add', 'create')) return `Adding rows${inTable ? ` to ${table}` : ''}`
      if (is('update')) return `Updating rows${inTable}`
      if (is('delete')) return `Deleting rows${inTable}`
      if (is('read', 'get', 'list', 'query')) return `Reading rows${ofTable}`
      return `Editing rows${ofTable}`
    case 'table_columns':
      if (is('add', 'create')) return `Adding column${suffix}${inTable}`
      if (is('update')) return `Updating column${suffix}${inTable}`
      if (is('delete')) return `Deleting column${suffix}${inTable}`
      if (is('read', 'get', 'list')) return `Reading columns${ofTable}`
      return `Editing columns${ofTable}`
    case 'table_automations':
      if (is('read', 'get', 'list')) return `Reading automations${ofTable}`
      if (is('delete')) return `Removing automation${inTable}`
      return `Wiring automation${inTable}`
    case 'table_enrichments':
      if (is('read', 'get', 'list')) return `Reading enrichments${ofTable}`
      if (is('delete')) return `Removing enrichment${inTable}`
      return `Configuring enrichment${suffix}${inTable}`
    case 'table_views':
      if (is('create')) return `Creating view${suffix}${inTable}`
      if (is('delete')) return `Deleting view${suffix}${inTable}`
      if (is('read', 'get', 'list')) return `Reading views${ofTable}`
      return `Editing views${ofTable}`
    default:
      return `Updating${table ? ` ${table}` : ' table'}`
  }
}

function deploymentTitle(args: ToolArgs, deploymentType: string): string {
  const verb = stringArg(args, 'action') === 'undeploy' ? 'Undeploying' : 'Deploying'
  const workflow = firstStringArg(args, 'workflowName', 'name', 'title')
  return workflow ? `${verb} ${workflow} as ${deploymentType}` : `${verb} as ${deploymentType}`
}

function resourceTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    knowledgebase: 'knowledge base',
    file_folder: 'file folder',
    log: 'logs',
  }
  return labels[type] ?? type
}

interface OperationDisplay {
  verb: string
  resource: string
}

function namedOperationTitle(
  args: ToolArgs,
  target: string,
  placeholder: string,
  labels: Record<string, OperationDisplay>
): string {
  const operation = stringArg(args, 'operation')
  const display = labels[operation]
  return display ? `${display.verb} ${target || display.resource}` : placeholder
}

/** Compact form of a URL for titles: host + path, no scheme/query noise. */
function displayUrl(raw: string): string {
  if (!raw) return ''
  try {
    const url = new URL(raw)
    const path = url.pathname === '/' ? '' : url.pathname
    return `${url.host}${path}`.slice(0, 80)
  } catch {
    return raw.slice(0, 80)
  }
}

/**
 * Human name for a block type id: strip the version suffix and title-case the
 * snake_case stem (`slack_v2` -> `Slack`, `google_sheets_v2` -> `Google Sheets`).
 */
export function blockDisplayName(blockType: string): string {
  const stem = stripVersionSuffix(blockType.trim())
  if (!stem) return blockType
  return stem
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** Ellipsizes the middle so both ends of a value stay recognizable. */
function truncateMiddle(value: string, maxChars: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length <= maxChars) return text
  const head = Math.ceil((maxChars - 1) / 2)
  const tail = Math.floor((maxChars - 1) / 2)
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`
}

function isWorkflowArtifactPath(path: string, filename: string): boolean {
  const trimmed = path.trim()
  return trimmed.startsWith('workflows/') && trimmed.endsWith(`/${filename}`)
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function pathLeaf(path: string): string {
  const normalized = path.replace(/\/+$/, '')
  const leaf = normalized.split('/').filter(Boolean).at(-1) || normalized
  return decodePathSegment(leaf)
}

function summarizeTargets(targets: string[], fallback: string): string {
  const normalized = targets.map((target) => target.trim()).filter(Boolean)
  if (normalized.length === 0) return fallback
  if (normalized.length === 1) return normalized[0]
  if (normalized.length === 2) return `${normalized[0]} and ${normalized[1]}`
  return `${normalized[0]}, ${normalized[1]}, and ${normalized.length - 2} more`
}

function countedResourceTarget(
  args: ToolArgs,
  key: string,
  singular: string,
  plural: string
): string {
  const values = args?.[key]
  return Array.isArray(values) && values.length > 1 ? `${values.length} ${plural}` : singular
}

function firstOutputFilePath(args: ToolArgs): string {
  const outputs = args?.outputs
  if (!outputs || typeof outputs !== 'object') return ''
  const files = (outputs as Record<string, unknown>).files
  if (!Array.isArray(files)) return ''

  for (const file of files) {
    if (!file || typeof file !== 'object') continue
    const path = stringArg(file as Record<string, unknown>, 'path')
    if (path) return path
  }
  return ''
}

function firstOutputFileMode(args: ToolArgs): string {
  const outputs = args?.outputs
  if (!outputs || typeof outputs !== 'object') return ''
  const files = (outputs as Record<string, unknown>).files
  if (!Array.isArray(files)) return ''

  for (const file of files) {
    if (!file || typeof file !== 'object') continue
    const mode = stringArg(file as Record<string, unknown>, 'mode')
    if (mode) return mode
  }
  return ''
}

function createFileTitle(args: ToolArgs): string {
  const nestedArgs =
    args?.args && typeof args.args === 'object' ? (args.args as Record<string, unknown>) : undefined
  const target =
    firstOutputFilePath(args) ||
    firstStringArg(args, 'fileName') ||
    firstOutputFilePath(nestedArgs) ||
    firstStringArg(nestedArgs, 'fileName')
  const mode = firstOutputFileMode(args) || firstOutputFileMode(nestedArgs)
  const verb = mode === 'overwrite' ? 'Overwriting' : 'Creating'
  if (!target) return `${verb} file`
  return `${verb} ${pathLeaf(target)}`
}

function ffmpegTitle(args: ToolArgs): string {
  const titles: Record<string, string> = {
    overlay_audio: 'Adding audio to media',
    mix_audio: 'Mixing audio',
    concat: 'Combining media',
    trim: 'Trimming media',
    scale_pad: 'Resizing media',
    overlay_image: 'Adding image to media',
    add_text: 'Adding text to media',
    fade: 'Adding fade to media',
    extract_audio: 'Extracting audio',
    convert: 'Converting media',
    thumbnail: 'Creating thumbnail',
    probe: 'Inspecting media',
  }
  return titles[stringArg(args, 'operation')] ?? 'Processing media'
}

function knowledgeBaseTitle(args: ToolArgs): string {
  const operation = stringArg(args, 'operation')
  const operationArgs = recordArg(args, 'args')
  const name = stringArg(operationArgs, 'name')
  const tagName = stringArg(operationArgs, 'tagDisplayName')
  const fileTarget = summarizeTargets(
    stringArrayArg(operationArgs, 'filePaths').map(pathLeaf),
    'file'
  )

  const query = stringArg(operationArgs, 'query')
  const titles: Record<string, string> = {
    create: `Creating ${name || 'knowledge base'}`,
    get: 'Reading knowledge base',
    query: query ? `Searching knowledge base for ${query}` : 'Searching knowledge base',
    add_file: `Adding ${fileTarget} to knowledge base`,
    update: 'Updating knowledge base',
    delete: `Deleting ${countedResourceTarget(operationArgs, 'knowledgeBaseIds', 'knowledge base', 'knowledge bases')}`,
    delete_document: `Deleting ${countedResourceTarget(operationArgs, 'documentIds', 'document', 'documents')}`,
    update_document: 'Updating document',
    list_tags: 'Listing knowledge base tags',
    create_tag: `Creating ${tagName || 'knowledge base tag'}`,
    update_tag: `Updating ${tagName || 'knowledge base tag'}`,
    delete_tag: 'Deleting knowledge base tag',
    get_tag_usage: 'Checking tag usage',
    add_connector: 'Adding knowledge base connector',
    update_connector: 'Updating knowledge base connector',
    delete_connector: 'Deleting knowledge base connector',
    sync_connector: 'Syncing knowledge base connector',
  }
  return titles[operation] ?? 'Managing knowledge base'
}

function queryUserTableTitle(args: ToolArgs): string {
  const titles: Record<string, string> = {
    get: 'Reading table',
    get_schema: 'Reading table schema',
    get_row: 'Reading table row',
    query_rows: 'Querying table',
  }
  return titles[stringArg(args, 'operation')] ?? 'Querying table'
}

function searchKnowledgeBaseTitle(args: ToolArgs): string {
  const query = stringArg(args, 'query')
  const operation = stringArg(args, 'operation')
  if (operation === 'get') return 'Reading knowledge base'
  if (operation === 'list_tags') return 'Listing knowledge base tags'
  // A search row is far more useful with the question it asked.
  return query ? `Searching knowledge base for ${query}` : 'Searching knowledge base'
}

function manageSandboxTitle(args: ToolArgs): string {
  const titles: Record<string, string> = {
    add: 'Creating sandbox',
    edit: 'Updating sandbox',
    delete: 'Deleting sandbox',
    list: 'Listing sandboxes',
  }
  return titles[stringArg(args, 'operation')] ?? 'Managing sandbox'
}

function userTableTitle(args: ToolArgs): string {
  const operation = stringArg(args, 'operation')
  const operationArgs = recordArg(args, 'args')
  const name = stringArg(operationArgs, 'name')
  const newName = stringArg(operationArgs, 'newName')
  const columnName = stringArg(operationArgs, 'columnName')
  const columnDefinitionName = nestedStringArg(operationArgs, 'column', 'name')
  const columnTargets = [
    ...stringArrayArg(operationArgs, 'columnNames'),
    ...(columnName ? [columnName] : []),
  ]

  switch (operation) {
    case 'create':
      return `Creating ${name || 'table'}`
    case 'create_from_file':
      return 'Creating table from file'
    case 'import_file':
      return 'Importing file into table'
    case 'get':
      return 'Reading table'
    case 'get_schema':
      return 'Reading table schema'
    case 'delete':
      return `Deleting ${countedResourceTarget(operationArgs, 'tableIds', 'table', 'tables')}`
    case 'rename':
      return newName ? `Renaming table to ${newName}` : 'Renaming table'
    case 'insert_row':
      return 'Adding table row'
    case 'batch_insert_rows':
      return `Adding ${countedResourceTarget(operationArgs, 'rows', 'table row', 'table rows')}`
    case 'get_row':
      return 'Reading table row'
    case 'query_rows':
      return 'Querying table'
    case 'update_row':
      return 'Updating table row'
    case 'delete_row':
      return 'Deleting table row'
    case 'update_rows_by_filter':
    case 'batch_update_rows':
      return 'Updating table rows'
    case 'delete_rows_by_filter':
    case 'batch_delete_rows':
      return 'Deleting table rows'
    case 'add_column':
      return columnDefinitionName ? `Adding column ${columnDefinitionName}` : 'Adding table column'
    case 'rename_column':
      if (columnName && newName) return `Renaming column ${columnName} to ${newName}`
      return newName ? `Renaming table column to ${newName}` : 'Renaming table column'
    case 'delete_column':
      return `Deleting ${summarizeTargets(columnTargets, 'table column')}`
    case 'update_column':
      return columnName ? `Updating column ${columnName}` : 'Updating table column'
    case 'add_workflow_group':
      return 'Adding table workflow'
    case 'update_workflow_group':
      return 'Updating table workflow'
    case 'delete_workflow_group':
      return 'Deleting table workflow'
    case 'add_workflow_group_output':
      return 'Adding workflow output column'
    case 'delete_workflow_group_output':
      return 'Deleting workflow output column'
    case 'run_column':
      return 'Running table workflow'
    case 'cancel_table_runs':
      return 'Cancelling table runs'
    case 'list_workflow_outputs':
      return 'Listing workflow outputs'
    case 'list_enrichments':
      return 'Listing enrichments'
    case 'add_enrichment':
      return `Adding ${name || 'enrichment'}`
    default:
      return 'Managing table'
  }
}

function materializeFileTitle(args: ToolArgs): string {
  const operation = stringArg(args, 'operation') || 'save'
  const targets = stringArrayArg(args, 'fileNames').map(pathLeaf)
  if (operation === 'import') {
    return `Importing ${summarizeTargets(targets, 'workflow')}`
  }
  if (operation === 'extract') {
    return `Extracting ${summarizeTargets(targets, 'archive')}`
  }
  return `Saving ${summarizeTargets(targets, 'file')}`
}

function openResourceTitle(args: ToolArgs): string {
  const resources = args?.resources
  if (!Array.isArray(resources) || resources.length === 0) return 'Opening resource'
  if (resources.length > 1) return `Opening ${resources.length} resources`
  const resource = resources[0]
  if (!resource || typeof resource !== 'object') return 'Opening resource'
  const type = stringArg(resource as Record<string, unknown>, 'type')
  return `Opening ${type ? resourceTypeLabel(type) : 'resource'}`
}

function setGlobalWorkflowVariablesTitle(args: ToolArgs): string {
  // Enrichment resolves the workflow id to a name; "in {workflow}" is dropped
  // when the call targets the workflow already in view and none resolves.
  const workflow = firstStringArg(args, 'workflowName', 'name')
  const scope = workflow ? ` in ${workflow}` : ''
  const operations = args?.operations
  if (!Array.isArray(operations) || operations.length === 0) {
    return `Setting workflow variables${scope}`
  }

  const parsed = operations.filter((operation): operation is Record<string, unknown> =>
    isRecordLike(operation)
  )
  const operationNames = parsed.map((operation) => stringArg(operation, 'operation'))
  const firstOperation = operationNames[0]
  const allSameOperation =
    firstOperation && operationNames.every((operation) => operation === firstOperation)
  const verbByOperation: Record<string, string> = {
    add: 'Adding',
    edit: 'Updating',
    delete: 'Deleting',
  }
  const verb = allSameOperation ? (verbByOperation[firstOperation] ?? 'Updating') : 'Updating'

  if (parsed.length === 1) {
    const variableName = stringArg(parsed[0], 'name')
    return `${verb} workflow variable${variableName ? ` ${variableName}` : ''}${scope}`
  }
  return `${verb} ${parsed.length} workflow variables${scope}`
}

/**
 * Verb for an mv call, derived from its arguments so the row reads as what
 * the call actually does: a single source whose parent path matches the
 * destination's (only the leaf changes) is a rename; multiple sources, a
 * trailing-slash folder destination, or a parent change is a move. Segments
 * are decoded so an encoded source compares correctly against a plain-text
 * destination leaf.
 */
export function mvDisplayVerb(
  source: string | undefined,
  destination: string | undefined
): 'Renaming' | 'Moving' {
  if (!source || !destination || /\/\s*$/.test(destination)) return 'Moving'
  const segments = (path: string) =>
    path
      .trim()
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .map(decodePathSegment)
  const src = segments(source)
  const dst = segments(destination)
  if (src.length < 2 || dst.length < 2) return 'Moving'
  const sameParent = src.slice(0, -1).join('/') === dst.slice(0, -1).join('/')
  const leafChanged = src.at(-1) !== dst.at(-1)
  return sameParent && leafChanged ? 'Renaming' : 'Moving'
}

function workspaceFileTitle(args: ToolArgs): string {
  const title = stringArg(args, 'title')
  if (!title) return ''
  const verbByOperation: Record<string, string> = {
    create: 'Creating',
    append: 'Adding',
    patch: 'Editing',
    update: 'Writing',
    rename: 'Renaming',
    delete: 'Deleting',
  }
  const verb = verbByOperation[stringArg(args, 'operation')] ?? 'Writing'
  return `${verb} ${title}`
}

/** Static fallback titles for tools without an argument-aware title. */
const TOOL_TITLES: Record<string, string> = {
  // Gateway rows brand from the streamed toolId as soon as it resolves; this
  // covers only the instant before the integration is known. The raw
  // humanized name ("Call Integration Tool") must never render.
  call_integration_tool: 'Calling integration',
  search_integration_tools: 'Finding the right integration',
  load_integration_tool: 'Loading integration tools',
  load_skill: 'Loading skill',
  load_slide_layout: 'Loading slide layout',
  read: 'Reading file',
  search_library_docs: 'Searching library docs',
  user_table: 'Managing table',
  run_code: 'Running code',
  query_user_table: 'Querying table',
  table_manage: 'Updating table',
  table_rows: 'Editing rows',
  table_columns: 'Editing columns',
  table_automations: 'Wiring automation',
  table_enrichments: 'Configuring enrichment',
  table_views: 'Editing views',
  prepare_file_edit: 'Editing file',
  apply_file_edit: 'Writing changes',
  create_workflow: 'Creating workflow',
  cancel_workflow_run: 'Cancelling workflow run',
  edit_workflow: 'Editing workflow',
  manage_knowledge_base: 'Managing knowledge base',
  search_knowledge_base: 'Searching knowledge base',
  search_workspace: 'Searching documents',
  read_document: 'Reading document',
  open_resource: 'Opening resource',

  ffmpeg: 'Processing media',
  get_deployment_status: 'Checking deployment status',
  create_empty_file: 'Creating file',
  create_file_folder: 'Creating folder',
  create_workspace_mcp_server: 'Creating MCP server',
  delete_workspace_mcp_server: 'Deleting MCP server',
  deploy_as_api: 'Deploying as API',
  deploy_as_chat: 'Deploying as chat',
  publish_custom_block: 'Publishing custom block',
  deploy_as_mcp: 'Deploying as MCP tool',
  diff_workflows: 'Comparing workflows',

  run_function: 'Running code',
  generate_api_key: 'Generating API key',
  // Retired in favor of the account/ and organization/ VFS namespaces. Kept so
  // a replayed transcript from before the switch still renders its rows.
  get_account_billing: 'Checking plan and usage',
  get_block_outputs: 'Reading block outputs',
  get_block_upstream_references: 'Tracing block inputs',
  get_deployed_workflow_state: 'Reading the deployed version',
  get_enterprise_context: 'Checking enterprise access',
  list_deployment_versions: 'Listing deployment versions',
  get_workflow_data: 'Reading workflow',
  get_workflow_run_options: 'Checking run settings',
  list_file_folders: 'Listing folders',
  list_integration_tools: 'Listing integration tools',
  list_user_workspaces: 'Listing workspaces',
  list_workspace_mcp_servers: 'Listing MCP servers',
  load_deployment: 'Loading deployment',
  save_upload: 'Saving upload',
  connect_slack_bot: 'Connecting Slack bot',
  manage_sandbox: 'Managing sandbox',
  move_file: 'Moving file',
  move_file_folder: 'Moving folder',
  move_workflow: 'Moving workflow',
  oauth_get_auth_link: 'Creating sign-in link',
  oauth_request_access: 'Requesting access',
  promote_to_live: 'Promoting to live',
  redeploy: 'Redeploying API',
  rename_file: 'Renaming file',
  rename_file_folder: 'Renaming folder',
  rename_workflow: 'Renaming workflow',
  restore_resource: 'Restoring resource',
  run_block: 'Running block',
  search_docs: 'Searching Sim docs',
  set_block_enabled: 'Toggling block',
  set_environment_variables: 'Setting environment variables',
  set_global_workflow_variables: 'Setting workflow variables',
  update_deployment_version: 'Updating deployment',
  update_workspace_mcp_server: 'Updating MCP server',
  // Browser agent tools without an argument-aware title.
  browser_go_back: 'Going back',
  browser_go_forward: 'Going forward',
  browser_reload: 'Reloading page',
  browser_switch_tab: 'Switching tab',
  browser_close_tab: 'Closing tab',
  browser_list_tabs: 'Listing tabs',
  browser_list_sessions: 'Checking signed-in sites',
  browser_list_downloads: 'Checking downloads',
  browser_snapshot: 'Scanning page',
  browser_find: 'Finding page element',
  browser_read_text: 'Reading page',
  browser_screenshot: 'Taking screenshot',
  browser_click: 'Clicking element',
  browser_click_at: 'Clicking point',

  browser_drag: 'Dragging element',
  browser_select_option: 'Selecting option',
  browser_fill_form: 'Filling form',
  browser_set_checked: 'Updating control',
  browser_hover: 'Hovering element',
  browser_zoom: 'Changing page zoom',
  // Subagent trigger tools, when surfaced as a tool call.
  workflow: 'Workflow Agent',
  run: 'Run Agent',
  deploy: 'Deploy Agent',
  auth: 'Auth Agent',
  knowledge: 'Knowledge Agent',
  table: 'Table Agent',
  extensions: 'Extensions Agent',
  research: 'Research Agent',
  scout: 'Scout Agent',
  search: 'Search Agent',
  platform: 'Platform Agent',
  file: 'File Agent',
  media: 'Media Agent',
  browser: 'Browser Agent',
  superagent: 'Executing action',
  respond: 'Gathering thoughts',
  context_compaction: CONTEXT_COMPACTION_DISPLAY_TITLE,
}

/** Acronyms that must keep their canonical casing when humanized. */
const ACRONYM_CASING: Record<string, string> = {
  mcp: 'MCP',
  api: 'API',
  oauth: 'OAuth',
  url: 'URL',
  id: 'ID',
  ai: 'AI',
}

/**
 * Humanize an internal identifier without leaking snake_case or kebab-case into
 * the UI. Sentence case is useful for resource names appended to a verb, while
 * title case is used for standalone tool-name fallbacks.
 */
export function humanizeDisplayIdentifier(
  name: string,
  casing: 'sentence' | 'title' = 'title'
): string {
  const words = stripVersionSuffix(name).split(/[-_]+/).filter(Boolean)
  if (words.length === 0) return name
  return words
    .map((word, index) => {
      const normalized = word.toLowerCase()
      const acronym = ACRONYM_CASING[normalized]
      if (acronym) return acronym
      if (casing === 'sentence' && index > 0) return normalized
      return normalized.charAt(0).toUpperCase() + normalized.slice(1)
    })
    .join(' ')
}

/**
 * Final fallback: humanize a raw tool name (e.g. `manage_folder` -> "Manage
 * Folder"), matching the legacy client humanizer so labels never render blank.
 */
export function humanizeToolName(name: string): string {
  return humanizeDisplayIdentifier(name)
}

/** One shape, so the live countdown and the settled title never diverge. */
function formatWaitTitle(seconds: number, reason: string): string {
  const duration = seconds > 0 ? ` ${seconds}s` : ''
  return reason ? `Waiting${duration} for ${reason}` : `Waiting${duration}`
}

function requestedWaitSeconds(args: ToolArgs): number {
  const raw = args?.seconds
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0
}

/**
 * The duration is the whole content of a pause: without it the row is an
 * unexplained stall, which is what the user is staring at while it runs.
 */
function waitTitle(args: ToolArgs): string {
  return formatWaitTitle(requestedWaitSeconds(args), stringArg(args, 'reason'))
}

/**
 * An async agent id is its slugified display name plus a sequence suffix
 * ("digest-workflow-build-4"); recover the human name for titles.
 */
function humanizeAgentId(id: string): string {
  const words = id.replace(/-\d+$/, '').split('-').filter(Boolean)
  if (words.length === 0) return id
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/** Title for a wait_agents sleep, naming the agents and honoring mode "any". */
function waitAgentsTitle(args: ToolArgs): string {
  const raw = args?.agent_ids
  const ids = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []
  const names = ids.map(humanizeAgentId)
  const anyMode = stringArg(args, 'mode') === 'any'
  if (names.length === 1) return `Waiting for ${names[0]}`
  if (names.length > 1) {
    const listed = `${names[0]} + ${names.length - 1}`
    return anyMode ? `Waiting for the first of ${listed}` : `Waiting for ${listed}`
  }
  return 'Waiting for agents'
}

/**
 * The title of a pause that is still running, counting down what is left.
 *
 * A number that never changes next to a spinner looks the same as a hung turn,
 * and a pause is the one row where the user is doing nothing but watching it.
 * At zero the number is dropped rather than frozen at "0s", because the pause
 * itself is over and what remains is the turn picking back up.
 */
export function getWaitCountdownTitle(args: ToolArgs, elapsedMs: number): string {
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const remaining = Math.max(0, requestedWaitSeconds(args) - elapsedSeconds)
  return formatWaitTitle(remaining, stringArg(args, 'reason'))
}

/** Past this a command wraps the row; the terminal panel still shows it in full. */
const MAX_COMMAND_TITLE_LENGTH = 48

/**
 * Budget for a quoted value embedded in a title.
 *
 * Much shorter than {@link MAX_COMMAND_TITLE_LENGTH}: these rows carry a
 * subagent prefix ("Workflow Agent — ") plus a verb phrase ("Searched Sim docs
 * for ") ahead of the value, and quotes and an ellipsis cost five more columns —
 * roughly 44 characters of fixed overhead before the value starts. The chat pane
 * also narrows whenever a resource panel is open, so the budget is set to keep
 * the row on one line there rather than at full width. A model-written search
 * query runs well past any of this if left alone.
 */
const MAX_QUOTED_TITLE_VALUE_LENGTH = 32

function runningCommandTitle(rawCommand: string): string {
  const command = rawCommand.replace(/\s+/g, ' ')
  if (!command) return 'Running command'
  const shortened =
    command.length > MAX_COMMAND_TITLE_LENGTH
      ? `${command.slice(0, MAX_COMMAND_TITLE_LENGTH - 1)}…`
      : command
  return `Running ${shortened}`
}

const TERMINAL_OPERATION_TITLES: Record<string, string> = {
  read: 'Reading terminal',
  input: 'Typing into terminal',
  kill: 'Stopping command',
  cwd: 'Checking terminal',
  list: 'Listing terminals',
  new: 'Opening terminal',
  switch: 'Switching terminal',
  close: 'Closing terminal',
  panes: 'Listing tmux panes',
}

/**
 * The terminal tool carries what it does in `operation`, so the row title has
 * to come from the arguments rather than the tool name — otherwise every shell
 * action in the transcript reads simply "Terminal".
 */
function terminalTitle(args: ToolArgs): string {
  const operation = stringArg(args, 'operation')
  const nested = args?.args
  const inner: ToolArgs = isRecordLike(nested) ? (nested as Record<string, unknown>) : undefined
  if (operation === 'run') return runningCommandTitle(stringArg(inner, 'command'))
  if (operation === 'handoff') {
    // Matches the browser takeover row: the reason is the whole point of the
    // row, since it is what the user has to act on.
    const reason = stringArg(inner, 'reason')
    return reason ? `Waiting for you: ${reason}` : 'Waiting for you in the terminal'
  }
  return TERMINAL_OPERATION_TITLES[operation] ?? 'Using terminal'
}

/**
 * Resolve a tool-call display title from its name and arguments. Argument-aware
 * cases come first, then the static map, then a humanized fallback. This never
 * returns an empty string.
 */
export function getToolDisplayTitle(name: string, args?: Record<string, unknown>): string {
  const mcpToolMatch = name.match(/^mcp-[^-]+-(.+)$/)
  if (mcpToolMatch?.[1]) {
    return humanizeToolName(mcpToolMatch[1])
  }

  switch (name) {
    case 'deploy_as_api':
      return deploymentTitle(args, 'API')
    case 'deploy_as_chat':
      return deploymentTitle(args, 'chat')
    case 'publish_custom_block':
      return `${stringArg(args, 'action') === 'undeploy' ? 'Unpublishing' : 'Publishing'} custom block`
    case 'ffmpeg':
      return ffmpegTitle(args)
    case 'manage_knowledge_base':
      return knowledgeBaseTitle(args)
    case 'query_user_table':
      return queryUserTableTitle(args)
    case 'table_manage':
    case 'table_rows':
    case 'table_columns':
    case 'table_automations':
    case 'table_enrichments':
    case 'table_views':
      return splitTableTitle(name, args)
    case 'search_knowledge_base':
      return searchKnowledgeBaseTitle(args)
    case 'manage_sandbox':
      return manageSandboxTitle(args)
    case 'user_table':
      return userTableTitle(args)
    case 'save_upload':
      return materializeFileTitle(args)
    case 'open_resource':
      return openResourceTitle(args)
    case 'wait':
      return waitTitle(args)
    case 'wait_agents':
      return waitAgentsTitle(args)
    case 'tail_agent':
      return `Checking on ${humanizeAgentId(stringArg(args, 'agent_id')) || 'agent'}`
    case 'steer_agent':
      return `Steering ${humanizeAgentId(stringArg(args, 'agent_id')) || 'agent'}`
    case 'interrupt_agent':
      return `Stopping ${humanizeAgentId(stringArg(args, 'agent_id')) || 'agent'}`
    case 'terminal':
      return terminalTitle(args)
    // The surface used to be one tool per operation. Conversations recorded
    // then still reference those names, so they keep their titles rather than
    // regressing to a humanized "Terminal Run".
    case 'terminal_run':
      return runningCommandTitle(stringArg(args, 'command'))
    case 'terminal_read':
      return 'Reading terminal'
    case 'terminal_input':
      return 'Typing into terminal'
    case 'terminal_kill':
      return 'Stopping command'
    case 'terminal_cwd':
      return 'Checking terminal'
    case 'terminal_list':
      return 'Listing terminals'
    case 'terminal_new':
      return 'Opening terminal'
    case 'terminal_switch':
      return 'Switching terminal'
    case 'terminal_close':
      return 'Closing terminal'
    case 'restore_resource': {
      const type = stringArg(args, 'type')
      return `Restoring ${type ? resourceTypeLabel(type) : 'resource'}`
    }
    case 'load_deployment': {
      const version = stringOrNumberArg(args, 'version')
      if (!version) return 'Loading deployment'
      return version === 'live'
        ? 'Loading live deployment'
        : `Loading deployment version ${version}`
    }
    case 'update_deployment_version': {
      const version = stringOrNumberArg(args, 'version')
      return version ? `Updating deployment version ${version}` : 'Updating deployment'
    }
    case 'generate_api_key': {
      const keyName = stringArg(args, 'name')
      return keyName ? `Generating API key ${keyName}` : 'Generating API key'
    }
    case 'list_integration_tools': {
      const integration = stringArg(args, 'integration')
      return integration
        ? `Listing ${humanizeToolName(integration)} tools`
        : 'Listing integration tools'
    }
    case 'set_environment_variables': {
      const scope = stringArg(args, 'scope') || 'workspace'
      return `Setting ${scope} environment variables`
    }
    case 'set_global_workflow_variables':
      return setGlobalWorkflowVariablesTitle(args)
    case 'create_empty_file':
      return createFileTitle(args)
    case 'share_file': {
      const action = stringArg(args, 'action') || 'share'
      const path = stringArg(args, 'path')
      const target = firstStringArg(args, 'toolTitle', 'title') || (path ? pathLeaf(path) : 'file')
      return action === 'unshare' ? `Unsharing ${target}` : `Sharing ${target}`
    }
    case 'create_workflow': {
      const target = firstStringArg(args, 'name', 'workflowName', 'title')
      return `Creating ${target || 'workflow'}`
    }
    case 'edit_workflow': {
      const target = firstStringArg(args, 'workflowName', 'name', 'title')
      return `Editing ${target || 'workflow'}`
    }
    case 'create_workspace_mcp_server': {
      const target = firstStringArg(args, 'name', 'serverName', 'title')
      return `Creating ${target || 'MCP server'}`
    }
    case 'update_workspace_mcp_server': {
      const target = firstStringArg(args, 'name', 'serverName', 'title')
      return `Updating ${target || 'MCP server'}`
    }
    case 'delete_workspace_mcp_server': {
      const target = firstStringArg(args, 'serverName', 'name', 'title')
      return `Deleting ${target || 'MCP server'}`
    }
    case 'web_search': {
      const target = firstStringArg(args, 'toolTitle', 'title')
      return target ? `Searching online for ${target}` : 'Searching online'
    }
    case 'search_docs': {
      const target = firstStringArg(args, 'toolTitle', 'title', 'query')
      return target
        ? `Searching Sim docs for "${truncate(target, MAX_QUOTED_TITLE_VALUE_LENGTH)}"`
        : 'Searching Sim docs'
    }
    case 'grep': {
      const target = firstStringArg(args, 'toolTitle', 'title')
      return target ? `Searching for ${target}` : 'Searching'
    }
    case 'glob': {
      const target = firstStringArg(args, 'toolTitle', 'title')
      return target ? `Finding ${target}` : 'Finding files'
    }
    case 'mv': {
      const sources = stringArrayArg(args, 'sources')
      const verb =
        sources.length === 1 ? mvDisplayVerb(sources[0], stringArg(args, 'destination')) : 'Moving'
      if (verb === 'Renaming' && sources[0]) {
        const destination = stringArg(args, 'destination')
        if (destination) return `Renaming ${pathLeaf(sources[0])} to ${pathLeaf(destination)}`
      }
      // The model's own phrasing wins; otherwise name both ends of the
      // move: "Moving apple.md to fruits".
      const target = firstStringArg(args, 'toolTitle', 'title')
      if (target) return `${verb} ${target}`
      const destination = stringArg(args, 'destination')
      if (sources.length > 0 && destination) {
        const what = summarizeTargets(sources.map(pathLeaf), 'files')
        return `${verb} ${what} to ${pathLeaf(destination)}`
      }
      return verb
    }
    case 'cp': {
      const target = firstStringArg(args, 'toolTitle', 'title')
      return target ? `Duplicating ${target}` : 'Duplicating workflow'
    }
    case 'mkdir': {
      const path = stringArg(args, 'path')
      if (path) return `Creating folder ${pathLeaf(path)}`
      const target = firstStringArg(args, 'toolTitle', 'title')
      return target ? `Creating ${target}` : 'Creating folder'
    }
    case 'rm': {
      // toolTitle is the model's phrasing; the paths are the fallback because
      // rm spans categories and there is no one noun to count.
      const target =
        firstStringArg(args, 'toolTitle', 'title') ||
        summarizeTargets(stringArrayArg(args, 'paths').map(pathLeaf), 'resource')
      return target ? `Deleting ${target}` : 'Deleting'
    }
    case 'load_integration_tool': {
      const integration = firstStringArg(args, 'integration', 'service', 'toolId')
      return integration ? `Loading ${integration} tools` : 'Loading integration tools'
    }
    case 'load_skill': {
      const skill = firstStringArg(args, 'name', 'skillId', 'skill')
      return skill ? `Loading skill ${skill}` : 'Loading skill'
    }
    case 'run_enrichment': {
      const subject = nestedStringArg(
        args,
        'inputs',
        'fullName',
        'companyName',
        'domain',
        'email',
        'companyDomain'
      )
      return subject ? `Looking up ${subject}` : 'Looking up data'
    }
    case 'web_scrape': {
      const url = stringArg(args, 'url')
      return url ? `Scraping ${url}` : 'Scraping page'
    }
    case 'browser_navigate': {
      const url = displayUrl(stringArg(args, 'url'))
      return url ? `Opening ${url}` : 'Opening page'
    }
    case 'browser_open_url': {
      const url = displayUrl(stringArg(args, 'url'))
      return url ? `Opening ${url}` : 'Opening page'
    }
    case 'browser_open_tab': {
      const url = displayUrl(stringArg(args, 'url'))
      return url ? `Opening ${url} in a new tab` : 'Opening new tab'
    }
    case 'browser_wait_for': {
      const text = stringArg(args, 'text')
      const state = stringArg(args, 'state')
      const url = stringArg(args, 'urlContains')
      if (text) return `Waiting for "${text}"`
      if (state) return `Waiting for element to be ${state}`
      return url ? `Waiting for ${displayUrl(url)}` : 'Waiting for page'
    }
    case 'browser_find': {
      const query = stringArg(args, 'query')
      return query ? `Finding "${truncateMiddle(query, 32)}"` : 'Finding page element'
    }
    case 'browser_set_checked': {
      return args?.checked === false ? 'Unchecking control' : 'Checking control'
    }
    case 'browser_zoom': {
      const action = stringArg(args, 'action')
      if (action === 'in') return 'Zooming in'
      if (action === 'out') return 'Zooming out'
      return action === 'reset' ? 'Resetting page zoom' : 'Changing page zoom'
    }
    case 'generate_image':
    case 'generate_video':
    case 'generate_audio': {
      const kind =
        name === 'generate_image' ? 'image' : name === 'generate_video' ? 'video' : 'audio'
      const target =
        firstStringArg(args, 'toolTitle', 'title') ||
        (stringArg(args, 'path') ? pathLeaf(stringArg(args, 'path')) : '')
      return target ? `Generating ${target}` : `Generating ${kind}`
    }
    case 'download_file': {
      const target =
        firstStringArg(args, 'fileName', 'toolTitle', 'title') ||
        (stringArg(args, 'path') ? pathLeaf(stringArg(args, 'path')) : '') ||
        (stringArg(args, 'url') ? displayUrl(stringArg(args, 'url')) : '')
      return target ? `Downloading ${target}` : 'Downloading file'
    }
    case 'extract_doc_assets': {
      const target = stringArg(args, 'path') ? pathLeaf(stringArg(args, 'path')) : ''
      return target ? `Extracting assets from ${target}` : 'Extracting document assets'
    }
    case 'search_library_docs': {
      const library = firstStringArg(args, 'library_name', 'libraryName', 'library')
      const query = stringArg(args, 'query')
      if (library && query) return `Searching ${library} docs for ${query}`
      if (library) return `Searching ${library} docs`
      return query ? `Searching library docs for ${query}` : 'Searching library docs'
    }
    case 'run_code': {
      const title = stringArg(args, 'title')
      return title || 'Running code'
    }
    case 'browser_type':
    case 'browser_insert_text': {
      const verb = name === 'browser_type' ? 'Typing' : 'Inserting'
      const text = stringArg(args, 'text')
      return text ? `${verb} "${truncateMiddle(text, 32)}"` : `${verb} text`
    }
    case 'browser_press_key': {
      const key = stringArg(args, 'key')
      return key ? `Pressing ${key}` : 'Pressing key'
    }
    case 'browser_scroll': {
      const direction = stringArg(args, 'direction')
      return direction ? `Scrolling ${direction}` : 'Scrolling page'
    }
    case 'browser_extract': {
      const instruction = stringArg(args, 'instruction')
      return instruction ? `Extracting ${instruction}` : 'Extracting page data'
    }
    case 'browser_request_takeover': {
      const reason = stringArg(args, 'reason')
      return reason ? `Waiting for you: ${reason}` : 'Waiting for you in the browser'
    }
    case 'web_crawl': {
      const url = stringArg(args, 'url')
      return url ? `Crawling ${url}` : 'Crawling website'
    }
    case 'web_fetch': {
      const urls = stringArrayArg(args, 'urls')
      if (urls.length === 1) return `Fetching ${urls[0]}`
      if (urls.length > 1) return `Fetching ${urls.length} pages`
      return 'Fetching page'
    }
    case 'manage_custom_tool': {
      const schema = args?.schema
      const target =
        firstStringArg(args, 'toolTitle', 'title', 'name') ||
        (schema && typeof schema === 'object'
          ? nestedStringArg(schema as Record<string, unknown>, 'function', 'name')
          : '')
      return namedOperationTitle(args, target, 'Managing custom tool', {
        add: { verb: 'Creating', resource: 'custom tool' },
        edit: { verb: 'Updating', resource: 'custom tool' },
        delete: { verb: 'Deleting', resource: 'custom tool' },
        list: { verb: 'Viewing', resource: 'custom tools' },
      })
    }
    case 'manage_mcp_connection': {
      const target =
        firstStringArg(args, 'serverName', 'name', 'title') ||
        nestedStringArg(args, 'config', 'name')
      return namedOperationTitle(args, target, 'Managing MCP server', {
        add: { verb: 'Creating', resource: 'MCP server' },
        edit: { verb: 'Updating', resource: 'MCP server' },
        delete: { verb: 'Deleting', resource: 'MCP server' },
        list: { verb: 'Viewing', resource: 'MCP servers' },
      })
    }
    case 'manage_skill': {
      const target = firstStringArg(args, 'name', 'skillName', 'title')
      return namedOperationTitle(args, target, 'Managing skill', {
        add: { verb: 'Creating', resource: 'skill' },
        edit: { verb: 'Updating', resource: 'skill' },
        delete: { verb: 'Deleting', resource: 'skill' },
        list: { verb: 'Viewing', resource: 'skills' },
      })
    }
    case 'manage_credential': {
      const operation = stringArg(args, 'operation')
      if (operation === 'rename') {
        const from = firstStringArg(args, 'previousDisplayName', 'oldName', 'credentialName')
        const to = firstStringArg(args, 'displayName', 'newName', 'name', 'title')
        if (from && to) return `Renaming ${from} to ${to}`
        return to ? `Renaming credential to ${to}` : 'Renaming credential'
      }
      const target = firstStringArg(args, 'credentialName', 'displayName', 'name', 'title')
      return namedOperationTitle(args, target, 'Managing credential', {
        delete: { verb: 'Deleting', resource: 'credential' },
      })
    }
    case 'get_deployment_status': {
      const workflow = firstStringArg(args, 'workflowName', 'name')
      return workflow ? `Checking ${workflow} deployment status` : 'Checking deployment status'
    }
    case 'get_deployed_workflow_state': {
      const workflow = firstStringArg(args, 'workflowName', 'name')
      return workflow ? `Reading deployed ${workflow}` : 'Reading the deployed version'
    }
    case 'get_workflow_run_options': {
      const workflow = firstStringArg(args, 'workflowName', 'name')
      return workflow ? `Checking ${workflow} run settings` : 'Checking run settings'
    }
    case 'get_block_outputs': {
      const workflow = firstStringArg(args, 'workflowName', 'name')
      return workflow ? `Reading ${workflow} block outputs` : 'Reading block outputs'
    }
    case 'get_block_upstream_references': {
      const workflow = firstStringArg(args, 'workflowName', 'name')
      return workflow ? `Tracing ${workflow} block inputs` : 'Tracing block inputs'
    }
    case 'redeploy': {
      const workflow = firstStringArg(args, 'workflowName', 'name')
      return workflow ? `Redeploying ${workflow}` : 'Redeploying API'
    }
    case 'promote_to_live': {
      const workflow = firstStringArg(args, 'workflowName', 'name')
      const version = stringOrNumberArg(args, 'version')
      if (workflow && version) return `Promoting ${workflow} version ${version} to live`
      if (workflow) return `Promoting ${workflow} to live`
      return version ? `Promoting version ${version} to live` : 'Promoting to live'
    }
    case 'run_workflow': {
      const workflow = firstStringArg(args, 'workflowName', 'name')
      return workflow ? `Running ${workflow}` : 'Running workflow'
    }
    case 'run_from_block': {
      const block = firstStringArg(args, 'blockName', 'block_name', 'startBlockName')
      const workflow = firstStringArg(args, 'workflowName', 'name')
      if (!block) return 'Running workflow'
      return workflow ? `Running from ${block} in ${workflow}` : `Running from ${block}`
    }
    case 'run_workflow_until_block': {
      const block = firstStringArg(args, 'blockName', 'block_name', 'untilBlockName')
      const workflow = firstStringArg(args, 'workflowName', 'name')
      if (!block) return workflow ? `Running ${workflow}` : 'Running workflow'
      return `Running ${workflow || 'workflow'} until ${block}`
    }
    case 'run_block': {
      const block = firstStringArg(args, 'blockName', 'block_name')
      const workflow = firstStringArg(args, 'workflowName', 'name')
      if (!block) return 'Running block'
      return workflow ? `Running ${block} in ${workflow}` : `Running ${block}`
    }
    case 'set_block_enabled': {
      const block = firstStringArg(args, 'blockName', 'block_name')
      const workflow = firstStringArg(args, 'workflowName', 'name')
      const verb =
        args?.enabled === false ? 'Disabling' : args?.enabled === true ? 'Enabling' : 'Toggling'
      if (!block) return `${verb} block`
      return workflow ? `${verb} ${block} in ${workflow}` : `${verb} ${block}`
    }
    case 'query_logs': {
      // The model narrates its own query; the per-view titles are fallbacks.
      const title = stringArg(args, 'title')
      if (title) return title
      const workflowName = stringArg(args, 'workflowName')
      const scope = workflowName ? ` for ${workflowName}` : ''
      switch (stringArg(args, 'view')) {
        case 'stats':
          return `Analyzing run stats${scope}`
        case 'trace':
          return 'Reading execution trace'
        case 'overview':
          return 'Reading execution overview'
        case 'full':
          return 'Reading execution details'
        case 'list':
          return `Querying logs${scope}`
        default:
          // view is optional: executionId implies the trace digest default.
          return stringArg(args, 'executionId')
            ? 'Reading execution trace'
            : `Querying logs${scope}`
      }
    }
    case 'read': {
      const path = stringArg(args, 'path')
      if (isWorkflowArtifactPath(path, 'lint.json')) {
        return 'Validating workflow state'
      }
      // Workflow artifacts name BOTH the workflow and which part, so five
      // reads in a row differentiate instead of all saying the same thing.
      // A block schema read is the model looking up how a block works; name
      // the block, not the file. The row's icon is chosen from the same id.
      const blockSchema = path.match(/^components\/blocks\/([^/]+)\.json$/)
      if (blockSchema) return `Loading ${blockDisplayName(decodePathSegment(blockSchema[1]))}`
      const blockTips = path.match(/^components\/blocks\/([^/]+)\/README\.md$/)
      if (blockTips) return `Loading ${blockDisplayName(decodePathSegment(blockTips[1]))} tips`
      const workflowArtifact = path.match(/^workflows\/([^/]+)\/([^/]+)$/)
      if (workflowArtifact) {
        const part =
          (
            {
              'meta.json': 'meta',
              'state.json': 'state',
              'deployment.json': 'deployment',
              'README.md': 'notes',
            } as Record<string, string>
          )[workflowArtifact[2]] ?? decodePathSegment(workflowArtifact[2])
        return `Reading ${decodePathSegment(workflowArtifact[1])} ${part}`
      }
      if (path) return `Reading ${pathLeaf(path)}`
      break
    }
    case 'prepare_file_edit':
    case 'run_function': {
      const title =
        name === 'prepare_file_edit' ? workspaceFileTitle(args) : stringArg(args, 'title')
      if (title) return title
      break
    }
  }

  return TOOL_TITLES[name] ?? humanizeToolName(name)
}

/**
 * Present-participle to past-tense verb map for completed tool titles. Applied
 * to the leading word only, so "Searching online for X" -> "Searched online
 * for X" while non-gerund labels ("Run Agent", "Folder action") pass through.
 */
const COMPLETED_VERB_REWRITES: Record<string, string> = {
  Accessing: 'Accessed',
  Adding: 'Added',
  Applying: 'Applied',
  Cancelling: 'Cancelled',
  Calling: 'Called',
  Checking: 'Checked',
  Changing: 'Changed',
  Clicking: 'Clicked',
  Closing: 'Closed',
  Combining: 'Combined',
  Comparing: 'Compared',
  Completing: 'Completed',
  Converting: 'Converted',
  Crawling: 'Crawled',
  Creating: 'Created',
  Deleting: 'Deleted',
  Connecting: 'Connected',
  Deploying: 'Deployed',
  Dragging: 'Dragged',
  Inserting: 'Inserted',
  Publishing: 'Published',
  Unpublishing: 'Unpublished',
  Analyzing: 'Analyzed',
  Disabling: 'Disabled',
  Downloading: 'Downloaded',
  Duplicating: 'Duplicated',
  Editing: 'Edited',
  Enabling: 'Enabled',
  Executing: 'Executed',
  Extracting: 'Extracted',
  Fading: 'Faded',
  Finding: 'Found',
  Filling: 'Filled',
  Gathering: 'Gathered',
  Generating: 'Generated',
  Going: 'Went',
  Fetching: 'Fetched',
  Tracing: 'Traced',
  Wiring: 'Wired',
  Configuring: 'Configured',
  Looking: 'Looked',
  Rotating: 'Rotated',
  Hovering: 'Hovered',
  Importing: 'Imported',
  Inspecting: 'Inspected',
  Listing: 'Listed',
  Loading: 'Loaded',
  Managing: 'Managed',
  Mixing: 'Mixed',
  Moving: 'Moved',
  Opening: 'Opened',
  Overwriting: 'Overwrote',
  Preparing: 'Prepared',
  Pressing: 'Pressed',
  Processing: 'Processed',
  Promoting: 'Promoted',
  Querying: 'Queried',
  Reading: 'Read',
  Redeploying: 'Redeployed',
  Reloading: 'Reloaded',
  Removing: 'Removed',
  Renaming: 'Renamed',
  Requesting: 'Requested',
  Resetting: 'Reset',
  Resizing: 'Resized',
  Restoring: 'Restored',
  Running: 'Ran',
  Saving: 'Saved',
  Scanning: 'Scanned',
  Scraping: 'Scraped',
  Scrolling: 'Scrolled',
  Searching: 'Searched',
  Selecting: 'Selected',
  Setting: 'Set',
  Sharing: 'Shared',
  Steering: 'Steered',
  Stopping: 'Stopped',
  Summarizing: 'Summarized',
  Switching: 'Switched',
  Syncing: 'Synced',
  Taking: 'Took',
  Toggling: 'Toggled',
  Trimming: 'Trimmed',
  Typing: 'Typed',
  Unchecking: 'Unchecked',
  Undeploying: 'Undeployed',
  Unsharing: 'Unshared',
  Updating: 'Updated',
  Using: 'Used',
  Validating: 'Validated',
  Viewing: 'Viewed',
  Waiting: 'Waited',
  Writing: 'Wrote',
  Zooming: 'Zoomed',
}

/**
 * Rewrite a resolved display title to its past-tense form for a successfully
 * completed tool call (e.g. "Querying logs for X" -> "Queried logs for X").
 * Operates on the already-resolved title so enriched and persisted titles both
 * work. Returns undefined when the title has no leading gerund rewrite — the
 * caller keeps the original. Integration gateway descriptions are base-form
 * verb phrases ("Read recent emails") whose first word never matches a gerund
 * key, so they intentionally pass through unchanged.
 */
export function getToolCompletedTitle(title: string): string | undefined {
  const spaceIndex = title.indexOf(' ')
  const firstWord = spaceIndex === -1 ? title : title.slice(0, spaceIndex)
  const past = COMPLETED_VERB_REWRITES[firstWord]
  if (!past) return undefined
  return past + title.slice(firstWord.length)
}

/**
 * Titles that already say the work is over.
 *
 * Two layers project a terminal tense: the client tool store phrases its own
 * error and skip labels ("Attempted to read X", "Skipped reading X"), and this
 * module projects again at the render boundary. Re-projecting an
 * already-projected title stacked prefixes — "Failed: Failed: Attempted to read
 * metadata for thread_tracking" — and even a single pass over a store label
 * reads as doubly hedged. Whichever layer spoke first wins.
 */
const TERMINAL_TITLE_PREFIXES = new Set(['Failed', 'Attempted', 'Skipped', 'Stopped'])

function firstWordOf(title: string): string {
  const spaceIndex = title.indexOf(' ')
  return spaceIndex === -1 ? title : title.slice(0, spaceIndex)
}

/** Whether a title already states a terminal outcome and must pass through. */
function statesTerminalOutcome(title: string): boolean {
  return TERMINAL_TITLE_PREFIXES.has(firstWordOf(title).replace(/:$/, ''))
}

/**
 * Rewrite a resolved display title for a FAILED tool call. A gerund title
 * becomes "Failed <gerund>…" ("Searching for X" → "Failed searching for X");
 * anything else gets a "Failed: " prefix. Without this, an errored row kept
 * its present-tense activity title verbatim and read as still running.
 */
export function getToolFailedTitle(title: string): string {
  if (statesTerminalOutcome(title)) return title
  const firstWord = firstWordOf(title)
  if (COMPLETED_VERB_REWRITES[firstWord]) {
    return `Failed ${firstWord.charAt(0).toLowerCase()}${firstWord.slice(1)}${title.slice(firstWord.length)}`
  }
  return `Failed: ${title}`
}

/** Rewrite a resolved display title for a CANCELLED tool call ("Stopped <gerund>…"). */
export function getToolStoppedTitle(title: string): string {
  if (statesTerminalOutcome(title)) return title
  const firstWord = firstWordOf(title)
  if (COMPLETED_VERB_REWRITES[firstWord]) {
    return `Stopped ${firstWord.charAt(0).toLowerCase()}${firstWord.slice(1)}${title.slice(firstWord.length)}`
  }
  return `Stopped: ${title}`
}

/**
 * Resolve the final title for a tool status at a rendering boundary. Persisted
 * and live snapshots intentionally keep the present-tense activity title so a
 * RUNNING row remains truthful; terminal states project a tense that says the
 * work is over — completed (past tense), failed, or stopped.
 */
export function getToolStatusDisplayTitle(
  title: string,
  status: string,
  toolName?: string
): string {
  if (status === 'success' && toolName === 'browser_request_takeover') {
    return 'Resumed browser control'
  }
  if (status === 'success') return getToolCompletedTitle(title) ?? title
  if (status === 'error' || status === 'rejected') return getToolFailedTitle(title)
  if (status === 'cancelled' || status === 'aborted') return getToolStoppedTitle(title)
  return title
}
