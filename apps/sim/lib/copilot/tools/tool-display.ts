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

function createFileTitle(args: ToolArgs): string {
  const nestedArgs =
    args?.args && typeof args.args === 'object' ? (args.args as Record<string, unknown>) : undefined
  const target =
    firstOutputFilePath(args) ||
    firstStringArg(args, 'fileName') ||
    firstOutputFilePath(nestedArgs) ||
    firstStringArg(nestedArgs, 'fileName')
  if (!target) return 'Creating file'
  return `Creating ${pathLeaf(target)}`
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
  // Full-stack App lifecycle tools
  app_bind_action: 'Binding App action',
  app_refresh_binding: 'Refreshing App binding',
  app_detach_action: 'Detaching App action',
  app_write_files: 'Writing App files',
  app_build: 'Building App',
  app_prepare_publish: 'Preparing App release',
  app_list_callable_releases: 'Listing App releases',
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
  deploy_mcp: 'Deploying MCP server',
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
  list_integration_tools: 'Listing integrations',
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
  redeploy: 'Redeploying',
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
  media: 'Media Agent',
  superagent: 'Executing action',
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
 * Final fallback: humanize a raw tool name (e.g. `manage_folder` -> "Manage
 * Folder"), matching the legacy client humanizer so labels never render blank.
 */
export function humanizeToolName(name: string): string {
  const words = stripVersionSuffix(name).split('_').filter(Boolean)
  if (words.length === 0) return name
  return words
    .map((word) => ACRONYM_CASING[word] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
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
  Calling: 'Called',
  Checking: 'Checked',
  Comparing: 'Compared',
  Completing: 'Completed',
  Crawling: 'Crawled',
  Creating: 'Created',
  Deleting: 'Deleted',
  Deploying: 'Deployed',
  Downloading: 'Downloaded',
  Editing: 'Edited',
  Executing: 'Executed',
  Finding: 'Found',
  Gathering: 'Gathered',
  Generating: 'Generated',
  Getting: 'Got',
  Listing: 'Listed',
  Loading: 'Loaded',
  Managing: 'Managed',
  Moving: 'Moved',
  Opening: 'Opened',
  Preparing: 'Prepared',
  Processing: 'Processed',
  Promoting: 'Promoted',
  Querying: 'Queried',
  Reading: 'Read',
  Redeploying: 'Redeployed',
  Renaming: 'Renamed',
  Requesting: 'Requested',
  Restoring: 'Restored',
  Running: 'Ran',
  Scraping: 'Scraped',
  Searching: 'Searched',
  Setting: 'Set',
  Toggling: 'Toggled',
  Updating: 'Updated',
  Validating: 'Validated',
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
