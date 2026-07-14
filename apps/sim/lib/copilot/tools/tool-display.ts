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

function operationTitle(
  args: ToolArgs,
  placeholder: string,
  labels: Record<string, string>
): string {
  const operation = stringArg(args, 'operation')
  return labels[operation] ?? placeholder
}

function isWorkflowArtifactPath(path: string, filename: string): boolean {
  const trimmed = path.trim()
  return trimmed.startsWith('workflows/') && trimmed.endsWith(`/${filename}`)
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
  read: 'Reading file',
  search_library_docs: 'Searching library docs',
  user_memory: 'Accessing memory',
  user_table: 'Managing table',
  workspace_file: 'Editing file',
  edit_content: 'Applying file content',
  create_workflow: 'Creating workflow',
  edit_workflow: 'Editing workflow',
  knowledge_base: 'Managing knowledge base',
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
  media: 'Media Agent',
  superagent: 'Executing action',
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
  switch (name) {
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
    case 'manage_custom_tool':
      return operationTitle(args, 'Custom tool action', {
        add: 'Creating custom tool',
        edit: 'Updating custom tool',
        delete: 'Deleting custom tool',
        list: 'Listing custom tools',
      })
    case 'manage_mcp_tool':
      return operationTitle(args, 'MCP server action', {
        add: 'Creating MCP server',
        edit: 'Updating MCP server',
        delete: 'Deleting MCP server',
        list: 'Listing MCP servers',
      })
    case 'manage_skill':
      return operationTitle(args, 'Skill action', {
        add: 'Creating skill',
        edit: 'Updating skill',
        delete: 'Deleting skill',
        list: 'Listing skills',
      })
    case 'manage_scheduled_task':
      return operationTitle(args, 'Scheduled task action', {
        create: 'Creating scheduled task',
        get: 'Getting scheduled task',
        update: 'Updating scheduled task',
        delete: 'Deleting scheduled task',
        list: 'Listing scheduled tasks',
      })
    case 'manage_credential':
      return operationTitle(args, 'Credential action', {
        rename: 'Renaming credential',
        delete: 'Deleting credential',
      })
    case 'manage_folder':
      return operationTitle(args, 'Folder action', {
        create: 'Creating folder',
        rename: 'Renaming folder',
        move: 'Moving folder',
        delete: 'Deleting folder',
      })
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
 * caller keeps the original.
 */
export function getToolCompletedTitle(title: string): string | undefined {
  const spaceIndex = title.indexOf(' ')
  const firstWord = spaceIndex === -1 ? title : title.slice(0, spaceIndex)
  const past = COMPLETED_VERB_REWRITES[firstWord]
  if (!past) return undefined
  return past + title.slice(firstWord.length)
}
