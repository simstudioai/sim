import { DEFERRED_INTERRUPT_BOUND_MS } from '#sim-cli/terminal/interrupts'
import {
  AUTH_REQUIRED_EXIT_CODE,
  INTERRUPTED_EXIT_CODE,
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

/** How long an interrupted write waits for its answer before it stops without it. */
const DEFERRED_SECONDS = DEFERRED_INTERRUPT_BOUND_MS / 1000

/** The command group a directory guide's exit-code table is for. */
export type SourceCommandGroup = 'sim workflows source' | 'sim workspaces source'

/** A source command whose `--help` lists its exit codes from {@link sourceExitCodeRows}. */
export type SourceHelpCommand =
  | 'workflows source apply'
  | 'workflows source create'
  | 'workflows source get'
  | 'workflows source status'
  | 'workspaces source apply'
  | 'workspaces source get'
  | 'workspaces source status'

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

/** A write's exit 13: nothing was sent. */
const WRITE_AUTH_REQUIRED =
  'not logged in, the login expired, or the server refused the credential (AUTH_REQUIRED): nothing was sent, run `sim login` (or fix or unset SIM_API_KEY when the key comes from it) and the command again'

/** A write's exit 130: what a Ctrl-C leaves behind. */
const WRITE_INTERRUPTED = `interrupted (Ctrl-C): a write already sent is finished and saved into the directory first, waiting up to ${DEFERRED_SECONDS}s for its answer, and a second Ctrl-C, or no answer by then, stops at once and prints that it may have been written and how to check`

/** A status's exit 0, and what it does when the server cannot be reached. */
const STATUS_CLEAN = `clean (nothing to apply, and the server changed nothing since the directory was read); a server that cannot be reached is not a failure: the status shows the local changes only and says so (exit 0 or ${SOURCE_LOCAL_CHANGES_EXIT_CODE})`

/** A status's exit 11. */
const STATUS_LOCAL_CHANGES = 'local changes only (applying writes them)'

/** A status's exit 12. */
const STATUS_DRIFT =
  'the server changed since the directory was read: drift (a resource edited, added or deleted there that the directory leaves alone) or a conflict (also changed here, so applying it is refused as stale), with or without local changes'

/** A status's exit 13: it still shows the local changes. */
const STATUS_AUTH_REQUIRED =
  'not logged in (AUTH_REQUIRED) or the credential was refused: the status shows the local changes only, then run `sim login`'

/** A status's exit 7. */
const STATUS_TOO_LARGE = 'the source is too large for the server to read in one dry run'

/** The busy clause of a workspace command, which locks --dir. */
const WORKSPACE_DIR_BUSY =
  '(busy, retry) another sim workspaces source or workflows source command is using this directory or a workflow folder in it (SOURCE_DIR_BUSY): nothing was read or written, run it again once it finished'

/** The busy clause of a single-workflow command, which locks --dir or its workspace directory. */
const WORKFLOW_DIR_BUSY =
  '(busy, retry) another sim command is using --dir, or the workspace directory it is a workflow folder of (SOURCE_DIR_BUSY): nothing was read or written, run it again once the other finished'

/**
 * Every exit code of the `workflows source` and `workspaces source` commands, in code order: the
 * one table the directory guides and each command's `--help` are built from, so neither can
 * drift from the codes the CLI exits with. `prefix` is the command group a guide is for.
 */
export function sourceExitCodeRows(prefix: SourceCommandGroup): SourceExitCodeRow[] {
  return [
    {
      code: 0,
      meaning: 'Applied or created, a dry run or check with no errors, or a clean status',
      next: 'Go on',
      help: {
        'workflows source apply': 'applied (or a clean dry run)',
        'workflows source create': 'created (or a clean dry run, or a starter written)',
        'workflows source get': 'written',
        'workflows source status': STATUS_CLEAN,
        'workspaces source apply': 'applied (or a clean dry run)',
        'workspaces source get': 'written',
        'workspaces source status': STATUS_CLEAN,
      },
    },
    {
      code: 1,
      meaning: `The source has errors (each printed as \`file:line:column\` with a hint), a locked block (\`E_APPLY_LOCKED_BLOCK\`), ${prefix === 'sim workspaces source' ? 'a name another resource holds (`E_NAME_TAKEN`)' : 'a name another workflow holds (`SOURCE_NAME_TAKEN`), a `--run` test run that did not complete'}, a cancelled prompt, or the command failed`,
      next: 'Fix what it printed and run it again',
      help: {
        'workflows source apply':
          "the source has errors (each printed as file:line:column with its frame and hint), the workflowId given is not the one .sim/base.json names (SOURCE_WORKFLOW_MISMATCH: the directory holds another workflow's source), the --run test run did not complete (the draft is saved; nothing was deployed), or the command failed",
        'workflows source create':
          'the source has errors (each printed as file:line:column with its frame and hint), the workflow name is taken (SOURCE_NAME_TAKEN: pass --name), the --run test run did not complete (the workflow is created; nothing was deployed), or the command failed (a starter is created in the workspace its types were written for unless --workspace or SIM_WORKSPACE names another)',
        'workflows source get':
          "the command failed, no workflow or several are named exactly the name given (WORKFLOW_NOT_FOUND, WORKFLOW_NAME_AMBIGUOUS: each candidate is listed with its id), the directory is a workspace source directory (SOURCE_DIR_KIND_MISMATCH, even with --force), or it holds another workflow's source (SOURCE_WORKFLOW_MISMATCH) or edits no apply has saved (SOURCE_LOCAL_EDITS: apply them, get into another directory, or pass --force)",
        'workflows source status': 'the command failed',
        'workspaces source apply':
          'the source has errors (each printed as file:line:column with its frame and hint), or every change it would write was held back because it uses a declared secret the workspace has no value for or a declared credential key nothing binds to (nothing was written; a dry run of such an apply exits 1 too), the directory was read from another workspace than the one --workspace or SIM_WORKSPACE names (SOURCE_OTHER_WORKSPACE: drop it, or promote it with --to; without either an apply targets the workspace the directory was read from), its base records binary files no get downloaded (SOURCE_BLOBS_NOT_FETCHED: get again first), or the command failed',
        'workspaces source get':
          'the command failed, the directory holds edits no apply has saved (SOURCE_LOCAL_EDITS: apply them, get into another directory, or pass --force), --workspace or SIM_WORKSPACE names another workspace than the one the directory was read from (SOURCE_OTHER_WORKSPACE), the directory is a workflow source directory (SOURCE_DIR_KIND_MISMATCH, even with --force), or a downloaded binary file does not match its listing (SOURCE_BLOB_MISMATCH: nothing was written)',
        'workspaces source status': 'the command failed',
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
      ...(prefix === 'sim workspaces source'
        ? {
            meaning:
              'A resource is locked (`E_APPLY_LOCKED`): a workflow or its folder, or a table; a locked block exits 1 instead',
            next: "Ask someone to unlock it: a workflow in the workflow builder, a table in its settings (the finding's hint names which)",
          }
        : {
            meaning:
              'A workflow or its folder is locked (`E_APPLY_LOCKED`); a locked block exits 1 instead',
            next: 'Ask someone to unlock it in the workflow builder',
          }),
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
        'workflows source status': STATUS_TOO_LARGE,
        'workspaces source apply': 'the directory is too large',
        'workspaces source status': STATUS_TOO_LARGE,
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
        'workflows source status':
          "rate limited (HTTP 429) after the CLI's retries: wait a minute and run it again",
        'workspaces source apply':
          "rate limited (HTTP 429) after the CLI's retries, before anything was written: wait a minute and apply again (binary files already uploaded are not sent again)",
        'workspaces source get':
          "rate limited (HTTP 429) after the CLI's retries: nothing was written, the binary files already downloaded are kept in .sim/downloads, and running the get again downloads only the rest",
        'workspaces source status':
          "rate limited (HTTP 429) after the CLI's retries: wait a minute and run it again",
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
        'workflows source status': WORKFLOW_DIR_BUSY,
        'workspaces source apply':
          'another apply is writing the workspace (SOURCE_BUSY), or another command is using the directory (SOURCE_DIR_BUSY): nothing was written, run the command again once the other finished',
        'workspaces source get': WORKSPACE_DIR_BUSY,
        'workspaces source status': WORKSPACE_DIR_BUSY,
      },
    },
    {
      code: SOURCE_LOCAL_CHANGES_EXIT_CODE,
      meaning: '`status`: only your edits, which applying writes',
      next: 'Dry-run, then apply',
      help: {
        'workflows source status': STATUS_LOCAL_CHANGES,
        'workspaces source status': STATUS_LOCAL_CHANGES,
      },
    },
    {
      code: SOURCE_DRIFT_EXIT_CODE,
      meaning: '`status`: the server changed since the get (drift, or a conflict with your edits)',
      next: 'Follow the `Next:` line it prints',
      help: {
        'workflows source status': STATUS_DRIFT,
        'workspaces source status': STATUS_DRIFT,
      },
    },
    {
      code: AUTH_REQUIRED_EXIT_CODE,
      meaning:
        'Not logged in, the login expired, or the server refused the credential (`AUTH_REQUIRED`); nothing was sent',
      next: '`sim login`, or fix or unset `SIM_API_KEY` when the key comes from it; then the same command again',
      help: {
        'workflows source apply': WRITE_AUTH_REQUIRED,
        'workflows source create': WRITE_AUTH_REQUIRED,
        'workflows source get': GET_AUTH_REQUIRED,
        'workflows source status': STATUS_AUTH_REQUIRED,
        'workspaces source apply': WRITE_AUTH_REQUIRED,
        'workspaces source get': GET_AUTH_REQUIRED,
        'workspaces source status': STATUS_AUTH_REQUIRED,
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
      meaning: `\`sim workspaces source apply\` (or \`--to\`) wrote part of its plan and held the rest back: a change that uses a declared secret the workspace has no value for, or a credential key nothing binds to. Its dry run exits ${SOURCE_HELD_EXIT_CODE} too, so a script can tell beforehand that the apply would write only part`,
      next: 'Set the secret (`sim secrets set`) or connect the credential, then apply again',
      help: {
        'workspaces source apply': `written in part: changes that use a declared secret the workspace has no value for, or a declared credential key nothing binds to, were held back and the rest was applied and saved (set the secret or connect the credential, then apply again); a dry run that would do so exits ${SOURCE_HELD_EXIT_CODE} too, having written nothing`,
      },
    },
    {
      code: INTERRUPTED_EXIT_CODE,
      meaning: `Interrupted (Ctrl-C). An apply or create already sent is finished and saved into the directory first, waiting up to ${DEFERRED_SECONDS}s for its answer; a second Ctrl-C, or no answer by then, stops at once and prints that it may have been written`,
      next: `\`${prefix} status --dir .\``,
      help: {
        'workflows source apply': WRITE_INTERRUPTED,
        'workflows source create': WRITE_INTERRUPTED,
        'workspaces source apply': WRITE_INTERRUPTED,
      },
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
