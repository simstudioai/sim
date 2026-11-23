import { compileSubmission } from '@/lib/workflows/application/source-pipeline/evaluate/compile'
import { finalizePlan } from '@/lib/workflows/application/source-pipeline/evaluate/finalize'
import { gateSourceGraph } from '@/lib/workflows/application/source-pipeline/evaluate/gates'
import { sourceRefusals } from '@/lib/workflows/application/source-pipeline/evaluate/refusals'
import { resolveSubmission } from '@/lib/workflows/application/source-pipeline/evaluate/resolve'
import type {
  SourceEvaluation,
  SourceEvaluationInput,
} from '@/lib/workflows/application/source-pipeline/evaluate/types'

/**
 * Evaluates submitted source against a stored draft without writing it: compile against the live
 * catalog, parse the lock, materialize onto the stored graph (keeping every unchanged value's
 * stored bytes and every id the lock binds), then every gate (locked blocks, engine gates,
 * types that may stay but not be added), the value checks and lint. Returns the refusals, located
 * in the submitted text, or the plan the write stores.
 */
export async function evaluateSource(input: SourceEvaluationInput): Promise<SourceEvaluation> {
  const submission = compileSubmission(input)
  if ('refused' in submission) return { refused: submission.refused }
  const resolved = await resolveSubmission(input, submission)
  if ('refused' in resolved) return resolved
  const refusals = await sourceRefusals(input, submission, resolved)
  const gated = await gateSourceGraph(input, resolved)
  return finalizePlan(input, submission, resolved, refusals, gated)
}
