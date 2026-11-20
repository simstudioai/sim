import { DEFERRED_INTERRUPT_BOUND_MS } from '#sim-cli/terminal/interrupts'
import {
  AUTH_REQUIRED_EXIT_CODE,
  RATE_LIMITED_EXIT_CODE,
  SOURCE_BUSY_EXIT_CODE,
  SOURCE_DRIFT_EXIT_CODE,
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

/**
 * Every exit code of the `workflows source` and `workspaces source` commands, as the Markdown
 * table both directory guides (`.sim/AGENTS.md`) print, built from the codes the CLI exits with so
 * the guides cannot drift from them. `prefix` is the command group the guide is for.
 */
export function sourceExitCodesTable(
  prefix: 'sim workflows source' | 'sim workspaces source'
): string {
  const rows: Array<[number, string, string]> = [
    [0, 'Applied or created, a dry run or check with no errors, or a clean status', 'Go on'],
    [
      1,
      'The source has errors (each printed as `file:line:column` with a hint), a locked block (`E_APPLY_LOCKED_BLOCK`), a name another workflow holds (`SOURCE_NAME_TAKEN`), a cancelled prompt, or the command failed',
      'Fix what it printed and run it again',
    ],
    [
      SOURCE_STALE_EXIT_CODE,
      'Stale (`SOURCE_STALE`, or `E_APPLY_STALE` on a dry run): the server changed what this directory was read from, and nothing was written',
      `\`${prefix} get --dir <fresh dir>\`, reapply your edit there, dry-run, apply`,
    ],
    [
      SOURCE_LOCKED_EXIT_CODE,
      'A workflow or its folder is locked (`E_APPLY_LOCKED`); a locked block exits 1 instead',
      'Ask someone to unlock it in the editor',
    ],
    [
      SOURCE_TOO_LARGE_EXIT_CODE,
      'The source is over the size limits (on a get, status or diff too)',
      'Split function code, or remove blocks or resources',
    ],
    [
      SOURCE_PARTIAL_EXIT_CODE,
      '`sim workspaces source apply` stopped part-way: what was written is saved into the directory',
      'Apply again until it exits 0',
    ],
    [
      RATE_LIMITED_EXIT_CODE,
      "Still rate limited (HTTP 429) after the CLI's retries (up to 6, at most a minute apart); nothing more was written",
      'Wait a minute and run the same command again',
    ],
    [
      SOURCE_BUSY_EXIT_CODE,
      'Busy: another apply is writing the workspace (`SOURCE_BUSY`), or another sim command is using this directory (`SOURCE_DIR_BUSY`); nothing was written',
      'Run it again once the other finished',
    ],
    [
      SOURCE_LOCAL_CHANGES_EXIT_CODE,
      '`status`: only your edits, which applying writes',
      'Dry-run, then apply',
    ],
    [
      SOURCE_DRIFT_EXIT_CODE,
      '`status`: the server changed since the get (drift, or a conflict with your edits)',
      'Follow the `Next:` line it prints',
    ],
    [
      AUTH_REQUIRED_EXIT_CODE,
      'Not logged in, the login expired, or the server refused the credential (`AUTH_REQUIRED`); nothing was sent',
      '`sim login`, or fix or unset `SIM_API_KEY` when the key comes from it; then the same command again',
    ],
    [
      SOURCE_PLANNED_EXIT_CODE,
      '`apply` or `create` without `--yes` and no terminal to ask: it printed the plan, found no errors, and wrote nothing',
      'Run the same command with `--yes`',
    ],
    [
      INTERRUPTED_EXIT_CODE,
      `Interrupted (Ctrl-C). An apply or create already sent is finished and saved into the directory first, waiting up to ${DEFERRED_SECONDS}s for its answer; a second Ctrl-C, or no answer by then, stops at once and prints that it may have been written`,
      `\`${prefix} status --dir .\``,
    ],
  ]
  return [
    '| Code | Meaning | Do |',
    '|---|---|---|',
    ...rows.map(([code, meaning, next]) => `| ${code} | ${meaning} | ${next} |`),
  ].join('\n')
}

/** The exit codes every source write (apply, create) shares, appended to its help. */
export const SOURCE_WRITE_EXIT_CODES_HELP = `
Exit ${AUTH_REQUIRED_EXIT_CODE}: not logged in, or the server refused the credential (AUTH_REQUIRED); nothing was sent.
Run \`sim login\`, or fix or unset SIM_API_KEY when the key comes from it. Exit ${INTERRUPTED_EXIT_CODE}: interrupted
(Ctrl-C). A write already sent is finished and saved into the directory first, waiting up to
${DEFERRED_SECONDS}s for its answer; a second Ctrl-C, or no answer by then, stops at once and prints that it may
have been written and how to check.`
