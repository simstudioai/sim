/**
 * The group help of `sim workflows source` and `sim workspaces source`: the edit loop and the
 * flags it needs, so a reader of the group needs no command's own `--help` to start.
 */
import { SOURCE_DRIFT_EXIT_CODE, SOURCE_LOCAL_CHANGES_EXIT_CODE } from '../../exit-codes'
import { SOURCE_AGENTS_FILE } from './source-dir'

/** Where the commands of either group find their workspace. */
const WORKSPACE_LINE = `Workspace: a directory records it (.sim/base.json, or a starter's .sim/starter.json); other
commands take -w <id> or SIM_WORKSPACE (a variable holding "--workspace <id>" is one argument: keep
only the ID in it).`

/** Where an author reads a run's result after running the workflow the source defines. */
const RUN_LOGS_LINE = `Rerun or debug: \`sim workflows run <workflowId> --dry --input '{…}'\` (writes stubbed, listed
under sideEffects; --allow <block> sends one block's, --draft sends all); \`sim logs get <runId>
--trace --no-include-workflow-state\` shows each block's resolved inputs and errors (\`sim logs list
--workflow <workflowId>\` lists runs).`

/** The status line both groups end with, for a directory at `dir`. */
function statusLine(group: string, dir: string): string {
  return `\`${group} status --dir ${dir}\`: what applying would do and whether the server changed
(exit 0 clean, ${SOURCE_LOCAL_CHANGES_EXIT_CODE} your edits only, ${SOURCE_DRIFT_EXIT_CODE} the server changed). Exit codes and editing rules: ${SOURCE_AGENTS_FILE}.`
}

/**
 * The top of `sim workflows source --help`, above the usage line: what a workflow's source leaves
 * out, so a task that changes a table starts in the directory that holds it.
 */
export const WORKFLOW_SOURCE_SCOPE_HELP = `A workflow's source holds that workflow alone: edit a table's columns and rows with
\`sim workspaces source get --dir <dir>\` (tables/<key>.ts), read rows with \`sim tables rows
list <table>\`. \`workflows source get\` names the tables a workflow uses (\`tables\`).
`

/**
 * `sim workflows source --help`, after the command list. The get reads the primer in the same
 * shell call, so the agent edits without a turn spent opening it.
 */
export const WORKFLOW_SOURCE_LOOP_HELP = `
The loop, two shell calls (<workflow>: its id or exact name):
  sim workflows source get <workflow> --dir ./wf && cat ./wf/${SOURCE_AGENTS_FILE}
  edit every file, then: sim workflows source check --dir ./wf && sim workflows source apply --dir ./wf --yes --run '{…}' --deploy
A non-zero exit stops the chain at the first failure; fix what it reported and run it again. check
compiles and type-checks (TypeScript installs on first run; --no-types skips it); apply re-checks,
saves the draft and rewrites the files; --run dry-runs that input on the saved draft (writes
stubbed, listed under run.sideEffects); --deploy deploys only if that run completed (without it the
draft stays undeployed). --allow-delete lets an edit remove a block or variable; apply --dry only
prints the plan; get --force replaces unapplied edits or another workflow's source.
A new workflow: \`sim workflows source create --dir ./new --workspace <workspaceId>\` writes a
starter; edit and check it, then \`create --dir ./new --yes --run '{…}' --deploy\`.
${WORKSPACE_LINE}
${RUN_LOGS_LINE}
${statusLine('sim workflows source', './wf')}`

/** `sim workspaces source --help`, after the command list. */
export const WORKSPACE_SOURCE_LOOP_HELP = `
The loop, two shell calls:
  sim workspaces source get --dir ./ws && cat ./ws/${SOURCE_AGENTS_FILE}
  edit every file (a new workflow: workflows/<key>/workflow.ts), then:
  sim workspaces source check --dir ./ws && sim workspaces source apply --dir ./ws --yes
A non-zero exit stops the chain at the first failure; fix what it reported and run it again. check
compiles and type-checks (TypeScript installs on first run; --no-types skips it); apply re-checks
and writes the workspace; a workflow deploys on apply when deployments/<key>.ts declares it.
--allow-delete lets an edit remove a resource, column, rows, document, or a workflow's block or
variable; apply --dry only prints the plan; get --force replaces edits no apply has saved.
Promote dev to prod: \`sim workspaces source apply --dir ./ws --to <workspaceId> --dry\`, then --yes.
${WORKSPACE_LINE}
${RUN_LOGS_LINE}
${statusLine('sim workspaces source', './ws')}`
