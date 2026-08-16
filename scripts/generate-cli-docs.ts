#!/usr/bin/env bun

/**
 * Generates the CLI command reference under `apps/docs/content/docs/en/cli/commands`.
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
import { buildProgram } from '../packages/sim-cli/src/program'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT_DIR = path.join(ROOT, 'apps/docs/content/docs/en/cli/commands')

/** Commander's synthetic help command is not part of the documented surface. */
const HELP_COMMAND = 'help'

/**
 * Sidebar titles for groups whose command name does not title-case cleanly.
 * Everything else gets its hyphens split and each word capitalized.
 */
const GROUP_TITLES: Record<string, string> = {
  'audit-logs': 'Audit Logs',
  'custom-tools': 'Custom Tools',
  'mcp-servers': 'MCP Servers',
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

function subcommands(command: Command): Command[] {
  return command.commands.filter((child) => child.name() !== HELP_COMMAND)
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
  return `\`${value.replace(/\|/g, '\\|')}\``
}

/**
 * Escapes prose — text NOT inside a code span — for a Markdown table cell.
 *
 * Here the entities are the right answer: MDX reads `{` as the start of a JS
 * expression and `<` as the start of a JSX tag, and both appear in help text
 * that embeds JSON examples.
 */
function escapeCell(value: string): string {
  return escapeProse(value).replace(/\|/g, '\\|')
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
  if (entry.command.options.length > 0) parts.push('[options]')
  return parts.join(' ')
}

/**
 * Commander help already spells required-ness inside the description of a
 * derived flag. The table states it in its own column, so the trailing marker
 * would read as "Yes | Workflow ID (required)".
 */
function stripRequiredSuffix(description: string): string {
  return description.replace(/\s*\(required\)\s*$/i, '')
}

/** Help text is written without terminal punctuation; appended clauses need it. */
function asSentence(value: string): string {
  if (!value) return ''
  return /[.!?]$/.test(value) ? value : `${value}.`
}

/** Returns a table-ready cell: escaped prose, with code spans left intact. */
function describeOption(option: Command['options'][number]): string {
  const parts = [asSentence(escapeCell(stripRequiredSuffix(option.description || '')))]
  if (option.argChoices && option.argChoices.length > 0) {
    parts.push(`Accepted values: ${option.argChoices.map(code).join(', ')}.`)
  }
  if (option.defaultValue !== undefined) {
    parts.push(`Defaults to ${code(String(option.defaultValue))}.`)
  }
  const description = parts.filter(Boolean).join(' ')
  return description || '—'
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
  return ['', '**Arguments**', '', header, divider, ...rows]
}

function renderOptions(entry: DocumentedCommand): string[] {
  const options = entry.command.options
  if (options.length === 0) return []

  const rows = options.map(
    (option) =>
      `| ${code(option.flags)} | ${option.mandatory ? 'Yes' : 'No'} | ${describeOption(option)} |`
  )

  return [
    '',
    '**Options**',
    '',
    '| Option | Required | Description |',
    '| --- | --- | --- |',
    ...rows,
  ]
}

function renderCommand(entry: DocumentedCommand): string[] {
  const heading = `sim ${entry.path.join(' ')}`
  const description = entry.command.description()
  const aliases = entry.command.aliases()

  const lines = [`## ${heading}`, '']
  if (description) lines.push(escapeProse(description), '')
  lines.push('```bash', usageLine(entry), '```')
  if (aliases.length > 0) {
    const spelled = aliases.map(
      (alias) => `\`sim ${[...entry.path.slice(0, -1), alias].join(' ')}\``
    )
    lines.push('', `Also available as ${spelled.join(', ')}.`)
  }
  lines.push(...renderArguments(entry), ...renderOptions(entry), '')
  return lines
}

function frontmatter(title: string, description: string): string[] {
  return ['---', `title: ${title}`, `description: ${description}`, '---', '']
}

function renderGroupPage(group: Command): string {
  const name = group.name()
  const leaves = collectLeaves(group, [name])
  const aliases = group.aliases()

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
    ...frontmatter('Overview', 'Every sim command, with its arguments and flags'),
    'Every `sim` command follows the same shape:',
    '',
    '```bash',
    'sim <resource> [sub-resource] <verb> [arguments] [options]',
    '```',
    '',
    'Resource groups are plural, and each one also accepts its singular spelling —',
    '`sim workflow get` and `sim workflows get` are the same command. `knowledge`',
    'additionally answers to `kb`.',
    '',
    '## Global options',
    '',
    'These apply to every command, and may be written before or after it.',
    '',
    '| Option | Description |',
    '| --- | --- |',
    ...program.options.map((option) => `| ${code(option.flags)} | ${describeOption(option)} |`),
    '',
    '## Command groups',
    '',
    '| Group | Description |',
    '| --- | --- |',
    ...groups.map(
      (group) =>
        `| [${code(`sim ${group.name()}`)}](/cli/commands/${group.name()}) | ${escapeCell(group.description()) || '—'} |`
    ),
    '',
  ]

  for (const leaf of globals) lines.push(...renderCommand(leaf))

  return `${lines.join('\n').trimEnd()}\n`
}

function renderMeta(groups: Command[]): string {
  return `${JSON.stringify(
    {
      title: 'Commands',
      defaultOpen: true,
      pages: ['index', ...groups.map((group) => group.name())],
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

function build(): Map<string, string> {
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
  files.set('index.mdx', renderIndexPage(program, groups, globals))
  for (const group of groups) files.set(`${group.name()}.mdx`, renderGroupPage(group))
  return files
}

function currentFiles(): Map<string, string> {
  if (!fs.existsSync(OUTPUT_DIR)) return new Map()
  const entries = fs.readdirSync(OUTPUT_DIR)
  return new Map(
    entries.map((name) => [name, fs.readFileSync(path.join(OUTPUT_DIR, name), 'utf8')] as const)
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

main()
