#!/usr/bin/env bun

/**
 * Generates the CLI command reference into `apps/docs/content/docs/cli`,
 * alongside that section's hand-written guides, and owns the section's
 * `meta.json` because the sidebar lists one entry per command group.
 *
 * The source of truth is the command tree the terminal itself parses —
 * `buildProgram()` from `packages/sim-cli` — not the CLI contract and not the
 * generated operation table. Both of those are upstream of the tree, so reading
 * them instead would mean reimplementing `buildGeneratedCommands`, and the docs
 * would be free to describe a surface no user can invoke.
 *
 * Run `bun run generate:cli-docs` after changing a command; `bun run
 * check:cli-docs` fails when the checked-in pages are stale, which is how CI
 * keeps them honest.
 */

import type { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareStrings } from '@sim/utils/string'
import type { Command } from 'commander'
import { CLI_CONTRACT } from '../packages/sim-cli/src/contract/commands'
import { V2_OPERATIONS } from '../packages/sim-cli/src/generated/v2-api'
import { buildProgram } from '../packages/sim-cli/src/program'
import { calledOperations, operationOf } from '../packages/sim-cli/src/runtime/called-operations'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const OUTPUT_DIR = path.join(ROOT, 'apps/docs/content/docs/cli')

/** Commander's synthetic help command is not part of the documented surface. */
const HELP_COMMAND = 'help'

/**
 * Hand-written pages in `OUTPUT_DIR`, in sidebar order.
 *
 * Generated pages sit beside them rather than in a subfolder so each command
 * group is a root-level entry under the Commands heading instead of a nested
 * folder the reader has to open. That means the stale-file sweep would delete
 * these, so they are listed — the same guard `scripts/generate-docs.ts` uses for
 * its hand-authored integration pages.
 */
export const GUIDE_PAGES = [
  'index',
  'authentication',
  'configuration',
  'output',
  'scripting',
  'workflow-sync',
  'troubleshooting',
  'usage-data',
] as const

/** Generated page holding the global options and the commands that take no resource. */
const OVERVIEW_PAGE = 'commands'

/** Generated page carrying every command at once, for search and for agents. */
const REFERENCE_PAGE = 'reference'

interface GroupDocumentation {
  title?: string
  description: string
  notes?: readonly string[]
  related?: readonly [string, string][]
}

const GROUP_DOCUMENTATION: Record<string, GroupDocumentation> = {
  'audit-logs': {
    description:
      'Read organization audit actions and filter by actor, resource, workspace, or time.',
    notes: [
      'Requires an organization Admin or owner, an OAuth login or personal API key, and enabled enterprise audit access for the deployment.',
    ],
    related: [
      ['Organization permissions', '/platform/permissions'],
      ['Authentication', '/cli/authentication'],
    ],
  },
  billing: {
    description: 'Read billing status, credit usage, and storage usage.',
    related: [
      ['Costs', '/platform/costs'],
      ['Authentication', '/cli/authentication'],
    ],
  },
  blocks: {
    description:
      'Inspect workflow blocks, integration blocks, and triggers available to the workspace.',
    notes: [
      'The catalog reflects the workspace’s allowed integrations, revealed preview blocks, and deployed custom blocks.',
    ],
  },
  'chat-deployments': {
    description: 'List workflow chat deployments in the workspace.',
    related: [['Deploy or update a workflow chat', '/cli/workflows#chat-deployments']],
  },
  cli: {
    title: 'Command search',
    description: 'Find a command by describing the task you want to perform.',
  },
  'connector-types': {
    description:
      'Discover knowledge connectors and their authentication and source-configuration schemas.',
    notes: ['Use `--detail full` to inspect a connector’s configuration before creating it.'],
    related: [['Create and sync knowledge connectors', '/cli/knowledge#connectors']],
  },
  credentials: {
    description: 'Discover providers, connect accounts, and manage credential access.',
    notes: [
      'Run `sim --output json credentials providers list` to inspect the provider’s fields and authentication requirements before creating a service-account credential. OAuth connection commands return a link that a person must open to authorize the connection.',
    ],
    related: [['Credentials', '/platform/credentials']],
  },
  'custom-tools': {
    description: 'Create and manage code-backed tools that agents can call.',
    related: [['Custom tools', '/agents/custom-tools']],
  },
  files: {
    description:
      'Browse workspace files, read or write content, manage versions, and configure sharing.',
    related: [
      ['Files', '/files'],
      ['Output formats', '/cli/output'],
    ],
  },
  knowledge: {
    description: 'Manage knowledge bases, indexed documents, search, tags, and connector syncs.',
    related: [
      ['Knowledge Base', '/knowledgebase'],
      ['Tags and filters', '/knowledgebase/tags'],
      ['Export and import', '/knowledgebase/export-import'],
    ],
  },
  logs: {
    description: 'Read run diagnostics, follow new runs, and summarize failures and latency.',
    related: [
      ['Logs and debugging', '/logs-debugging'],
      ['Output formats', '/cli/output'],
    ],
  },
  'mcp-servers': {
    title: 'MCP servers',
    description:
      'Connect external Model Context Protocol (MCP) servers so workflows can use their tools.',
    notes: [
      'To serve Sim workflows to MCP clients instead, use [workflow MCP servers](/cli/workflow-mcp-servers).',
    ],
    related: [['MCP connections', '/agents/mcp']],
  },
  meta: {
    title: 'API status',
    description: 'Inspect API availability and the calling credential’s type and expiry.',
    related: [['Authentication', '/cli/authentication']],
  },
  organizations: {
    description: 'Manage organization membership, invitations, usage, access requests, and SSO.',
    related: [
      ['Organizations', '/platform/organization'],
      ['Permissions', '/platform/permissions'],
    ],
  },
  'permission-groups': {
    description:
      'Manage organization permission groups, their configuration, and member assignments.',
    notes: [
      'Use the linked API request schema for the supported `--config` keys. Supplied arrays replace their entire lists; omitted settings remain unchanged on update.',
    ],
    related: [['Permission groups', '/platform/permissions']],
  },
  profiles: {
    description: 'List profiles and add a workspace profile that shares a stored login.',
    notes: [
      'Adding a profile reuses the active stored login and selects a default workspace. Supply `--workspace` when running without an interactive terminal.',
    ],
    related: [
      ['Configuration', '/cli/configuration'],
      ['Authentication', '/cli/authentication'],
    ],
  },
  sandboxes: {
    description: 'Manage reusable dependency sets for Function blocks.',
    related: [['Function sandboxes', '/workflows/blocks/function#sandboxes']],
  },
  secrets: {
    description: 'Set and manage workspace or personal secrets.',
    notes: [
      'Personal secrets belong to the caller across workspaces. Workspace secrets are shared resources. Listings include stored values only for workspace secrets marked visible (unredacted); all other entries contain metadata.',
    ],
    related: [['Credentials and secrets', '/platform/credentials']],
  },
  selectors: {
    description:
      'Discover destination options for registered fields, such as calendars, channels, and tables.',
    notes: [
      'A selector key identifies the field’s option source. Its context accepts only declared dependencies; missing OAuth access requires a person to authorize the connection.',
    ],
  },
  skills: {
    description: 'Create reusable agent instructions and manage their editors.',
    related: [['Skills', '/agents/skills']],
  },
  tables: {
    description: 'Manage tables, rows, schemas, views, enrichment runs, imports, and exports.',
    related: [
      ['Tables', '/tables'],
      ['Workflow columns', '/tables/workflow-columns'],
    ],
  },
  telemetry: {
    description: 'Inspect and change this machine’s anonymous usage-reporting preference.',
    related: [['Usage data', '/cli/usage-data']],
  },
  tools: {
    description: 'Find built-in tools, inspect their parameters, and run them.',
    notes: [
      'Inspect a tool with `sim tools get <toolId>` before passing its parameters to `sim tools execute`.',
    ],
  },
  'workflow-mcp-servers': {
    title: 'Workflow MCP servers',
    description: 'Serve deployed workflows as tools for Model Context Protocol (MCP) clients.',
    notes: [
      'These servers expose Sim workflows. To connect a server that provides external tools, use [MCP servers](/cli/mcp-servers).',
    ],
    related: [['MCP connections', '/agents/mcp']],
  },
  workflows: {
    description: 'Build, deploy, run, and inspect workflows from the terminal.',
    related: [
      ['Workflow builder', '/workflows'],
      ['Import and workspace sync', '/cli/workflow-sync'],
      ['Scripting and exit codes', '/cli/scripting#exit-codes'],
    ],
  },
  workspaces: {
    description: 'Read workspace access and manage reviewed fork, push, and pull operations.',
    related: [
      ['Workspace sync', '/cli/workflow-sync'],
      ['Workspaces', '/platform/workspaces'],
    ],
  },
}

interface CommandSection {
  title: string
  prefixes: readonly string[]
}

const GROUP_SECTIONS: Record<string, readonly CommandSection[]> = {
  credentials: [
    {
      title: 'Provider discovery and connections',
      prefixes: ['providers', 'list', 'create', 'connect', 'reconnect', 'update'],
    },
    { title: 'Credential members', prefixes: ['members'] },
    { title: 'Disconnect credentials', prefixes: ['delete'] },
  ],
  files: [
    { title: 'Browse and inspect', prefixes: ['ls', 'list', 'search', 'describe'] },
    { title: 'Upload, create, and read', prefixes: ['upload', 'create', 'get', 'read'] },
    { title: 'Edit and organize', prefixes: ['edit', 'set-content', 'rename', 'move', 'unzip'] },
    { title: 'Sharing', prefixes: ['share'] },
    {
      title: 'Versions',
      prefixes: [
        'versions list',
        'versions describe',
        'versions read',
        'versions download',
        'versions revert',
        'versions delete',
      ],
    },
    { title: 'Archive and restore', prefixes: ['delete', 'batch-delete', 'restore'] },
    { title: 'Folders', prefixes: ['folders', 'mkdir'] },
  ],
  knowledge: [
    {
      title: 'Knowledge bases',
      prefixes: ['list', 'get', 'create', 'update', 'mv', 'delete', 'restore'],
    },
    { title: 'Search', prefixes: ['search'] },
    { title: 'Export and import', prefixes: ['export', 'import', 'imports'] },
    { title: 'Documents', prefixes: ['documents', 'from-workspace-files'] },
    { title: 'Chunks', prefixes: ['chunks'] },
    { title: 'Tags', prefixes: ['tags'] },
    {
      title: 'Connectors',
      prefixes: [
        'connectors list',
        'connectors get',
        'connectors create',
        'connectors update',
        'connectors sync',
        'connectors documents',
        'connectors delete',
      ],
    },
    { title: 'Folders', prefixes: ['ls', 'folders', 'mkdir'] },
  ],
  'mcp-servers': [
    { title: 'Server connections', prefixes: ['list', 'get', 'create', 'update'] },
    { title: 'Tool discovery', prefixes: ['tools'] },
    { title: 'Remove servers', prefixes: ['delete'] },
  ],
  organizations: [
    { title: 'Organizations and workspaces', prefixes: ['list', 'get', 'workspaces'] },
    { title: 'Members and credit limits', prefixes: ['members'] },
    { title: 'Invitations', prefixes: ['invitations'] },
    { title: 'Usage', prefixes: ['usage summary', 'usage breakdown', 'usage events'] },
    {
      title: 'Access requests',
      prefixes: [
        'access-requests discover',
        'access-requests create',
        'access-requests mine',
        'access-requests cancel',
        'access-requests list',
        'access-requests preview',
        'access-requests resolve',
        'access-requests settings',
      ],
    },
    {
      title: 'Verified domains',
      prefixes: ['domains list', 'domains add', 'domains verify', 'domains remove'],
    },
    {
      title: 'SSO providers and policy',
      prefixes: [
        'sso providers list',
        'sso providers get',
        'sso providers save',
        'sso providers primary',
        'sso providers delete',
        'sso policy',
      ],
    },
  ],
  'permission-groups': [
    { title: 'Group configuration', prefixes: ['list', 'get', 'create', 'update'] },
    { title: 'Member assignments', prefixes: ['members'] },
    { title: 'Delete groups', prefixes: ['delete'] },
  ],
  skills: [
    { title: 'Skill instructions', prefixes: ['list', 'get', 'create', 'update'] },
    { title: 'Editors', prefixes: ['editors'] },
    { title: 'Delete skills', prefixes: ['delete'] },
  ],
  tables: [
    {
      title: 'Tables',
      prefixes: [
        'list',
        'get',
        'create',
        'update',
        'move',
        'mv',
        'delete',
        'batch-delete',
        'restore',
      ],
    },
    { title: 'Rows and queries', prefixes: ['rows', 'upsert'] },
    { title: 'Columns', prefixes: ['columns'] },
    { title: 'Saved views', prefixes: ['views'] },
    {
      title: 'Producer groups and runs',
      prefixes: ['groups', 'enrichment', 'dispatches', 'cancel-runs'],
    },
    { title: 'Imports', prefixes: ['import', 'imports'] },
    {
      title: 'Exports',
      prefixes: ['exports create', 'exports get', 'exports download', 'exports cancel'],
    },
    { title: 'Folders', prefixes: ['ls', 'folders', 'mkdir'] },
  ],
  'workflow-mcp-servers': [
    { title: 'Servers', prefixes: ['list', 'get', 'create', 'update'] },
    { title: 'Workflow tools', prefixes: ['tools'] },
    { title: 'Delete servers', prefixes: ['delete'] },
  ],
  workflows: [
    {
      title: 'Workflows',
      prefixes: ['list', 'get', 'create', 'update', 'duplicate', 'move', 'mv', 'delete', 'restore'],
    },
    { title: 'Draft state and edits', prefixes: ['state', 'operations', 'variables'] },
    {
      title: 'Deployments and versions',
      prefixes: ['deploy', 'deployment', 'versions', 'activate', 'revert', 'rollback', 'undeploy'],
    },
    {
      title: 'Run and inspect',
      prefixes: ['run', 'runs list', 'runs get', 'runs wait', 'runs resume', 'runs cancel'],
    },
    { title: 'Chat deployments', prefixes: ['chat status', 'chat publish', 'chat unpublish'] },
    { title: 'Export and import', prefixes: ['export', 'import-preview', 'import'] },
    { title: 'Folders', prefixes: ['ls', 'folders', 'mkdir'] },
  ],
  workspaces: [
    {
      title: 'Workspace access',
      prefixes: ['list', 'get', 'members', 'invitations', 'permission-config'],
    },
    {
      title: 'Access requests',
      prefixes: [
        'access-requests discover',
        'access-requests create',
        'access-requests mine',
        'access-requests cancel',
      ],
    },
    {
      title: 'Forks and lineage',
      prefixes: [
        'fork-availability',
        'fork-resources',
        'fork-preview',
        'fork',
        'lineage',
        'children',
      ],
    },
    { title: 'Mappings', prefixes: ['mappings'] },
    { title: 'Push and pull', prefixes: ['push-preview', 'push', 'pull-preview', 'pull'] },
    { title: 'Operation status', prefixes: ['operations'] },
    { title: 'Exclusions and recovery', prefixes: ['sync-exclusions', 'fork-rollback', 'unlink'] },
  ],
}

const COMMAND_NOTES: Record<string, readonly string[]> = {
  'tables import': [
    'Choose exactly one source: a local CSV path or `--file-id`. For a new table imported with `--file-id`, supply `--name`. With `--table-id`, omit the new-table `--name` and `--folder` flags; `--mode`, `--mapping`, and `--create-columns` apply only to an existing table.',
    '**Replace mode deletes all existing rows before loading the CSV and cannot be undone.** It requires `--yes`; cancellation leaves only the rows already imported.',
    'The command watches the import by default. `--no-wait` returns a queued receipt. A completed import can still report `rowsRejected`, `cellsRejected`, and `rejectedSamples`; inspect them before accepting the result.',
  ],
  'workflows chat publish': [
    'Omitting `--auth-type` selects public access: anyone holding the URL can chat. Supply the complete password or allow-list settings again when replacing a restricted deployment.',
  ],
  'workflows runs cancel': [
    'Canceling a paused run prevents resuming that run. Starting a new run can repeat side effects already performed.',
  ],
  'workflows export': [
    'The export clears credentials, passwords, and table sub-block values, but it is not a general secret scanner. Inspect literal variables and inline configuration before sharing the document.',
  ],
  'organizations sso providers save': [
    'Choose `--provider-type oidc` or `saml`. OIDC requires `--client-id` and `--client-secret`; SAML requires `--entry-point` and `--cert`. Both require an organization-verified domain. The option descriptions state which omitted fields are preserved or cleared.',
  ],
}

const LEGACY_COMMAND_ANCHORS: Record<string, string> = {
  'workflow-mcp-servers tools create': 'publish-workflow-as-mcp-tool',
  'workflow-mcp-servers tools delete': 'unpublish-workflow-mcp-tool',
  'cli search': 'find-the-command-for-a-task-described-in-plain-words',
  'telemetry status': 'show-whether-usage-reporting-is-on-and-why-not-if-it-is-off',
  'telemetry enable': 'turn-usage-reporting-on-for-this-machine',
  'workflows runs wait': 'wait-for-a-run-to-reach-a-terminal-state-then-show-it',
  'workflows chat publish': 'publish-or-replace-a-workflows-chat-deployment',
  'workspaces operations wait':
    'wait-for-copy-and-deployment-readiness-exit-3-for-configuration-1-for-failure-or-4-for-timeout',
}

const VERB_ORDER = [
  'list',
  'ls',
  'get',
  'status',
  'describe',
  'query',
  'count',
  'search',
  'stats',
  'preview',
  'discover',
  'create',
  'add',
  'upload',
  'save',
  'set',
  'upsert',
  'update',
  'edit',
  'apply',
  'update-each',
  'batch-update',
  'usage',
  'next-slot',
  'sync',
  'primary',
  'enrich',
  'read',
  'download',
  'compare',
  'revert',
  'wait',
  'resume',
  'resend',
  'cancel',
  'delete',
  'batch-delete',
  'cleanup',
  'remove',
  'revoke',
  'restore',
] as const

interface ApiReferenceOperation {
  operationId?: string
  tags?: string[]
}

function apiReferenceLinks(): Map<string, string> {
  const links = new Map<string, string>()
  for (const name of fs.readdirSync(path.join(ROOT, 'apps/docs'))) {
    if (!/^openapi-v2-.*\.json$/.test(name)) continue
    const document = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/docs', name), 'utf8')) as {
      paths: Record<string, Record<string, ApiReferenceOperation>>
    }
    for (const [route, operations] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        const tag = operation.tags?.[0]
        if (!operation.operationId || !tag) continue
        const url = `/api-reference/${tag.toLowerCase().replaceAll(' ', '-')}/${operation.operationId}`
        links.set(operation.operationId, url)
        links.set(`${method.toUpperCase()} ${route}`, url)
      }
    }
  }
  return links
}

interface DocumentedCommand {
  /** Full invocation path, e.g. `workflows runs get`. */
  path: string[]
  command: Command
}

function titleFor(name: string): string {
  return GROUP_DOCUMENTATION[name]?.title ?? sentenceCase(name.replaceAll('-', ' '))
}

/**
 * Commander records a hidden command on a private field and offers no getter,
 * so this narrows structurally rather than widening the command to `any`.
 */
function isHiddenCommand(command: Command): boolean {
  return (command as Command & { _hidden?: boolean })._hidden === true
}

/** Every option a reader should be taught, in declaration order. */
function documentedOptions(command: Command): Command['options'] {
  return command.options.filter((option) => !option.hidden)
}

/**
 * Hidden entries are excluded for the same reason `--help` omits them: they are
 * spellings the CLI has retired and keeps working only so an existing script
 * does not break. Documenting one would teach the name being retired.
 */
function subcommands(command: Command): Command[] {
  return command.commands.filter(
    (child) => child.name() !== HELP_COMMAND && !isHiddenCommand(child)
  )
}

/** Depth-first walk yielding every leaf command, in the order commander lists them. */
function collectLeaves(command: Command, prefix: string[]): DocumentedCommand[] {
  const children = subcommands(command)
  if (children.length === 0) return [{ path: prefix, command }]
  return children.flatMap((child) => collectLeaves(child, [...prefix, child.name()]))
}

/**
 * Wraps a value in a code span for a Markdown table cell.
 *
 * A code span already shields `<` and `{` from MDX, and character references
 * are NOT decoded inside one — escaping `<` to `&lt;` here would render the
 * entity itself, so `|` is the only character that still has to be escaped. It
 * has to be: a literal pipe ends the cell, and flags like `--mode <a|b>` and
 * the row filter help both contain one.
 */
function code(value: string): string {
  return value.includes('\\') ? literalCode(value) : `\`${value.replace(/\|/g, '\\|')}\``
}

/** A JSX string keeps code containing backslashes and pipes lossless through GFM tables. */
function literalCode(value: string): string {
  return `<code>{${JSON.stringify(value).replaceAll('|', '\\u007c')}}</code>`
}

/** Escapes backslashes and pipes in Markdown table prose. */
function escapeTablePipes(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
}

function escapeCell(value: string): string {
  return mapCodeSpans(
    value,
    (text) => escapeTablePipes(escapeText(text)),
    (span, content) => (content.includes('\\') ? literalCode(content) : span.replace(/\|/g, '\\|'))
  )
}

function escapeText(value: string): string {
  return value
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;')
}

/** Escapes MDX-significant prose while retaining inline-code contents. */
function escapeProse(value: string): string {
  return mapCodeSpans(value, escapeText, (span) => span)
}

function mapCodeSpans(
  value: string,
  prose: (text: string) => string,
  inlineCode: (span: string, content: string) => string
): string {
  const delimiters = [...value.matchAll(/`+/g)]
  let result = ''
  let offset = 0
  for (let index = 0; index < delimiters.length; index += 1) {
    const opening = delimiters[index]
    if (!opening) continue
    let precedingBackslashes = 0
    for (
      let position = opening.index - 1;
      position >= 0 && value[position] === '\\';
      position -= 1
    ) {
      precedingBackslashes += 1
    }
    if (precedingBackslashes % 2 !== 0) continue
    const closingIndex = delimiters.findIndex(
      (delimiter, candidate) => candidate > index && delimiter[0].length === opening[0].length
    )
    const closing = delimiters[closingIndex]
    if (!closing) continue
    const end = closing.index + closing[0].length
    result +=
      prose(value.slice(offset, opening.index)) +
      inlineCode(
        value.slice(opening.index, end),
        value.slice(opening.index + opening[0].length, closing.index)
      )
    offset = end
    index = closingIndex
  }
  return result + prose(value.slice(offset))
}

function usageLine(entry: DocumentedCommand): string {
  const parts = ['sim', ...entry.path]
  for (const argument of entry.command.registeredArguments) {
    const name = argument.variadic ? `${argument.name()}...` : argument.name()
    parts.push(argument.required ? `<${name}>` : `[${name}]`)
  }
  if (documentedOptions(entry.command).length > 0) parts.push('[options]')
  return parts.join(' ')
}

const REQUIRED_SUFFIX = /\s*\(required\)\s*$/i

/**
 * Commander help already spells required-ness inside the description of a
 * derived flag. The table states it in its own column, so the trailing marker
 * would read as "Yes | Workflow ID (required)".
 */
function stripRequiredSuffix(description: string): string {
  return description.replace(REQUIRED_SUFFIX, '')
}

/**
 * Whether the flag must be supplied for the command to run.
 *
 * `option.mandatory` alone under-reports it. A destructive command's `--yes` is
 * enforced by the runtime rather than by Commander, deliberately: making it
 * mandatory would replace the refusal that names the consequence ("This deletes
 * the knowledge base and every document in it. Re-run with --yes to confirm.")
 * with Commander's bare "required option '--yes' not specified". The flag is
 * still required, and the description says so — which is the same marker
 * {@link stripRequiredSuffix} removes, so reading it here keeps the column and
 * the prose from contradicting each other.
 */
function isRequiredOption(option: Command['options'][number]): boolean {
  return option.mandatory || REQUIRED_SUFFIX.test(option.description || '')
}

/** Help text is written without terminal punctuation; appended clauses need it. */
function asSentence(value: string): string {
  if (!value) return ''
  return /[.!?]$/.test(value) ? value : `${value}.`
}

/**
 * Renders a default value for prose, or `''` when there is nothing to state.
 *
 * A repeatable flag's Commander default is `[]` — the empty accumulator its
 * collector appends to, not a value anyone would type — and `String([])` is the
 * empty string, which rendered as a dangling "Defaults to ``." The check is on
 * emptiness rather than falsiness: `false` and `0` are real defaults a caller
 * needs stated, and a `!value` guard would silently drop both.
 */
export function formatDefault(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map(String).join(', ') : ''
  }
  const text = String(value)
  return text.trim() ? text : ''
}

/** Returns a table-ready cell: escaped prose, with code spans left intact. */
export function describeOption(option: Command['options'][number]): string {
  const parts = [asSentence(escapeCell(stripRequiredSuffix(option.description || '')))]
  if (option.argChoices && option.argChoices.length > 0) {
    parts.push(`Accepted values: ${option.argChoices.map(code).join(', ')}.`)
  }
  const defaultValue = option.defaultValue ?? option.defaultValueDescription
  if (defaultValue !== undefined && !/\bdefault(?:s|ing)?\b/i.test(option.description)) {
    const fallback = formatDefault(defaultValue)
    if (fallback) parts.push(`Defaults to ${code(fallback)}.`)
  }
  const description = parts.filter(Boolean).join(' ')
  return description || '—'
}

/**
 * Wraps a Markdown table so `CommandTable` can size its columns.
 *
 * The blank lines are load-bearing: without them MDX treats the table as raw
 * JSX children and stops parsing it as Markdown.
 */
function sizedTable(rows: string[]): string[] {
  return ['', '<CommandTable>', '', ...rows, '', '</CommandTable>']
}

function renderArguments(entry: DocumentedCommand): string[] {
  const args = entry.command.registeredArguments
  if (args.length === 0) return []

  // Positional descriptions come from the route contract and are usually absent;
  // a column of em-dashes is worse than no column.
  const described = args.some((argument) => Boolean(argument.description))

  const rows = args.map((argument) => {
    const name = argument.variadic ? `${argument.name()}...` : argument.name()
    const required = argument.required ? 'Yes' : 'No'
    const cells = [code(name), required]
    if (described) cells.push(escapeCell(argument.description) || '—')
    return `| ${cells.join(' | ')} |`
  })

  const header = described ? '| Argument | Required | Description |' : '| Argument | Required |'
  const divider = described ? '| --- | --- | --- |' : '| --- | --- |'
  return ['', '**Arguments**', ...sizedTable([header, divider, ...rows])]
}

function renderOptions(entry: DocumentedCommand): string[] {
  const options = documentedOptions(entry.command)
  if (options.length === 0) return []

  const rows = options.map(
    (option) =>
      `| ${code(option.flags)} | ${isRequiredOption(option) ? 'Yes' : /\brequired (?:when|with|unless|only)/i.test(option.description) ? 'Conditional' : 'No'} | ${describeOption(option)} |`
  )

  return [
    '',
    '**Options**',
    ...sizedTable(['| Option | Required | Description |', '| --- | --- | --- |', ...rows]),
  ]
}

/**
 * Words that must keep their casing when a heading is sentence-cased.
 *
 * The test for "this word was capitalized only because the summary is Title
 * Case" cannot tell `Documents` from `JSON`, and lowercasing the latter is the
 * more visible mistake.
 */
const ACRONYMS = new Set([
  'API',
  'APIs',
  'CSV',
  'ID',
  'IDs',
  'JSON',
  'MCP',
  'OAuth',
  'Sim',
  'SSE',
  'SSO',
  'URL',
  'YAML',
  'OIDC',
  'SAML',
  'PKCE',
  'DNS',
  'UTC',
])

/**
 * The command's one-line description, as a heading.
 *
 * The command itself is the obvious heading and is the wrong one: every entry
 * on a page shares the same `sim <group>` prefix, so the table of contents
 * became a column of "sim knowledge documents …" that has to be read to the
 * last word to tell two entries apart. The description distinguishes them at
 * the first word instead, and the exact invocation is still directly below in
 * the code block.
 *
 * A trailing parenthetical is dropped — those qualify behavior ("(requested
 * outputs are included in JSON or YAML output)") and belong in the body, not in
 * a sidebar entry.
 */
function sentenceCase(value: string): string {
  return value
    .trim()
    .split(' ')
    .map((word, index) => {
      if (ACRONYMS.has(word)) return word
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1)
      return /^[A-Z][a-z]+$/.test(word) ? word.toLowerCase() : word
    })
    .join(' ')
}

function headingFor(entry: DocumentedCommand): string {
  const description = entry.command.description()
  return description
    ? sentenceCase(description.replace(/\s*\([^)]*\)\s*$/, ''))
    : `sim ${entry.path.join(' ')}`
}

function orderedCommands(entries: DocumentedCommand[]): DocumentedCommand[] {
  const rank = (entry: DocumentedCommand): number => {
    const verb = entry.path.at(-1)
    const index = VERB_ORDER.findIndex((candidate) => candidate === verb)
    return index < 0 ? VERB_ORDER.length : index
  }
  return [...entries].sort(
    (left, right) =>
      rank(left) - rank(right) || compareStrings(left.path.join(' '), right.path.join(' '))
  )
}

/** Reads command-specific help additions without emitting the root’s help epilogue. */
function additionalHelp(command: Command): string[] {
  const chunks: string[] = []
  const context = { error: false, command, write: (value: string) => chunks.push(value) }
  const helpEvents = command as Command & EventEmitter
  helpEvents.emit('afterHelp', context)
  const text = chunks.join('').trim()
  if (!text) return []
  const [prose = '', examples] = text.split(/\nExamples:\s*\n/, 2)
  const lines = prose
    .split(/\n\s*\n/)
    .flatMap((paragraph) => [escapeProse(paragraph.replace(/\s*\n\s*/g, ' ').trim()), ''])
  if (examples) {
    lines.push(
      '**Examples**',
      '',
      '```bash',
      ...examples
        .trim()
        .split('\n')
        .map((line) => line.trim().replace(/^\$ /, '')),
      '```',
      ''
    )
  }
  return lines
}

function relatedDocs(documentation: GroupDocumentation | undefined): string[] {
  if (!documentation?.related?.length) return []
  return [
    '## Related docs',
    '',
    ...documentation.related.map(([label, url]) => `- [${label}](${url})`),
    '',
  ]
}

interface RenderOptions {
  /** Markdown heading depth, so the master page can nest commands under groups. */
  level?: number
  /**
   * Use the invocation as the heading instead of the description.
   *
   * Correct on the master page for two reasons: descriptions are only unique
   * within a group, so "Delete folder" would collide four ways across one page;
   * and a reader — human or agent — arriving at a page of every command is
   * looking one up by name, not browsing by task.
   */
  commandHeadings?: boolean
  referenceLinks?: ReadonlyMap<string, string>
}

function renderCommand(entry: DocumentedCommand, options: RenderOptions = {}): string[] {
  const { level = 2, commandHeadings = false, referenceLinks } = options
  const aliases = entry.command.aliases()
  const heading = commandHeadings ? `sim ${entry.path.join(' ')}` : headingFor(entry)
  const description = entry.command.description()
  const operation = operationOf(entry.command)
  const spec = operation ? CLI_CONTRACT[operation] : undefined
  const anchor = commandHeadings ? undefined : LEGACY_COMMAND_ANCHORS[entry.path.join(' ')]
  const lines = [`${'#'.repeat(level)} ${escapeProse(heading)}${anchor ? ` [#${anchor}]` : ''}`, '']
  if (commandHeadings && description) lines.push(escapeProse(sentenceCase(description)), '')
  if (!commandHeadings) {
    const qualifier = /\s*\(([^)]*)\)\s*$/.exec(description)?.[1]
    if (qualifier)
      lines.push(
        escapeProse(asSentence(qualifier.charAt(0).toUpperCase() + qualifier.slice(1))),
        ''
      )
  }
  if (spec?.confirm) lines.push(escapeProse(spec.confirm), '')
  for (const note of COMMAND_NOTES[entry.path.join(' ')] ?? []) lines.push(escapeProse(note), '')
  lines.push('```bash', usageLine(entry), '```')
  if (aliases.length > 0) {
    const spelled = aliases.map((alias) =>
      code(`sim ${[...entry.path.slice(0, -1), alias].join(' ')}`)
    )
    lines.push('', `Also available as ${spelled.join(', ')}.`)
  }
  lines.push(
    ...renderArguments(entry),
    ...renderOptions(entry),
    '',
    ...additionalHelp(entry.command)
  )
  const references = operation ? [operation] : (calledOperations(entry.command) ?? [])
  const links = references.flatMap((name) => {
    const apiOperation = V2_OPERATIONS[name]
    const url =
      referenceLinks?.get(name) ??
      referenceLinks?.get(
        `${apiOperation.method} ${apiOperation.path.replace(/\[([^\]]+)\]/g, '{$1}')}`
      )
    return url ? [`[${name}](${url})`] : []
  })
  if (links.length) lines.push(`API request and response schemas: ${links.join(', ')}.`, '')
  return lines
}

function frontmatter(title: string, description: string, hasTables = true): string[] {
  return [
    '---',
    `title: ${title}`,
    `description: ${description}`,
    '---',
    '',
    ...(hasTables ? ["import { CommandTable } from '@/components/ui/command-table'"] : []),
    '',
  ]
}

/**
 * Fails when two commands on one page reduce to the same heading.
 *
 * Headings are descriptions now, and descriptions are not guaranteed unique the
 * way command paths are. Two identical `## ` headings would collide on the same
 * anchor, so one table-of-contents entry would scroll to the other command. The
 * fix is a distinguishing `describe` in the CLI contract.
 */
function assertDistinctHeadings(page: string, entries: DocumentedCommand[]): void {
  const byHeading = new Map<string, string[]>()
  for (const entry of entries) {
    const heading = headingFor(entry)
    byHeading.set(heading, [...(byHeading.get(heading) ?? []), `sim ${entry.path.join(' ')}`])
  }

  const collisions = [...byHeading].filter(([, commands]) => commands.length > 1)
  if (collisions.length === 0) return

  for (const [heading, commands] of collisions) {
    console.error(`${page}: "${heading}" is the heading for ${commands.join(' and ')}`)
  }
  console.error(
    '\nTwo commands on a page share a heading, so they share an anchor.\n' +
      'Give one a distinct `describe` in packages/sim-cli/src/contract/commands.ts.'
  )
  process.exit(1)
}

/**
 * Every command on one page.
 *
 * A reference split across fourteen pages is fine to browse and bad to consult:
 * an agent, or anyone using in-page search, has to guess which page holds a
 * command before it can read it. This is the single fetch that answers any
 * question about the surface — the same shape as Claude Code's own
 * `cli-reference`, and the page `/cli/reference.mdx` serves as raw Markdown.
 */
function renderReferencePage(
  program: Command,
  groups: Command[],
  globals: DocumentedCommand[],
  referenceLinks: ReadonlyMap<string, string>
): string {
  const lines = [
    ...frontmatter('Complete reference', 'Every sim command, argument, and flag on a single page'),
    'Every command on one page, generated from the CLI itself. Start at the',
    '[overview](/cli/commands) to browse; this page is for searching and for tools.',
    '',
    'Append `.mdx` to an authored guide or CLI reference page for its raw Markdown —',
    '[`/cli/reference.mdx`](/cli/reference.mdx) is this page as plain text. The docs',
    'are also published as [`/llms.txt`](/llms.txt) and',
    '[`/llms-full.txt`](/llms-full.txt).',
    '',
    '## Global options',
    '',
    'Place these options before or after the command. Each command uses the settings',
    'relevant to its action. Telemetry commands always print text; workflow export',
    'prints a portable JSON document, or YAML when selected.',
    // Deliberately unwrapped, like the same table on the overview page:
    // `CommandTable` sizes its second column for the `Required` cell of the
    // three-column tables, which on this two-column one would crush the
    // description into 5.5rem.
    '',
    '| Option | Description |',
    '| --- | --- |',
    ...documentedOptions(program).map(
      (option) => `| ${code(option.flags)} | ${describeOption(option)} |`
    ),
    '',
  ]

  lines.push(
    'Use `--help` to inspect a command. `sim --version` prints the CLI version,',
    'takes no value, and exits without running a command. Deployment-version commands',
    'use their documented arguments or `--to-version`.',
    '',
    'API schema links describe HTTP payloads. See [CLI output formats](/cli/output)',
    'for resource unwrapping, pagination envelopes, and display formats.',
    ''
  )

  for (const leaf of globals)
    lines.push(...renderCommand(leaf, { commandHeadings: true, referenceLinks }))

  for (const group of groups) {
    lines.push(`## sim ${group.name()}`, '')
    const documentation = GROUP_DOCUMENTATION[group.name()]
    if (documentation) lines.push(escapeProse(documentation.description), '')
    for (const note of documentation?.notes ?? []) lines.push(escapeProse(note), '')
    const aliases = group.aliases()
    if (aliases.length > 0) {
      lines.push(`Also spelled ${aliases.map((alias) => `\`sim ${alias}\``).join(', ')}.`, '')
    }
    for (const leaf of collectLeaves(group, [group.name()])) {
      lines.push(...renderCommand(leaf, { level: 3, commandHeadings: true, referenceLinks }))
    }
  }

  return `${lines.join('\n').trimEnd()}\n`
}

function renderGroupPage(group: Command, referenceLinks: ReadonlyMap<string, string>): string {
  const name = group.name()
  const leaves = collectLeaves(group, [name])
  const aliases = group.aliases()
  const documentation = GROUP_DOCUMENTATION[name]
  const description = documentation?.description ?? sentenceCase(group.description())
  assertDistinctHeadings(`${name}.mdx`, leaves)
  const hasTables = leaves.some(
    (entry) =>
      entry.command.registeredArguments.length > 0 || documentedOptions(entry.command).length > 0
  )
  const lines = [...frontmatter(titleFor(name), description, hasTables), description, '']
  for (const note of documentation?.notes ?? []) lines.push(escapeProse(note), '')
  if (aliases.length > 0) {
    lines.push(
      `\`sim ${name}\` is also spelled ${aliases.map((alias) => `\`sim ${alias}\``).join(', ')}.`,
      ''
    )
  }
  lines.push('These commands accept the [global options](/cli/commands#global-options).', '')
  const sections = GROUP_SECTIONS[name]
  if (sections) {
    const remaining = new Set(leaves)
    for (const section of sections) {
      const entries: DocumentedCommand[] = []
      for (const prefix of section.prefixes) {
        const matches = [...remaining].filter((entry) => {
          const relative = entry.path.slice(1).join(' ')
          return relative === prefix || relative.startsWith(`${prefix} `)
        })
        for (const entry of orderedCommands(matches)) {
          entries.push(entry)
          remaining.delete(entry)
        }
      }
      if (!entries.length) continue
      lines.push(`## ${section.title}`, '')
      for (const entry of entries) lines.push(...renderCommand(entry, { level: 3, referenceLinks }))
    }
    if (remaining.size) {
      lines.push('## Other commands', '')
      for (const entry of orderedCommands([...remaining]))
        lines.push(...renderCommand(entry, { level: 3, referenceLinks }))
    }
  } else {
    for (const entry of orderedCommands(leaves))
      lines.push(...renderCommand(entry, { referenceLinks }))
  }
  lines.push(...relatedDocs(documentation))
  return `${lines.join('\n').trimEnd()}\n`
}

function renderIndexPage(
  program: Command,
  groups: Command[],
  globals: DocumentedCommand[],
  referenceLinks: ReadonlyMap<string, string>
): string {
  const lines = [
    ...frontmatter(
      'CLI commands',
      'Find command groups, global options, and login, configuration, and Chat commands.'
    ),
    'Resource commands use this shape:',
    '',
    '```bash',
    'sim <resource> [sub-resource] <verb> [arguments] [options]',
    '```',
    '',
    'Some resource groups also accept a singular alias: `sim workflow get` and',
    '`sim workflows get` are the same command. `knowledge` also answers to `kb`.',
    'Each group’s reference lists its supported aliases. Login, configuration, and',
    'Chat commands appear below. To find a command for a task, use',
    '`sim cli search "describe your task"`.',
    '',
    '## Global options',
    '',
    'Place these options before or after the command. Each command uses the settings',
    'relevant to its action. Telemetry commands always print text; workflow export',
    'prints a portable JSON document, or YAML when selected.',
    '',
    '| Option | Description |',
    '| --- | --- |',
    ...documentedOptions(program).map(
      (option) => `| ${code(option.flags)} | ${describeOption(option)} |`
    ),
    '',
    'Use `--help` to inspect a command. Run `sim --version` to print the CLI version;',
    '`--version` takes no value and exits without running a command. Deployment-version',
    'commands use their documented arguments or `--to-version` instead.',
    '',
    'See [output formats](/cli/output) for the JSON default and display formats.',
    '',
    '## Command groups',
    '',
    '| Group | Description |',
    '| --- | --- |',
    ...groups.map(
      (group) =>
        `| [${code(`sim ${group.name()}`)}](/cli/${group.name()}) | ${escapeCell(GROUP_DOCUMENTATION[group.name()]?.description ?? sentenceCase(group.description())) || '—'} |`
    ),
    '',
  ]

  for (const leaf of globals) lines.push(...renderCommand(leaf, { referenceLinks }))

  lines.push(
    '## Related docs',
    '',
    '- [Complete command reference](/cli/reference)',
    '- [Authentication](/cli/authentication)',
    '- [Scripting](/cli/scripting)',
    ''
  )
  return `${lines.join('\n').trimEnd()}\n`
}

/**
 * The section's sidebar.
 *
 * Generated because the command-group entries are, and a hand-maintained copy
 * would drift the moment a group is added. The hand-written guides stay in
 * `GUIDE_PAGES` so adding one is an edit here rather than a change to how the
 * pages are produced.
 */
function renderMeta(groups: Command[]): string {
  return `${JSON.stringify(
    {
      title: 'CLI',
      root: true,
      pages: [
        '---Sim CLI---',
        ...GUIDE_PAGES,
        '---Commands---',
        OVERVIEW_PAGE,
        ...groups.map((group) => group.name()),
        REFERENCE_PAGE,
      ],
    },
    null,
    2
  )}\n`
}

/**
 * Fails on two commands sharing one invocation path.
 *
 * Commander resolves a duplicate name to the first registered match, so the
 * loser is unreachable from the terminal while still appearing in `--help` —
 * which is how `knowledge documents update` shadowed the single-document
 * update. Left alone the generator would emit two identical headings and
 * document a command nobody can run, so the collision fails the build here
 * instead: the fix is a `command` entry in the CLI contract.
 */
function assertNoDuplicatePaths(leaves: DocumentedCommand[]): void {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const leaf of leaves) {
    const invocation = leaf.path.join(' ')
    if (seen.has(invocation)) duplicates.add(invocation)
    seen.add(invocation)
  }
  if (duplicates.size === 0) return
  for (const invocation of duplicates) {
    console.error(`duplicate command path: sim ${invocation}`)
  }
  console.error(
    '\nTwo operations derive to the same command, so one is unreachable.\n' +
      'Give one of them a `command` in packages/sim-cli/src/contract/commands.ts.'
  )
  process.exit(1)
}

/**
 * Fails on a request field that documents itself nowhere.
 *
 * Without a `.describe()` on the route contract, the CLI can only fall back to
 * restating the flag name — `--sort-by  Set sort by` — and that fallback lands
 * verbatim in `--help` and in these pages. It reads like documentation while
 * telling the reader nothing, which is worse than an obvious hole.
 *
 * The contract is the right place to fix it because the same prose feeds the
 * OpenAPI specs and the API reference, so one `.describe()` documents the
 * field everywhere it appears.
 *
 * `workspaceId` and `cursor` are exempt: neither is ever a flag — the profile
 * supplies one and pagination consumes the other.
 */
function assertEveryFieldDocumented(): void {
  const undocumented: string[] = []

  for (const [operation, spec] of Object.entries(V2_OPERATIONS)) {
    for (const slot of ['query', 'body'] as const) {
      const fields = (spec as Record<string, unknown>)[slot]
      if (!fields || typeof fields !== 'object') continue
      for (const [field, descriptor] of Object.entries(fields)) {
        if (field === 'workspaceId' || field === 'cursor') continue
        const described = (descriptor as { describe?: unknown }).describe
        if (typeof described !== 'string' || !described.trim()) {
          undocumented.push(`${operation}.${slot}.${field}`)
        }
      }
    }
  }

  if (undocumented.length === 0) return
  for (const field of undocumented) console.error(`undocumented request field: ${field}`)
  console.error(
    `\n${undocumented.length} field(s) would render as "Set <name>" in --help and in the docs.\n` +
      'Add a `.describe()` in apps/sim/lib/api/contracts/v2, then run:\n' +
      '  bun run generate:cli-api && bun run generate:cli-docs'
  )
  process.exit(1)
}

/** The sidebar names every guide, so a renamed or deleted one must not fail silently. */
function assertGuidesExist(): void {
  const missing = GUIDE_PAGES.filter((page) => !fs.existsSync(path.join(OUTPUT_DIR, `${page}.mdx`)))
  if (missing.length === 0) return
  for (const page of missing) console.error(`missing hand-written guide: cli/${page}.mdx`)
  console.error('\nCreate it, or drop it from GUIDE_PAGES in scripts/generate-cli-docs.ts.')
  process.exit(1)
}

function build(): Map<string, string> {
  assertEveryFieldDocumented()
  assertGuidesExist()

  const program = buildProgram({ version: false })
  const top = subcommands(program)
  const groups = top.filter((command) => subcommands(command).length > 0)
  const globals = top
    .filter((command) => subcommands(command).length === 0)
    .map((command) => ({ path: [command.name()], command }))

  assertNoDuplicatePaths([
    ...groups.flatMap((group) => collectLeaves(group, [group.name()])),
    ...globals,
  ])

  const referenceLinks = apiReferenceLinks()
  const files = new Map<string, string>()
  files.set('meta.json', renderMeta(groups))
  files.set(`${OVERVIEW_PAGE}.mdx`, renderIndexPage(program, groups, globals, referenceLinks))
  files.set(`${REFERENCE_PAGE}.mdx`, renderReferencePage(program, groups, globals, referenceLinks))
  for (const group of groups)
    files.set(`${group.name()}.mdx`, renderGroupPage(group, referenceLinks))
  return files
}

/** Generated pages already on disk. Hand-written guides are not the sweep's to remove. */
function currentFiles(): Map<string, string> {
  if (!fs.existsSync(OUTPUT_DIR)) return new Map()
  const guides = new Set<string>(GUIDE_PAGES.map((page) => `${page}.mdx`))
  return new Map(
    fs
      .readdirSync(OUTPUT_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !guides.has(entry.name))
      .map(
        (entry) => [entry.name, fs.readFileSync(path.join(OUTPUT_DIR, entry.name), 'utf8')] as const
      )
  )
}

function main(): void {
  const check = process.argv.includes('--check')
  const expected = build()
  const actual = currentFiles()

  const stale = [...actual.keys()].filter((name) => !expected.has(name))
  const changed = [...expected.entries()].filter(([name, content]) => actual.get(name) !== content)

  if (check) {
    if (stale.length === 0 && changed.length === 0) {
      console.log(`CLI docs are up to date (${expected.size} files).`)
      return
    }
    for (const name of changed)
      console.error(`stale: ${path.relative(ROOT, path.join(OUTPUT_DIR, name[0]))}`)
    for (const name of stale)
      console.error(`orphaned: ${path.relative(ROOT, path.join(OUTPUT_DIR, name))}`)
    console.error('\nRun `bun run generate:cli-docs` and commit the result.')
    process.exit(1)
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  for (const name of stale) fs.rmSync(path.join(OUTPUT_DIR, name))
  for (const [name, content] of expected) {
    fs.writeFileSync(path.join(OUTPUT_DIR, name), content)
  }
  console.log(
    `Wrote ${expected.size} files to ${path.relative(ROOT, OUTPUT_DIR)}` +
      (stale.length > 0 ? `, removed ${stale.length} orphaned` : '')
  )
}

// Guarded so the pure helpers above can be imported by tests without the
// generator rewriting the docs as a side effect of the import.
if (import.meta.main) main()
