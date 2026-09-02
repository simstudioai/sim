import chalk from 'chalk'
import { type Command, Option } from 'commander'
import { clientFrom } from '../../context'
import { CLI_CONTRACT } from '../../contract/commands'
import type { CommandSpec } from '../../contract/types'
import { setSoftExitCode } from '../../embed-context'
import { V2_OPERATIONS } from '../../generated/v2-api'
import { sleep } from '../../helpers'
import { resolvePath, SimApiError } from '../../http/client'
import { renderResult } from '../../runtime/result'

/**
 * Statuses a run never leaves.
 *
 * Taken from the reported enum of `GET /api/v2/workflows/[id]/runs/[runId]`,
 * which is `PERSISTED_WORKFLOW_EXECUTION_STATUSES` plus `queued`. The four
 * absent from this set are all states the server moves out of on its own:
 * `queued` and `pending` precede execution, `running` is it, and `redacting` is
 * the window where a finished run's output is scrubbed — stopping there would
 * report a run as done while its record is still being rewritten.
 */
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])

/**
 * How a wait ended, and the exit status that says so.
 *
 * Exit codes are the whole point of this command: a CI step runs it precisely so
 * that a failed run fails the build. They follow `whoami`'s split — 1 is the
 * CLI's blanket "explained failure" and here means the run itself failed, while
 * everything above it is a distinct outcome a script has to branch on.
 * Cancelling is somebody's decision, a pause is a prompt to act, and giving up
 * on the clock says nothing about the run at all; collapsing any of them into 1
 * would make all three read as "the workflow broke".
 */
const WAIT_EXIT_CODES = {
  completed: 0,
  failed: 1,
  cancelled: 2,
  paused: 3,
  timeout: 4,
} as const

type WaitOutcome = keyof typeof WAIT_EXIT_CODES

/**
 * How long to wait between polls, in milliseconds.
 *
 * A run that has already finished answers on the first request, so the first
 * delay is only ever paid by a run that is genuinely still going. The interval
 * then backs off to a ceiling: an hour-long run should not cost a request every
 * two seconds, and nobody watching a `wait` in CI can tell a two-second refresh
 * from a fifteen-second one.
 *
 * Deliberately without jitter, unlike the retry pacing elsewhere in the
 * monorepo. Jitter exists to break up a herd of clients hammering the same
 * failed dependency in lockstep; one terminal polling one run is not that, and a
 * predictable schedule is one fewer thing to explain when someone counts the
 * requests.
 */
const FIRST_POLL_DELAY_MS = 2_000
const MAX_POLL_DELAY_MS = 15_000
const POLL_BACKOFF_FACTOR = 2

/**
 * How long to wait in total before giving up, in seconds.
 *
 * Matches the ceiling a paid plan puts on a single run, so the default never
 * abandons a run the server would still have finished. `0` waits indefinitely,
 * the same escape hatch `SIM_TIMEOUT_SECONDS` offers.
 */
const DEFAULT_WAIT_TIMEOUT_SECONDS = 3600

/**
 * Spelled `--wait-timeout` rather than `--timeout`, because `SIM_TIMEOUT_SECONDS`
 * already bounds a single HTTP request while this bounds the whole wait across
 * many of them. Two knobs both called "timeout" would be read as one, and the
 * failure that follows is silent — raising the wrong one changes nothing.
 */
const WAIT_TIMEOUT_FLAG = '--wait-timeout <seconds>'

interface RunSnapshot {
  status: string
  /** `time` resumes itself; `human` and null wait for a person. */
  pauseKind: string | null
  resumeAt: string | null
  contextId: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Reads the fields the loop branches on out of the run response.
 *
 * v2 answers `{ data: … }`, but the payload is unwrapped tolerantly so a bare
 * record — what a self-hosted deployment behind an unwrapping proxy hands back —
 * still polls, rather than refusing to find a status that is right there.
 */
/** The run itself: v2 answers `{ data: run }` and the renderer prints exactly what it is handed. */
function runData(raw: unknown): unknown {
  return isRecord(raw) && isRecord(raw.data) ? raw.data : raw
}

function readRun(raw: unknown): RunSnapshot {
  const run = isRecord(raw) && isRecord(raw.data) ? raw.data : raw
  if (!isRecord(run) || typeof run.status !== 'string') {
    throw new SimApiError('Run status response carried no status.', 0)
  }
  const paused = isRecord(run.paused) ? run.paused : null
  return {
    status: run.status,
    pauseKind: paused ? optionalString(paused.pauseKind) : null,
    resumeAt: paused ? optionalString(paused.resumeAt) : null,
    contextId: paused ? optionalString(paused.contextId) : null,
  }
}

/**
 * The outcome a snapshot settles the wait as, or null to keep polling.
 *
 * A `paused` run is the judgement call here. A pause waiting on time resumes
 * itself, so the run is still making progress and the loop keeps going. A pause
 * waiting on a human never resolves without one — polling it to the deadline
 * would burn the entire budget and then report a timeout, describing a run doing
 * exactly what it was asked to as a run that failed to answer. So a human pause
 * ends the wait and names the command that resumes it. An unspecified
 * `pauseKind` is treated the same way: the response makes no promise that it
 * will move on by itself, and a wait that might never end is worse than one that
 * stops and explains itself.
 */
function classify(snapshot: RunSnapshot): WaitOutcome | null {
  if (snapshot.status === 'paused') return snapshot.pauseKind === 'time' ? null : 'paused'
  if (!TERMINAL_STATUSES.has(snapshot.status)) return null
  return snapshot.status === 'completed'
    ? 'completed'
    : snapshot.status === 'cancelled'
      ? 'cancelled'
      : 'failed'
}

interface WaitProgress {
  advance: (status: string, elapsedMs: number) => void
  finish: () => void
}

/**
 * Reports what the run is doing while the wait continues.
 *
 * stderr and TTY-only, the rule `pageProgress` already follows: stdout carries
 * the finished run so `sim workflows runs wait … > result.json` stays a usable
 * file, and a redirected stderr should not collect a log of half-erased status
 * lines.
 */
function waitProgress(): WaitProgress {
  let reported = false
  return {
    advance: (status, elapsedMs) => {
      if (!process.stderr.isTTY) return
      reported = true
      process.stderr.write(
        `\r${chalk.dim(`${status} — waiting ${Math.round(elapsedMs / 1000)}s…`)}\u001b[K`
      )
    },
    // Idempotent: the loop clears the line before printing a result, and the
    // `finally` clears it again for the path that threw. Erasing twice would
    // write a stray control sequence onto output already on the stream.
    finish: () => {
      if (!reported) return
      reported = false
      process.stderr.write('\r\u001b[K')
    },
  }
}

function parseWaitTimeout(raw: string): number {
  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new SimApiError(
      `Invalid ${WAIT_TIMEOUT_FLAG} "${raw}". Use a non-negative number of seconds, or 0 to wait indefinitely.`,
      0
    )
  }
  return seconds
}

/** The one line explaining an outcome the caller is about to see as a non-zero exit. */
function explain(
  outcome: WaitOutcome,
  runId: string,
  workflowId: string,
  snapshot: RunSnapshot
): string | null {
  if (outcome === 'completed') return null
  if (outcome === 'failed') return `Run ${runId} failed.`
  if (outcome === 'cancelled') return `Run ${runId} was cancelled.`
  const context = snapshot.contextId ? ` --context ${snapshot.contextId}` : ''
  return `Run ${runId} is paused waiting for input. Resume it: sim workflows runs resume ${runId} --workflow ${workflowId}${context}`
}

/**
 * The fields `workflows runs get` renders, so a waited run and a polled one read
 * identically. Read from the contract rather than restated here: a field added
 * to the sibling should reach both without anyone remembering this file exists.
 */
function runSpec(): CommandSpec {
  return CLI_CONTRACT.getWorkflowRun ?? {}
}

/** Adds `workflows runs wait` — poll one run until it stops moving. */
export function attachWorkflowRunWait(runs: Command): void {
  runs
    .command('wait')
    .argument('<runId>', V2_OPERATIONS.getWorkflowRun.pathParamDocs?.runId)
    .allowExcessArguments(false)
    .description('Wait for a run to reach a terminal state, then show it')
    .addOption(
      new Option('--workflow <workflowId>', 'Workflow ID (required)').makeOptionMandatory()
    )
    .addOption(
      new Option(
        WAIT_TIMEOUT_FLAG,
        `Give up after this many seconds, or 0 to wait indefinitely (default: ${DEFAULT_WAIT_TIMEOUT_SECONDS}). Bounds the whole wait; SIM_TIMEOUT_SECONDS bounds one request`
      )
    )
    .action(
      async (
        runId: string,
        options: { workflow: string; waitTimeout?: string },
        command: Command
      ) => {
        const timeoutSeconds =
          options.waitTimeout === undefined
            ? DEFAULT_WAIT_TIMEOUT_SECONDS
            : parseWaitTimeout(options.waitTimeout)

        const { client, profile } = clientFrom(command)
        const operation = V2_OPERATIONS.getWorkflowRun
        const path = resolvePath(operation.path, { workflowId: options.workflow, runId })

        const startedAt = Date.now()
        const deadline =
          timeoutSeconds === 0 ? Number.POSITIVE_INFINITY : startedAt + timeoutSeconds * 1000
        const progress = waitProgress()
        let delayMs = FIRST_POLL_DELAY_MS

        // `finally`, because a request that throws part-way through would
        // otherwise leave `running — waiting 12s…` sitting on the line the error
        // is then written onto.
        try {
          while (true) {
            const raw = await client.request<unknown>(path, { method: operation.method })
            const snapshot = readRun(raw)
            const outcome = classify(snapshot)

            if (outcome) {
              progress.finish()
              renderResult('getWorkflowRun', profile.output, runData(raw), runSpec())
              const message = explain(outcome, runId, options.workflow, snapshot)
              if (message) console.error(chalk.red(message))
              setSoftExitCode(WAIT_EXIT_CODES[outcome])
              return
            }

            const remainingMs = deadline - Date.now()
            if (remainingMs <= 0) {
              progress.finish()
              renderResult('getWorkflowRun', profile.output, runData(raw), runSpec())
              console.error(
                chalk.red(
                  `Timed out after ${timeoutSeconds}s waiting for run ${runId} (status: ${snapshot.status}${
                    snapshot.resumeAt ? `, resuming at ${snapshot.resumeAt}` : ''
                  }). Raise ${WAIT_TIMEOUT_FLAG}, or set it to 0 to wait indefinitely.`
                )
              )
              setSoftExitCode(WAIT_EXIT_CODES.timeout)
              return
            }

            progress.advance(snapshot.status, Date.now() - startedAt)
            // Clamped to the time left so the last sleep of a bounded wait ends
            // at the deadline instead of overshooting it by a whole interval.
            await sleep(Math.min(delayMs, remainingMs))
            delayMs = Math.min(delayMs * POLL_BACKOFF_FACTOR, MAX_POLL_DELAY_MS)
          }
        } finally {
          progress.finish()
        }
      }
    )
}
