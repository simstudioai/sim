import { matchReviews, readReviewLedger } from '#control-analysis/review-ledger'
import { ConformanceLinter } from '#design-conformance/conformance'
import { addControlComparison, controlSource } from '#design-conformance/control-comparison'
import {
  compareGit,
  gitText,
  loadCatalogue,
  options,
  policyOption,
  writeJson,
} from '#design-conformance/io'
import { Linter } from '#design-conformance/lint'
import { implementationHash, type Policy, policyVersion, VERSION } from '#design-conformance/model'
import { gitSnapshot } from '#design-conformance/system-snapshot'

let output: string | undefined
let policy: Policy = 'conformance'
try {
  const args = options({ reviews: { type: 'string' } })
  output = args.output as string | undefined
  policy = policyOption(args.policy)
  if (!args.repo || !args.base || !args.head)
    throw new Error(
      'Usage: lint:diff --repo <repository> --base <revision> --head <revision> [--catalogue <file>] [--output <report.json>] [--reviews <external.json>]'
    )
  if (policy === 'conformance' && args.catalogue)
    throw new Error(
      '--catalogue is a legacy policy input; conformance derives authority from central source snapshots'
    )
  const cat =
    policy === 'conformance' ? undefined : loadCatalogue(args.catalogue as string | undefined)
  const linter = cat
    ? await Linter.create(cat.catalogue, cat.hash, policy)
    : new ConformanceLinter()
  let report: ReturnType<Linter['report']>
  try {
    const { commits, changes } = compareGit(
      args.repo as string,
      args.base as string,
      args.head as string
    )
    report =
      linter instanceof ConformanceLinter
        ? await addControlComparison(
            await linter.analyze(
              changes,
              (entry) => gitText(args.repo as string, entry),
              commits,
              gitSnapshot(args.repo as string, commits.mergeBase)
            ),
            changes,
            () => controlSource(args.repo as string, commits.mergeBase),
            () => controlSource(args.repo as string, commits.head)
          )
        : linter.analyze(changes, (entry) => gitText(args.repo as string, entry), commits)
  } catch (error) {
    report = linter.report(null, error instanceof Error ? error.message : 'Operational failure')
  }
  if (args.reviews && report.status === 'completed')
    report.reviewDecisions = matchReviews(
      readReviewLedger(args.reviews as string, args.repo as string),
      report.findings,
      []
    )
  if (output) writeJson(output, report)
  else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exitCode = report.status === 'failed' ? 2 : report.flagged ? 1 : 0
} catch (error) {
  const report = {
    schemaVersion: VERSION,
    toolVersion: VERSION,
    policyVersion: policyVersion(policy),
    implementationHash: implementationHash(),
    commits: null,
    status: 'failed',
    flagged: null,
    error: error instanceof Error ? error.message : 'Operational failure',
  }
  process.stderr.write(`${JSON.stringify(report)}\n`)
  process.exitCode = 2
}
