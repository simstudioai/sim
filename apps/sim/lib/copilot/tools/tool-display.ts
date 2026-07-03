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
 * Icons are likewise client-owned — see `getToolIcon` in the message-content
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
  media: 'Media Agent',
  superagent: 'Executing action',
}

/**
 * Final fallback: humanize a raw tool name (e.g. `manage_folder` -> "Manage
 * Folder"), matching the legacy client humanizer so labels never render blank.
 */
export function humanizeToolName(name: string): string {
  const words = stripVersionSuffix(name).split('_').filter(Boolean)
  if (words.length === 0) return name
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
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
