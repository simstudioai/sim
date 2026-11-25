/**
 * The group help of `sim workflows source` and `sim workspaces source`: the edit loop and the
 * flags it needs, so a reader of the group needs no command's own `--help` to start.
 */
import { SOURCE_DRIFT_EXIT_CODE, SOURCE_LOCAL_CHANGES_EXIT_CODE } from '../../exit-codes'
import { SOURCE_AGENTS_FILE } from './source-dir'

/** The loop's steps as aligned `command   what it does` rows. */
function loopRows(rows: ReadonlyArray<readonly [string, string]>): string {
  const width = Math.max(...rows.map(([command]) => command.length)) + 3
  return rows.map(([command, what]) => `  ${command.padEnd(width)}${what}`.trimEnd()).join('\n')
}

/** Where the commands of either group find their workspace. */
const WORKSPACE_LINE = `Workspace: a directory records it (.sim/base.json, or a starter's .sim/starter.json); any other
command takes -w <id>, SIM_WORKSPACE or the profile's (export SIM_WORKSPACE once, or keep only the
ID in a variable: one holding "--workspace <id>" is one argument, an unknown option alone and the
whole ID after -w).`

/** Where an author reads a run's result after running the workflow the source defines. */
const RUN_LOGS_LINE = `Test a run: \`sim workflows run <workflowId> --dry\` runs the saved draft without sending its writes
and lists each one, with the request it would have sent, under sideEffects (--allow <block> sends
one block's for real; --manual runs everything for real). Debug it with \`sim logs list --workflow
<workflowId>\` and \`sim logs get <runId> --trace --no-include-workflow-state\` (each block's
resolved inputs and errors).`

/** The status line both groups end with, for a directory at `dir`. */
function statusLine(group: string, dir: string): string {
  return `\`${group} status --dir ${dir}\` shows what applying would do and
whether the server changed since the get (exit 0 clean, ${SOURCE_LOCAL_CHANGES_EXIT_CODE} your edits only, ${SOURCE_DRIFT_EXIT_CODE} the server changed).
Every exit code, and the rules for editing: ${SOURCE_AGENTS_FILE} in the directory.`
}

/** `sim workflows source --help`, after the command list. */
export const WORKFLOW_SOURCE_LOOP_HELP = `
The loop:
${loopRows([
  ['sim workflows source get <workflowId> --dir ./wf', 'write workflow.ts, functions/* and .sim/'],
  ['edit ./wf/workflow.ts', 'every file first, then the one command below'],
  ['sim workflows source check --dir ./wf', 'compile + types: each error as file:line:column'],
  ['  && sim workflows source apply --dir ./wf --yes', 'save the draft (it re-checks)'],
  ["  && sim workflows run <workflowId> --dry --input '{…}'", 'test the draft, sending no writes'],
])}
Run those three as one chained command: a non-zero exit stops it at the first failure, and the next
step fixes what it reported. Check also type-checks with TypeScript (installed once, on its first
run; --no-types skips it). For review, \`apply --dry-run\` prints the plan and writes nothing.
A new workflow: \`sim workflows source create --dir ./new --workspace <workspaceId>\` writes a
starter that records its workspace; edit and check it, then \`create --dir ./new --yes\` creates the
workflow there, and the loop above goes on from there.
A workflow's source holds that workflow alone: a table, its columns and rows, and every other
workspace resource are edited with \`sim workspaces source\` (or the \`sim tables\` commands).
${WORKSPACE_LINE}
${RUN_LOGS_LINE}

Flags the loop needs: --allow-delete (apply: an edit that removes a block or variable is refused
without it), --deploy (apply, create: also deploy the saved draft), --force (get: replace another
workflow's source, or edits no apply has saved).
${statusLine('sim workflows source', './wf')}`

/** `sim workspaces source --help`, after the command list. */
export const WORKSPACE_SOURCE_LOOP_HELP = `
The loop:
${loopRows([
  ['sim workspaces source get --dir ./ws', 'write tables/, workflows/<key>/, … and .sim/'],
  ['edit the files', 'every file first; a new workflow: workflows/<key>/workflow.ts'],
  ['sim workspaces source check --dir ./ws', 'compile + types: each error as file:line:column'],
  ['  && sim workspaces source apply --dir ./ws --yes', 'write it to the workspace (it re-checks)'],
])}
Run those two as one chained command: a non-zero exit stops it at the first failure, and the next
step fixes what it reported. Check also type-checks with TypeScript (installed once, on its first
run; --no-types skips it). For review, \`apply --dry-run\` prints the plan and writes nothing.
Promote dev to prod: \`sim workspaces source apply --dir ./ws --to <workspaceId> --dry-run\`, then
--yes.
${WORKSPACE_LINE}
${RUN_LOGS_LINE}

Flags the loop needs: --allow-delete (apply: removing a resource, a column, rows or a document,
or a workflow's block or variable, is refused without it), --force (get: replace edits no apply
has saved). A workflow deploys on apply when
deployments/<key>.ts declares it.
${statusLine('sim workspaces source', './ws')}`
