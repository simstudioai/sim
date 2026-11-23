/**
 * The one consent-and-write flow of every source write (`workflows source apply` and `create`,
 * `workspaces source apply`): preview, refuse on errors, stop at the plan or ask, then send and
 * save the write with interrupts held, so the commands cannot drift in what they print, ask or
 * exit with.
 */

import { DEFERRED_INTERRUPT_BOUND_MS, deferInterrupts } from '#sim-cli/terminal/interrupts'
import { setSoftExitCode } from '../../embed-context'
import { SourceDirError } from './local-errors'
import {
  confirm,
  type Diagnostic,
  planNext,
  refusedExitCode,
  stopAtPlan,
  type WriteMode,
} from './source-ui'

/** The next step a result names: a command and why to run it. */
export interface NextStep {
  command: string
  reason: string
}

/** What a write answers with, as far as the flow reads it: its findings. */
interface WriteAnswer {
  diagnostics: ReadonlyArray<Pick<Diagnostic, 'code' | 'severity'>>
}

/** One source write as {@link runSourceWrite} drives it. */
export interface SourceWriteFlow<D extends WriteAnswer> {
  mode: WriteMode
  /** The dry run that previews the write, and is the whole of a `--dry-run`. */
  preview(): Promise<D>
  /** Prints a preview: its findings (and a workspace's plan). */
  show(preview: D): void
  /** Whether a preview's errors refuse the write, which is then reported and goes no further. */
  refuses(preview: D): boolean
  /**
   * The exit status of a preview with errors, as the write it previews would exit: by default the
   * refusal's ({@link refusedExitCode}).
   */
  previewExitCode?(preview: D): number
  /** Prints what a preview that refuses nothing would write, before the plan stop or the question. */
  explain?(preview: D): void
  /** Runs once the write may go ahead, before it is sent (the preview, or `null` with `--yes`). */
  beforeCommit?(preview: D | null): Promise<void>
  /** Sends the write and prints its findings. */
  commit(): Promise<D>
  /** Saves a committed write's answer into the directory, when it stored anything. */
  save(answer: D): Promise<void>
  /** Prints `answer` as the result, with the next step a plan names. */
  report(answer: D, next?: NextStep): void
  /** The confirmation question a person at a terminal answers. */
  question: string
  /** This write as a command, without `--yes`: what a `plan` run names next with it. */
  command: string
  /** What an interrupt during the send and save prints. */
  interrupt: {
    verb: string
    dir: string
    noun: 'workflow' | 'workspace'
    /** The next step when the write's answer never came back, so it may have been stored. */
    ifAnswerLost: string
  }
}

/**
 * Runs `flow`: in every mode but `write`, previews it and prints the preview, exiting with the
 * refusal's status on errors; a `dry-run` or a refused preview is reported there, a `plan` stops
 * with {@link stopAtPlan}, and `ask` asks. Then sends the write and saves its answer with Ctrl-C
 * held ({@link deferInterrupts}), so an interrupt never strands a stored write the directory did
 * not record. Returns the committed answer for the caller to finish and report, or `null` when
 * the flow ended at the preview, already reported.
 */
export async function runSourceWrite<D extends WriteAnswer>(
  flow: SourceWriteFlow<D>
): Promise<D | null> {
  let preview: D | null = null
  if (flow.mode !== 'write') {
    preview = await flow.preview()
    flow.show(preview)
    if (preview.diagnostics.some((finding) => finding.severity === 'error')) {
      setSoftExitCode(flow.previewExitCode?.(preview) ?? refusedExitCode(preview.diagnostics))
    }
    if (flow.mode === 'dry-run' || flow.refuses(preview)) {
      flow.report(preview)
      return null
    }
    flow.explain?.(preview)
    if (flow.mode === 'plan') {
      stopAtPlan()
      flow.report(preview, planNext(flow.command))
      return null
    }
    if (!(await confirm(flow.question))) {
      throw new SourceDirError('Nothing was applied.', { code: 'CANCELLED' })
    }
  }
  await flow.beforeCommit?.(preview)
  const { verb, dir, noun, ifAnswerLost } = flow.interrupt
  return deferInterrupts(
    async () => {
      const answer = await flow.commit()
      await flow.save(answer)
      return answer
    },
    {
      waiting: `Interrupted: the ${verb} was already sent. Waiting up to ${DEFERRED_INTERRUPT_BOUND_MS / 1000}s for its answer and saving it into ${dir}, so the directory matches the ${noun}; press Ctrl-C again to stop now.`,
      abandoned: `Stopped before the ${verb} answered. ${ifAnswerLost}`,
    }
  )
}
