import { stripVersionSuffix } from '@sim/utils/string'

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

function stringArg(args: ToolArgs, key: string): string {
  const value = args?.[key]
  return typeof value === 'string' ? value.trim() : ''
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
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringOrNumberArg(args: ToolArgs, key: string): string {
  const value = args?.[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function deploymentTitle(args: ToolArgs, deploymentType: string): string {
  return `${stringArg(args, 'action') === 'undeploy' ? 'Undeploying' : 'Deploying'} ${deploymentType}`
}

function resourceTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    knowledgebase: 'knowledge base',
    scheduledtask: 'scheduled task',
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

  const titles: Record<string, string> = {
    create: `Creating ${name || 'knowledge base'}`,
    get: 'Reading knowledge base',
    query: 'Searching knowledge base',
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
  const titles: Record<string, string> = {
    get: 'Reading knowledge base',
    query: 'Searching knowledge base',
    list_tags: 'Listing knowledge base tags',
  }
  return titles[stringArg(args, 'operation')] ?? 'Searching knowledge base'
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
  const operations = args?.operations
  if (!Array.isArray(operations) || operations.length === 0) return 'Setting workflow variables'

  const parsed = operations.filter(
    (operation): operation is Record<string, unknown> =>
      Boolean(operation) && typeof operation === 'object' && !Array.isArray(operation)
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
    return `${verb} workflow variable${variableName ? ` ${variableName}` : ''}`
  }
  return `${verb} ${parsed.length} workflow variables`
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
  read: 'Reading file',
  search_library_docs: 'Searching library docs',
  user_table: 'Managing table',
  run_code: 'Running code',
  query_user_table: 'Querying table',
  workspace_file: 'Editing file',
  edit_content: 'Applying file content',
  create_workflow: 'Creating workflow',
  edit_workflow: 'Editing workflow',
  knowledge_base: 'Managing knowledge base',
  search_knowledge_base: 'Searching knowledge base',
  open_resource: 'Opening resource',
  generate_image: 'Generating image',
  generate_video: 'Generating video',
  generate_audio: 'Generating audio',
  ffmpeg: 'Processing media',
  manage_folder: 'Folder action',
  check_deployment_status: 'Checking deployment status',
  complete_scheduled_task: 'Completing scheduled task',
  create_file: 'Creating file',
  create_file_folder: 'Creating folder',
  create_workspace_mcp_server: 'Creating MCP server',
  delete_file: 'Deleting file',
  delete_file_folder: 'Deleting folder',
  delete_workflow: 'Deleting workflow',
  delete_workspace_mcp_server: 'Deleting MCP server',
  deploy_api: 'Deploying API',
  deploy_chat: 'Deploying chat',
  deploy_custom_block: 'Deploying custom block',
  deploy_mcp: 'Deploying MCP tool',
  diff_workflows: 'Comparing workflows',
  download_to_workspace_file: 'Downloading file',
  function_execute: 'Running code',
  generate_api_key: 'Generating API key',
  get_block_outputs: 'Getting block outputs',
  get_block_upstream_references: 'Getting block references',
  get_deployed_workflow_state: 'Getting deployed workflow',
  get_deployment_log: 'Getting deployment logs',
  get_platform_actions: 'Getting platform actions',
  get_scheduled_task_logs: 'Getting scheduled task logs',
  get_workflow_data: 'Getting workflow data',
  get_workflow_run_options: 'Getting run options',
  list_file_folders: 'Listing folders',
  list_integration_tools: 'Listing integration tools',
  list_user_workspaces: 'Listing workspaces',
  list_workspace_mcp_servers: 'Listing MCP servers',
  load_deployment: 'Loading deployment',
  materialize_file: 'Preparing file',
  move_file: 'Moving file',
  move_file_folder: 'Moving folder',
  move_workflow: 'Moving workflow',
  oauth_get_auth_link: 'Getting authorization link',
  oauth_request_access: 'Requesting access',
  promote_to_live: 'Promoting to live',
  redeploy: 'Redeploying API',
  rename_file: 'Renaming file',
  rename_file_folder: 'Renaming folder',
  rename_workflow: 'Renaming workflow',
  restore_resource: 'Restoring resource',
  run_block: 'Running block',
  search_documentation: 'Searching documentation',
  search_patterns: 'Searching patterns',
  set_block_enabled: 'Toggling block',
  set_environment_variables: 'Setting environment variables',
  set_global_workflow_variables: 'Setting workflow variables',
  update_deployment_version: 'Updating deployment',
  update_scheduled_task_history: 'Updating task history',
  update_workspace_mcp_server: 'Updating MCP server',
  // Subagent trigger tools, when surfaced as a tool call.
  workflow: 'Workflow Agent',
  run: 'Run Agent',
  deploy: 'Deploy Agent',
  auth: 'Auth Agent',
  knowledge: 'Knowledge Agent',
  table: 'Table Agent',
  scheduled_task: 'Scheduled Task Agent',
  agent: 'Tools Agent',
  research: 'Research Agent',
  scout: 'Scout Agent',
  search: 'Search Agent',
  file: 'File Agent',
  media: 'Media Agent',
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
    case 'deploy_api':
      return deploymentTitle(args, 'API')
    case 'deploy_chat':
      return deploymentTitle(args, 'chat')
    case 'deploy_custom_block':
      return deploymentTitle(args, 'custom block')
    case 'ffmpeg':
      return ffmpegTitle(args)
    case 'knowledge_base':
      return knowledgeBaseTitle(args)
    case 'query_user_table':
      return queryUserTableTitle(args)
    case 'search_knowledge_base':
      return searchKnowledgeBaseTitle(args)
    case 'user_table':
      return userTableTitle(args)
    case 'materialize_file':
      return materializeFileTitle(args)
    case 'open_resource':
      return openResourceTitle(args)
    case 'restore_resource': {
      const type = stringArg(args, 'type')
      return `Restoring ${type ? resourceTypeLabel(type) : 'resource'}`
    }
    case 'set_block_enabled': {
      const enabled = args?.enabled
      return typeof enabled === 'boolean'
        ? `${enabled ? 'Enabling' : 'Disabling'} block`
        : 'Toggling block'
    }
    case 'load_deployment': {
      const version = stringOrNumberArg(args, 'version')
      if (!version) return 'Loading deployment'
      return version === 'live'
        ? 'Loading live deployment'
        : `Loading deployment version ${version}`
    }
    case 'promote_to_live': {
      const version = stringOrNumberArg(args, 'version')
      return version ? `Promoting version ${version} to live` : 'Promoting to live'
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
    case 'create_file':
      return createFileTitle(args)
    case 'delete_file': {
      const targets = stringArrayArg(args, 'paths').map(pathLeaf)
      return `Deleting ${summarizeTargets(targets, 'file')}`
    }
    case 'delete_file_folder': {
      const targets = stringArrayArg(args, 'paths').map(pathLeaf)
      return `Deleting ${summarizeTargets(targets, 'folder')}`
    }
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
    case 'delete_workflow': {
      const target = summarizeTargets(
        stringArrayArg(args, 'workflowNames'),
        countedResourceTarget(args, 'workflowIds', 'workflow', 'workflows')
      )
      return `Deleting ${target}`
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
    case 'search_online': {
      const target = firstStringArg(args, 'toolTitle', 'title')
      return target ? `Searching online for ${target}` : 'Searching online'
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
      const target = firstStringArg(args, 'toolTitle', 'title')
      return target ? `${verb} ${target}` : verb
    }
    case 'cp': {
      const target = firstStringArg(args, 'toolTitle', 'title')
      return target ? `Duplicating ${target}` : 'Duplicating workflow'
    }
    case 'mkdir': {
      const target = firstStringArg(args, 'toolTitle', 'title')
      return target ? `Creating ${target}` : 'Creating folder'
    }
    case 'enrichment_run': {
      const subject = nestedStringArg(
        args,
        'inputs',
        'fullName',
        'companyName',
        'domain',
        'email',
        'companyDomain'
      )
      return subject ? `Searching for ${subject}` : 'Searching'
    }
    case 'scrape_page': {
      const url = stringArg(args, 'url')
      return url ? `Scraping ${url}` : 'Scraping page'
    }
    case 'crawl_website': {
      const url = stringArg(args, 'url')
      return url ? `Crawling ${url}` : 'Crawling website'
    }
    case 'get_page_contents': {
      const urls = stringArrayArg(args, 'urls')
      if (urls.length === 1) return `Getting ${urls[0]}`
      if (urls.length > 1) return `Getting ${urls.length} pages`
      return 'Getting page contents'
    }
    case 'manage_custom_tool': {
      const schema = args?.schema
      const target =
        firstStringArg(args, 'toolTitle', 'title', 'name') ||
        (schema && typeof schema === 'object'
          ? nestedStringArg(schema as Record<string, unknown>, 'function', 'name')
          : '')
      return namedOperationTitle(args, target, 'Custom tool action', {
        add: { verb: 'Creating', resource: 'custom tool' },
        edit: { verb: 'Updating', resource: 'custom tool' },
        delete: { verb: 'Deleting', resource: 'custom tool' },
        list: { verb: 'Viewing', resource: 'custom tools' },
      })
    }
    case 'manage_mcp_tool': {
      const target =
        firstStringArg(args, 'serverName', 'name', 'title') ||
        nestedStringArg(args, 'config', 'name')
      return namedOperationTitle(args, target, 'MCP server action', {
        add: { verb: 'Creating', resource: 'MCP server' },
        edit: { verb: 'Updating', resource: 'MCP server' },
        delete: { verb: 'Deleting', resource: 'MCP server' },
        list: { verb: 'Viewing', resource: 'MCP servers' },
      })
    }
    case 'manage_skill': {
      const target = firstStringArg(args, 'name', 'skillName', 'title')
      return namedOperationTitle(args, target, 'Skill action', {
        add: { verb: 'Creating', resource: 'skill' },
        edit: { verb: 'Updating', resource: 'skill' },
        delete: { verb: 'Deleting', resource: 'skill' },
        list: { verb: 'Viewing', resource: 'skills' },
      })
    }
    case 'manage_scheduled_task': {
      const target =
        firstStringArg(args, 'title', 'taskName', 'name') || nestedStringArg(args, 'args', 'title')
      return namedOperationTitle(args, target, 'Scheduled task action', {
        create: { verb: 'Creating', resource: 'scheduled task' },
        get: { verb: 'Reading', resource: 'scheduled task' },
        update: { verb: 'Updating', resource: 'scheduled task' },
        delete: { verb: 'Deleting', resource: 'scheduled task' },
        list: { verb: 'Viewing', resource: 'scheduled tasks' },
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
      return namedOperationTitle(args, target, 'Credential action', {
        delete: { verb: 'Deleting', resource: 'credential' },
      })
    }
    case 'manage_folder': {
      const operation = stringArg(args, 'operation')
      if (operation === 'rename') {
        const rawFrom = firstStringArg(args, 'oldPath', 'source', 'path', 'folderName')
        const rawTo = firstStringArg(args, 'newPath', 'destination', 'newName', 'name', 'title')
        const from = rawFrom ? pathLeaf(rawFrom) : ''
        const to = rawTo ? pathLeaf(rawTo) : ''
        if (from && to) return `Renaming ${from} to ${to}`
        return to ? `Renaming folder to ${to}` : 'Renaming folder'
      }
      const rawTarget = firstStringArg(
        args,
        'newPath',
        'destination',
        'path',
        'folderName',
        'name',
        'title'
      )
      const target = rawTarget ? pathLeaf(rawTarget) : ''
      return namedOperationTitle(args, target, 'Folder action', {
        create: { verb: 'Creating', resource: 'folder' },
        move: { verb: 'Moving', resource: 'folder' },
        delete: { verb: 'Deleting', resource: 'folder' },
      })
    }
    case 'run_workflow':
    case 'run_from_block':
    case 'run_workflow_until_block':
      return 'Running workflow'
    case 'query_logs': {
      const workflowName = stringArg(args, 'workflowName')
      return workflowName ? `Querying logs for ${workflowName}` : 'Querying logs'
    }
    case 'read': {
      if (isWorkflowArtifactPath(stringArg(args, 'path'), 'lint.json')) {
        return 'Validating workflow state'
      }
      break
    }
    case 'workspace_file':
    case 'function_execute': {
      const title = name === 'workspace_file' ? workspaceFileTitle(args) : stringArg(args, 'title')
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
  Combining: 'Combined',
  Comparing: 'Compared',
  Completing: 'Completed',
  Converting: 'Converted',
  Crawling: 'Crawled',
  Creating: 'Created',
  Deleting: 'Deleted',
  Deploying: 'Deployed',
  Disabling: 'Disabled',
  Downloading: 'Downloaded',
  Duplicating: 'Duplicated',
  Editing: 'Edited',
  Enabling: 'Enabled',
  Executing: 'Executed',
  Extracting: 'Extracted',
  Fading: 'Faded',
  Finding: 'Found',
  Gathering: 'Gathered',
  Generating: 'Generated',
  Getting: 'Got',
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
  Processing: 'Processed',
  Promoting: 'Promoted',
  Querying: 'Queried',
  Reading: 'Read',
  Redeploying: 'Redeployed',
  Renaming: 'Renamed',
  Requesting: 'Requested',
  Resizing: 'Resized',
  Restoring: 'Restored',
  Running: 'Ran',
  Saving: 'Saved',
  Scraping: 'Scraped',
  Searching: 'Searched',
  Setting: 'Set',
  Sharing: 'Shared',
  Summarizing: 'Summarized',
  Syncing: 'Synced',
  Toggling: 'Toggled',
  Trimming: 'Trimmed',
  Undeploying: 'Undeployed',
  Unsharing: 'Unshared',
  Updating: 'Updated',
  Validating: 'Validated',
  Viewing: 'Viewed',
  Writing: 'Wrote',
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
 * Resolve the final title for a tool status at a rendering boundary. Persisted
 * and live snapshots intentionally keep the present-tense activity title so a
 * running/error row remains truthful; every successful renderer calls this to
 * project the corresponding completed title from the canonical verb map.
 */
export function getToolStatusDisplayTitle(title: string, status: string): string {
  return status === 'success' ? (getToolCompletedTitle(title) ?? title) : title
}
