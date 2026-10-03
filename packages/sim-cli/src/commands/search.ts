import { Command } from 'commander'
import MiniSearch from 'minisearch'
import { profileFrom } from '../context'
import { type Column, printList } from '../output/render'

/** Enough to pick from without flooding an agent's context. */
const MAX_RESULTS = 5

/**
 * A command's name is the strongest signal and its flags the weakest: a flag
 * description mentions other resources in passing ("Workflow ID"), so weighting
 * it heavily would rank every command that takes `--workflow` as a workflow
 * command.
 */
const FIELD_BOOST = { command: 8, summary: 5, context: 0.5 } as const

/**
 * Filler in a plain-language query. Left in, prefix matching turns `a` or `i`
 * into a match on every word that starts with that letter, burying the one
 * content word that names the command.
 */
const STOP_WORDS: ReadonlySet<string> = new Set(
  'a am an and are as at be by can do does for from how i in into is it me my of on or so that the this to what when where which why with you your'.split(
    ' '
  )
)

/** Shorter terms prefix- or fuzzy-match too much of the index to mean anything. */
const MIN_EXPANDED_TERM_LENGTH = 3
const MIN_FUZZY_TERM_LENGTH = 5

const SEARCH_OPTIONS = {
  boost: FIELD_BOOST,
  processTerm: (term: string) => {
    const lower = term.toLowerCase()
    return STOP_WORDS.has(lower) ? null : lower
  },
  prefix: (term: string) => term.length >= MIN_EXPANDED_TERM_LENGTH,
  fuzzy: (term: string) => (term.length >= MIN_FUZZY_TERM_LENGTH ? 0.2 : false),
}

/**
 * A trailing qualifier says how a command behaves, not what it does. Indexed,
 * "(OAuth login or personal API key required)" — stamped on dozens of commands —
 * made each of them a strong match for "log in" or "api key".
 */
const TRAILING_PARENTHETICAL = /\s*\([^)]*\)\s*$/

interface SearchDocument {
  command: string
  /** The summary as printed, qualifier included. */
  display: string
  /** The summary with its trailing qualifier removed, so only what the command does is ranked. */
  summary: string
  context: string
}

export interface SearchResult {
  command: string
  summary: string
}

const COLUMNS: Column<SearchResult>[] = [
  { header: 'command', value: (result) => result.command },
  { header: 'summary', value: (result) => result.summary },
]

/** Commander records a hidden command on a private field and offers no getter. */
function isHidden(command: Command): boolean {
  return (command as Command & { _hidden?: boolean })._hidden === true
}

function visibleSubcommands(command: Command): Command[] {
  return command.commands.filter((child) => child.name() !== 'help' && !isHidden(child))
}

/**
 * One document per runnable command, read from the same tree the terminal
 * parses, so the index can never name a command that does not exist or miss a
 * hand-written one.
 */
function collectDocuments(
  command: Command,
  path: string[],
  ancestors: string[],
  exclude: Command
): SearchDocument[] {
  const children = visibleSubcommands(command)
  if (children.length === 0) {
    const display = command.description()
    return [
      {
        command: ['sim', ...path].join(' '),
        display,
        summary: display.replace(TRAILING_PARENTHETICAL, ''),
        context: [
          ...ancestors,
          ...command.registeredArguments.map((argument) =>
            `${argument.name()} ${argument.description}`.trim()
          ),
          ...command.options
            .filter((option) => !option.hidden)
            .map((option) => `${option.long ?? option.short ?? ''} ${option.description}`.trim()),
        ].join(' '),
      },
    ]
  }
  const nextAncestors = path.length > 0 ? [...ancestors, command.description()] : ancestors
  return children
    .filter((child) => child !== exclude)
    .flatMap((child) => collectDocuments(child, [...path, child.name()], nextAncestors, exclude))
}

/** Ranks every command in `program` against a plain-language query, best first. */
export function searchCommands(program: Command, query: string, exclude: Command): SearchResult[] {
  const index = new MiniSearch<SearchDocument>({
    fields: ['command', 'summary', 'context'],
    storeFields: ['command', 'display'],
    idField: 'command',
  })
  index.addAll(collectDocuments(program, [], [], exclude))
  return index
    .search(query, SEARCH_OPTIONS)
    .slice(0, MAX_RESULTS)
    .map((hit) => ({ command: hit.command as string, summary: hit.display as string }))
}

export function searchCommand(): Command {
  return new Command('search')
    .description('Find the command for a task, described in plain words')
    .argument('<query...>', 'What you want to do, e.g. "cancel a workflow run"')
    .addHelpText(
      'after',
      `
Ranks the commands this CLI ships, locally; your query is never sent anywhere.
Returns the ${MAX_RESULTS} best matches. Run \`<command> --help\` on one for its flags.

Examples:
  $ sim cli search "cancel a running workflow"
  $ sim cli search list table rows`
    )
    .action((words: string[], _options: unknown, command: Command) => {
      let program = command
      while (program.parent) program = program.parent
      const results = searchCommands(program, words.join(' '), command)
      printList(profileFrom(command).output, results, COLUMNS)
    })
}

/** Commands about the CLI itself rather than a Sim resource. */
export function cliCommand(): Command {
  return new Command('cli').description('Discover commands in this CLI').addCommand(searchCommand())
}
