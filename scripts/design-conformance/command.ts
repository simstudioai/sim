import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ConformanceLinter } from '#design-conformance/conformance'
import {
  compareGit,
  gitText,
  loadCatalogue,
  options,
  policyOption,
  writeJson,
} from '#design-conformance/io'
import { Linter } from '#design-conformance/lint'
import type { Policy, Report } from '#design-conformance/model'
import { githubAnnotations, githubSummary, textReport } from '#design-conformance/reporting'
import { gitSnapshot } from '#design-conformance/system-snapshot'

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const usage =
  'Usage: bun run check:design --base <revision> [--head HEAD] [--repo <repository>] [--format text|json] [--output <report.json>] [--policy conformance|appearance|tokens] [--catalogue <legacy.json>]'

export interface CheckArguments {
  repo: string
  base: string
  head: string
  policy: Policy
  catalogue?: string
}

export async function checkComparison(args: CheckArguments): Promise<Report> {
  if (args.policy === 'conformance' && args.catalogue)
    throw new Error(
      '--catalogue is a legacy policy input; conformance uses central source snapshots'
    )
  const catalogue = args.policy === 'conformance' ? undefined : loadCatalogue(args.catalogue)
  const linter = catalogue
    ? await Linter.create(catalogue.catalogue, catalogue.hash, args.policy)
    : new ConformanceLinter()
  try {
    const { commits, changes } = compareGit(args.repo, args.base, args.head)
    return linter instanceof ConformanceLinter
      ? await linter.analyze(
          changes,
          (entry) => gitText(args.repo, entry),
          commits,
          gitSnapshot(args.repo, commits.mergeBase)
        )
      : linter.analyze(changes, (entry) => gitText(args.repo, entry), commits)
  } catch (error) {
    return linter.report(null, error instanceof Error ? error.message : 'Operational failure')
  }
}

/** The regular command always preserves 0/1/2; only the CI wrapper tolerates findings. */
export async function main(argv = process.argv.slice(2)): Promise<number> {
  let output: string | undefined
  let format: 'text' | 'json' = 'text'
  let report: Report
  try {
    const args = options({ format: { type: 'string' }, help: { type: 'boolean' } }, argv)
    if (args.help) {
      process.stdout.write(
        `${usage}\nChecks committed merge-base → head changes; staged and uncommitted edits are not inspected.\n`
      )
      return 0
    }
    output = args.output as string | undefined
    if (args.format !== undefined && args.format !== 'text' && args.format !== 'json')
      throw new Error('--format must be text or json')
    format = (args.format ?? 'text') as 'text' | 'json'
    if (!args.base) throw new Error(usage)
    report = await checkComparison({
      repo: (args.repo as string | undefined) ?? repositoryRoot,
      base: args.base as string,
      head: (args.head as string | undefined) ?? 'HEAD',
      policy: policyOption(args.policy),
      catalogue: args.catalogue as string | undefined,
    })
  } catch (error) {
    report = new ConformanceLinter().report(
      null,
      error instanceof Error ? error.message : 'Operational failure'
    )
  }
  try {
    if (output) writeJson(output, report)
    const rendered = format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : textReport(report)
    if (format === 'text' && report.status === 'failed') process.stderr.write(rendered)
    else process.stdout.write(rendered)
    if (process.env.GITHUB_ACTIONS === 'true') {
      for (const annotation of githubAnnotations(report)) process.stderr.write(`${annotation}\n`)
      if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, githubSummary(report))
    }
  } catch (error) {
    process.stderr.write(
      `Design report could not be written: ${JSON.stringify(error instanceof Error ? error.message : 'Operational failure')}\n`
    )
    return 2
  }
  return report.status === 'failed' ? 2 : report.flagged ? 1 : 0
}
