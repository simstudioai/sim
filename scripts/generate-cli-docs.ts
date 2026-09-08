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

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Command } from 'commander'
import { V2_OPERATIONS } from '../packages/sim-cli/src/generated/v2-api'
import { buildProgram } from '../packages/sim-cli/src/program'

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
  'troubleshooting',
] as const

/** Generated page holding the global options and the commands that take no resource. */
const OVERVIEW_PAGE = 'commands'

/** Generated page carrying every command at once, for search and for agents. */
const REFERENCE_PAGE = 'reference'

/**
 * Sidebar titles for groups whose command name does not title-case cleanly.
 * Everything else gets its hyphens split and each word capitalized.
 */
const GROUP_TITLES: Record<string, string> = {
  'audit-logs': 'Audit Logs',
  'custom-tools': 'Custom Tools',
  'mcp-servers': 'MCP Servers',
  'workflow-mcp-servers': 'Workflow MCP Servers',
  cli: 'CLI',
}

interface DocumentedCommand {
  /** Full invocation path, e.g. `workflows runs get`. */
  path: string[]
  command: Command
}

function titleFor(name: string): string {
  const override = GROUP_TITLES[name]
  if (override) return override
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
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
  return `\`${escapeTablePipes(value)}\``
}

/**
 * Escapes a value so a Markdown table row cannot be split by its content.
 *
 * A backslash has to be doubled before pipes are escaped, or an input already
 * ending in one turns `a\` + `|` into `a\\|`: the table parser reads `\\` as an
 * escaped backslash, leaving the pipe unescaped, and the cell splits early.
 *
 * The doubling is correct inside a code span too, even though code spans do not
 * process backslash escapes — the table layer consumes one level of escaping
 * before inline parsing runs, so `a\\\|` arrives at the code span as `a\|`.
 */
function escapeTablePipes(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
}

/**
 * Escapes prose — text NOT inside a code span — for a Markdown table cell.
 *
 * Here the entities are the right answer: MDX reads `{` as the start of a JS
 * expression and `<` as the start of a JSX tag, and both appear in help text
 * that embeds JSON examples.
 */
function escapeCell(value: string): string {
  return escapeTablePipes(escapeProse(value))
}

/** Escapes MDX-significant characters in body prose. */
function escapeProse(value: string): string {
  return value
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;')
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
  if (option.defaultValue !== undefined) {
    const fallback = formatDefault(option.defaultValue)
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
      `| ${code(option.flags)} | ${isRequiredOption(option) ? 'Yes' : 'No'} | ${describeOption(option)} |`
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
function headingFor(entry: DocumentedCommand): string {
  const description = entry.command.description()
  if (!description) return `sim ${entry.path.join(' ')}`

  return description
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
    .split(' ')
    .map((word, index) => {
      if (ACRONYMS.has(word)) return word
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1)
      // Only fold words that look Title-Cased; `--tag` or `blockName` stay put.
      return /^[A-Z][a-z]+$/.test(word) ? word.toLowerCase() : word
    })
    .join(' ')
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
}

function renderCommand(entry: DocumentedCommand, options: RenderOptions = {}): string[] {
  const { level = 2, commandHeadings = false } = options
  const aliases = entry.command.aliases()
  const heading = commandHeadings ? `sim ${entry.path.join(' ')}` : headingFor(entry)
  const description = entry.command.description()

  const lines = [`${'#'.repeat(level)} ${escapeProse(heading)}`, '']
  if (commandHeadings && description) lines.push(escapeProse(description), '')
  lines.push('```bash', usageLine(entry), '```')
  // Only when the heading dropped something — otherwise this restates it.
  if (
    !commandHeadings &&
    description &&
    description !== heading &&
    description.trimEnd().endsWith(')')
  ) {
    lines.push('', escapeProse(description))
  }
  if (aliases.length > 0) {
    const spelled = aliases.map(
      (alias) => `\`sim ${[...entry.path.slice(0, -1), alias].join(' ')}\``
    )
    lines.push('', `Also available as ${spelled.join(', ')}.`)
  }
  lines.push(...renderArguments(entry), ...renderOptions(entry), '')
  return lines
}

function frontmatter(title: string, description: string, imports: string[] = []): string[] {
  return [
    '---',
    `title: ${title}`,
    `description: ${description}`,
    '---',
    '',
    "import { CommandTable } from '@/components/ui/command-table'",
    ...imports,
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
  globals: DocumentedCommand[]
): string {
  const lines = [
    ...frontmatter('Complete reference', 'Every sim command, argument, and flag on a single page'),
    'Every command on one page, generated from the CLI itself. Start at the',
    '[overview](/cli/commands) to browse; this page is for searching and for tools.',
    '',
    'Append `.mdx` to any page for its raw Markdown —',
    '[`/cli/reference.mdx`](/cli/reference.mdx) is this page as plain text. The docs',
    'are also published as [`/llms.txt`](/llms.txt) and',
    '[`/llms-full.txt`](/llms-full.txt).',
    '',
    '## Global options',
    '',
    'These apply to every command, and may be written before or after it.',
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

  for (const leaf of globals) lines.push(...renderCommand(leaf, { commandHeadings: true }))

  for (const group of groups) {
    lines.push(`## sim ${group.name()}`, '')
    const aliases = group.aliases()
    if (aliases.length > 0) {
      lines.push(`Also spelled ${aliases.map((alias) => `\`sim ${alias}\``).join(', ')}.`, '')
    }
    for (const leaf of collectLeaves(group, [group.name()])) {
      lines.push(...renderCommand(leaf, { level: 3, commandHeadings: true }))
    }
  }

  return `${lines.join('\n').trimEnd()}\n`
}

function renderGroupPage(group: Command): string {
  const name = group.name()
  const leaves = collectLeaves(group, [name])
  const aliases = group.aliases()

  assertDistinctHeadings(`${name}.mdx`, leaves)

  const lines = [
    ...frontmatter(
      titleFor(name),
      `${group.description() || `The sim ${name} commands`} — every subcommand, argument, and flag`
    ),
  ]

  if (aliases.length > 0) {
    lines.push(
      `\`sim ${name}\` is also spelled ${aliases.map((alias) => `\`sim ${alias}\``).join(', ')}.`,
      ''
    )
  }

  lines.push(
    'Every command below also accepts the [global options](/cli/commands#global-options).',
    ''
  )

  for (const leaf of leaves) lines.push(...renderCommand(leaf))

  return `${lines.join('\n').trimEnd()}\n`
}

function renderIndexPage(
  program: Command,
  groups: Command[],
  globals: DocumentedCommand[]
): string {
  const lines = [
    ...frontmatter('CLI Commands', 'Global options, and every sim command group'),
    'Every `sim` command follows the same shape:',
    '',
    '```bash',
    'sim <resource> [sub-resource] <verb> [arguments] [options]',
    '```',
    '',
    'Some resource groups also accept a singular alias: `sim workflow get` and',
    '`sim workflows get` are the same command. `knowledge` also answers to `kb`.',
    'Each group’s reference lists its supported aliases.',
    '',
    '## Global options',
    '',
    'These apply to every command, and may be written before or after it.',
    '',
    '| Option | Description |',
    '| --- | --- |',
    ...documentedOptions(program).map(
      (option) => `| ${code(option.flags)} | ${describeOption(option)} |`
    ),
    '',
    '## Command groups',
    '',
    '| Group | Description |',
    '| --- | --- |',
    ...groups.map(
      (group) =>
        `| [${code(`sim ${group.name()}`)}](/cli/${group.name()}) | ${escapeCell(group.description()) || '—'} |`
    ),
    '',
  ]

  for (const leaf of globals) lines.push(...renderCommand(leaf))

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

  const files = new Map<string, string>()
  files.set('meta.json', renderMeta(groups))
  files.set(`${OVERVIEW_PAGE}.mdx`, renderIndexPage(program, groups, globals))
  files.set(`${REFERENCE_PAGE}.mdx`, renderReferencePage(program, groups, globals))
  for (const group of groups) files.set(`${group.name()}.mdx`, renderGroupPage(group))
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
