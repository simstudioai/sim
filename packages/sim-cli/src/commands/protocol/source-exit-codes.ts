import { DEFERRED_INTERRUPT_BOUND_MS } from '#sim-cli/terminal/interrupts'
import {
  AUTH_REQUIRED_EXIT_CODE,
  RATE_LIMITED_EXIT_CODE,
  SOURCE_BUSY_EXIT_CODE,
  SOURCE_DRIFT_EXIT_CODE,
  SOURCE_HELD_EXIT_CODE,
  SOURCE_LOCAL_CHANGES_EXIT_CODE,
  SOURCE_LOCKED_EXIT_CODE,
  SOURCE_PARTIAL_EXIT_CODE,
  SOURCE_PLANNED_EXIT_CODE,
  SOURCE_STALE_EXIT_CODE,
  SOURCE_TOO_LARGE_EXIT_CODE,
} from '../../exit-codes'

/** The status a shell reports for a command Ctrl-C ended (128 + SIGINT). */
const INTERRUPTED_EXIT_CODE = 130

/** How long an interrupted write waits for its answer before it stops without it. */
const DEFERRED_SECONDS = DEFERRED_INTERRUPT_BOUND_MS / 1000

/** The command group a directory guide's exit-code table is for. */
type SourceCommandGroup = 'sim workflows source' | 'sim workspaces source'

/** A source command whose `--help` lists its exit codes from {@link sourceExitCodeRows}. */
export type SourceHelpCommand =
  | 'workflows source apply'
  | 'workflows source create'
  | 'workflows source get'
  | 'workspaces source apply'
  | 'workspaces source get'

/** One exit code of the source commands: what it means, what to do, and each command's wording. */
interface SourceExitCodeRow {
  code: number
  /** Its meaning in the directory guides' table. */
  meaning: string
  /** What to do next, in that table. */
  next: string
  /** Its meaning in the `--help` of each command that exits with it. */
  help: Partial<Record<SourceHelpCommand, string>>
}

/** A get's exit 13, which a write names in its shared section instead. */
const GET_AUTH_REQUIRED =
  'not logged in, the login expired, or the server refused the credential (AUTH_REQUIRED): nothing was read or written, run `sim login` and the get again'

/** The busy clause of a single-workflow command, which locks --dir or its workspace directory. */
const WORKFLOW_DIR_BUSY =
  '(busy, retry) another sim command is using --dir, or the workspace directory it is a workflow folder of (SOURCE_DIR_BUSY): nothing was read or written, run it again once the other finished'

/**
 * Every exit code of the `workflows source` and `workspaces source` commands, in code order: the
 * one table the directory guides and each command's `--help` are built from, so neither can
 * drift from the codes the CLI exits with. `prefix` is the command group a guide is for.
 */
function sourceExitCodeRows(prefix: SourceCommandGroup): SourceExitCodeRow[] {
  return [
    {
      code: 0,
      meaning: 'Applied or created, a dry run or check with no errors, or a clean status',
      next: 'Go on',
      help: {
        'workflows source apply': 'applied (or a clean dry run)',
        'workflows source create': 'created (or a clean dry run, or a starter written)',
        'workflows source get': 'written',
        'workspaces source apply': 'applied (or a clean dry run)',
        'workspaces source get': 'written',
      },
    },
    {
      code: 1,
      meaning: `The source has errors (each printed as \`file:line:column\` with a hint), a locked block (\`E_APPLY_LOCKED_BLOCK\`), ${prefix === 'sim workspaces source' ? 'a name another resource holds (`E_NAME_TAKEN`)' : 'a name another workflow holds (`SOURCE_NAME_TAKEN`)'}, a cancelled prompt, or the command failed`,
      next: 'Fix what it printed and run it again',
      help: {
        'workflows source apply':
          'the source has errors (each printed as file:line:column with its frame and hint) or the command failed',
        'workflows source create':
          'the source has errors (each printed as file:line:column with its frame and hint), the workflow name is taken (SOURCE_NAME_TAKEN: pass --name), or the command failed (a starter is created in the workspace its types were written for unless --workspace names another)',
        'workflows source get':
          "the command failed, the directory is a workspace source directory (SOURCE_DIR_KIND_MISMATCH, even with --force), or it holds another workflow's source (SOURCE_WORKFLOW_MISMATCH) or edits no apply has saved (SOURCE_LOCAL_EDITS: apply them, get into another directory, or pass --force)",
        'workspaces source apply':
          'the source has errors (each printed as file:line:column with its frame and hint), or every change it would write was held back because it uses a declared secret the workspace has no value for or a declared credential key nothing binds to (nothing was written; a dry run of such an apply exits 1 too), the directory was read from another workspace than the one --workspace names (SOURCE_OTHER_WORKSPACE: drop --workspace, or promote it with --to; without --workspace an apply targets the workspace the directory was read from), its base records binary files no get downloaded (SOURCE_BLOBS_NOT_FETCHED: get again first), or the command failed',
        'workspaces source get':
          'the command failed, the directory holds edits no apply has saved (SOURCE_LOCAL_EDITS: apply them, get into another directory, or pass --force), --workspace names another workspace than the one the directory was read from (SOURCE_OTHER_WORKSPACE), the directory is a workflow source directory (SOURCE_DIR_KIND_MISMATCH, even with --force), or a downloaded binary file does not match its listing (SOURCE_BLOB_MISMATCH: nothing was written)',
      },
    },
    {
      code: SOURCE_STALE_EXIT_CODE,
      meaning:
        'Stale (`SOURCE_STALE`, or `E_APPLY_STALE` on a dry run): the server changed what this directory was read from, and nothing was written',
      next: `\`${prefix} get --dir <fresh dir>\`, reapply your edit there, dry-run, apply`,
      help: {
        'workflows source apply':
          'the workflow changed since the directory was read (SOURCE_STALE, on a dry run too: get it again, reapply the edit, retry)',
        'workspaces source apply':
          'a resource changed or was deleted on the server since the directory was read (SOURCE_STALE: get it again into a fresh directory, reapply the edit, retry)',
      },
    },
    {
      code: SOURCE_LOCKED_EXIT_CODE,
      meaning:
        'A workflow or its folder is locked (`E_APPLY_LOCKED`); a locked block exits 1 instead',
      next: 'Ask someone to unlock it in the editor',
      help: {
        'workflows source apply':
          'the workflow or its folder is locked (E_APPLY_LOCKED; a locked block exits 1, E_APPLY_LOCKED_BLOCK)',
        'workflows source create': 'the folder is locked',
        'workspaces source apply':
          'a resource (a workflow or its folder, a table) is locked (a locked block exits 1, E_APPLY_LOCKED_BLOCK)',
      },
    },
    {
      code: SOURCE_TOO_LARGE_EXIT_CODE,
      meaning: 'The source is over the size limits (on a get, status or diff too)',
      next: 'Split function code, or remove blocks or resources',
      help: {
        'workflows source apply': 'the source is too large',
        'workflows source create': 'the source is too large',
        'workflows source get': 'the workflow is too large to print as source',
        'workspaces source apply': 'the directory is too large',
        'workspaces source get':
          'the workspace has more resources of a kind than one directory holds',
      },
    },
    {
      code: SOURCE_PARTIAL_EXIT_CODE,
      meaning:
        '`sim workspaces source apply` stopped part-way: what was written is saved into the directory',
      next: 'Apply again until it exits 0',
      help: {
        'workspaces source apply': `the apply stopped part-way on a server failure: what was written is saved into the directory, and applying again continues. An apply a resource refused part-way (stale, locked, forbidden) saves what was written too, and exits as that refusal: ${SOURCE_STALE_EXIT_CODE}, ${SOURCE_LOCKED_EXIT_CODE} or 1`,
      },
    },
    {
      code: RATE_LIMITED_EXIT_CODE,
      meaning:
        "Still rate limited (HTTP 429) after the CLI's retries (up to 6, at most a minute apart); nothing more was written",
      next: 'Wait a minute and run the same command again',
      help: {
        'workflows source apply':
          "rate limited (HTTP 429) after the CLI's retries, so nothing was written: wait a minute and run it again",
        'workflows source create':
          "rate limited (HTTP 429) after the CLI's retries, so nothing was created: wait a minute and run it again",
        'workflows source get':
          "rate limited (HTTP 429) after the CLI's retries: wait a minute and run it again",
        'workspaces source apply':
          "rate limited (HTTP 429) after the CLI's retries, before anything was written: wait a minute and apply again (binary files already uploaded are not sent again)",
        'workspaces source get':
          "rate limited (HTTP 429) after the CLI's retries: nothing was written, the binary files already downloaded are kept in .sim/downloads, and running the get again downloads only the rest",
      },
    },
    {
      code: SOURCE_BUSY_EXIT_CODE,
      meaning:
        'Busy: another apply is writing the workspace (`SOURCE_BUSY`), or another sim command is using this directory (`SOURCE_DIR_BUSY`); nothing was written',
      next: 'Run it again once the other finished',
      help: {
        'workflows source apply': WORKFLOW_DIR_BUSY,
        'workflows source create': WORKFLOW_DIR_BUSY,
        'workflows source get': WORKFLOW_DIR_BUSY,
        'workspaces source apply':
          'another apply is writing the workspace (SOURCE_BUSY), or another command is using the directory (SOURCE_DIR_BUSY): nothing was written, run the command again once the other finished',
        'workspaces source get':
          '(busy, retry) another sim workspaces source or workflows source command is using this directory or a workflow folder in it (SOURCE_DIR_BUSY): nothing was read or written, run it again once it finished',
      },
    },
    {
      code: SOURCE_LOCAL_CHANGES_EXIT_CODE,
      meaning: '`status`: only your edits, which applying writes',
      next: 'Dry-run, then apply',
      help: {},
    },
    {
      code: SOURCE_DRIFT_EXIT_CODE,
      meaning: '`status`: the server changed since the get (drift, or a conflict with your edits)',
      next: 'Follow the `Next:` line it prints',
      help: {},
    },
    {
      code: AUTH_REQUIRED_EXIT_CODE,
      meaning:
        'Not logged in, the login expired, or the server refused the credential (`AUTH_REQUIRED`); nothing was sent',
      next: '`sim login`, or fix or unset `SIM_API_KEY` when the key comes from it; then the same command again',
      help: {
        'workflows source get': GET_AUTH_REQUIRED,
        'workspaces source get': GET_AUTH_REQUIRED,
      },
    },
    {
      code: SOURCE_PLANNED_EXIT_CODE,
      meaning:
        '`apply` or `create` without `--yes` and no terminal to ask: it printed the plan, found no errors, and wrote nothing',
      next: 'Run the same command with `--yes`',
      help: {
        'workflows source apply':
          'without --yes and with no terminal to ask: the plan was printed with no errors and nothing was written (run the same command with --yes to apply it)',
        'workflows source create':
          'without --yes and with no terminal to ask: the plan was printed with no errors and nothing was created (run the same command with --yes)',
        'workspaces source apply':
          'without --yes and with no terminal to ask: the plan was printed with no errors and nothing was written (run the same command with --yes to apply it)',
      },
    },
    {
      code: SOURCE_HELD_EXIT_CODE,
      meaning:
        '`sim workspaces source apply` (or `--to`) wrote part of its plan and held the rest back: a change that uses a declared secret the workspace has no value for, or a credential key nothing binds to. Its dry run exits 15 too, so a script can tell beforehand that the apply would write only part',
      next: 'Set the secret (`sim secrets set`) or connect the credential, then apply again',
      help: {
        'workspaces source apply':
          'written in part: changes that use a declared secret the workspace has no value for, or a declared credential key nothing binds to, were held back and the rest was applied and saved (set the secret or connect the credential, then apply again); a dry run that would do so exits 15 too, having written nothing',
      },
    },
    {
      code: INTERRUPTED_EXIT_CODE,
      meaning: `Interrupted (Ctrl-C). An apply or create already sent is finished and saved into the directory first, waiting up to ${DEFERRED_SECONDS}s for its answer; a second Ctrl-C, or no answer by then, stops at once and prints that it may have been written`,
      next: `\`${prefix} status --dir .\``,
      help: {},
    },
  ]
}

/**
 * Every exit code of the `workflows source` and `workspaces source` commands, as the Markdown
 * table both directory guides (`.sim/AGENTS.md`) print. `prefix` is the command group the guide
 * is for.
 */
export function sourceExitCodesTable(prefix: SourceCommandGroup): string {
  return [
    '| Code | Meaning | Do |',
    '|---|---|---|',
    ...sourceExitCodeRows(prefix).map(
      ({ code, meaning, next }) => `| ${code} | ${meaning} | ${next} |`
    ),
  ].join('\n')
}

/** The width `--help` prose wraps at, as the hand-written sections around it do. */
const HELP_WIDTH = 100

/** `text` broken into lines of at most {@link HELP_WIDTH} characters, between words. */
function wrapHelp(text: string): string {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > HELP_WIDTH) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  return [...lines, line].join('\n')
}

/**
 * The exit-code section of `command`'s `--help`: the codes it exits with, in code order, each in
 * the command's own words, from the same rows as {@link sourceExitCodesTable}. `lead` names the
 * section (a get's codes apply only with `--dir`).
 */
export function sourceExitCodesHelp(command: SourceHelpCommand, lead = 'Exit codes'): string {
  const prefix = command.startsWith('workflows') ? 'sim workflows source' : 'sim workspaces source'
  const clauses = sourceExitCodeRows(prefix).flatMap(({ code, help }) => {
    const text = help[command]
    return text === undefined ? [] : [`${code} ${text}`]
  })
  return `\n${wrapHelp(`${lead}: ${clauses.join('; ')}.`)}`
}

/** The exit codes every source write (apply, create) shares, appended to its help. */
export const SOURCE_WRITE_EXIT_CODES_HELP = `
Exit ${AUTH_REQUIRED_EXIT_CODE}: not logged in, or the server refused the credential (AUTH_REQUIRED); nothing was sent.
Run \`sim login\`, or fix or unset SIM_API_KEY when the key comes from it. Exit ${INTERRUPTED_EXIT_CODE}: interrupted
(Ctrl-C). A write already sent is finished and saved into the directory first, waiting up to
${DEFERRED_SECONDS}s for its answer; a second Ctrl-C, or no answer by then, stops at once and prints that it may
have been written and how to check.`
