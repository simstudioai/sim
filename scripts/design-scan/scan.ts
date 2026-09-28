import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { inspectControlAnalysis } from '#control-analysis/analysis'
import {
  type ColourAssignmentReport,
  withoutVerifiedColourUsages,
} from '#control-analysis/colour-assignments'
import type { ControlInventory } from '#control-analysis/inventory'
import { classifyLayout, type LayoutAllowance } from '#control-analysis/layout-allowances'
import type { ReviewReport } from '#control-analysis/review'
import { mergeSourceFindings } from '#control-analysis/review'
import { inspectionFailure } from '#design-conformance/model'
import { GitSource } from '#design-conformance/worktree-source'
import { scannerIdentity } from './identity'
import { inspectInventory } from './inventory'
import { validateOutput, writeResults } from './report'

const requiredRuntime = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
).packageManager.replace(/^bun@/, '') as string
const usage = `Usage: bun run design:scan --repo <checkout-or-bare-repo> (--ref <commit-or-ref> | --working-tree) --output <new-external-directory>
Optional: --order forward|reverse --batch-size 25
Requires Bun ${requiredRuntime}. Working-tree mode includes non-ignored untracked source. No application code is executed.
Exits: 0 complete without findings; 1 completed with findings; 2 inspection or operational failure.
Batch size controls progress reporting only; it does not change resolution or findings.`

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const { values } = parseArgs({
      args: argv,
      strict: true,
      options: {
        repo: { type: 'string' },
        ref: { type: 'string' },
        'working-tree': { type: 'boolean' },
        output: { type: 'string' },
        order: { type: 'string', default: 'forward' },
        'batch-size': { type: 'string', default: '25' },
        help: { type: 'boolean' },
      },
    })
    if (values.help) {
      process.stdout.write(`${usage}\n`)
      return 0
    }
    if (
      !values.repo ||
      !values.output ||
      (!values.ref && !values['working-tree']) ||
      (values.ref && values['working-tree'])
    )
      throw new Error(usage)
    if (process.versions.bun !== requiredRuntime)
      throw new Error(`Use the pinned Bun ${requiredRuntime} runtime`)
    if (values.order !== 'forward' && values.order !== 'reverse')
      throw new Error('Order must be forward or reverse')
    const batchSize = Number(values['batch-size'])
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000)
      throw new Error('Batch size must be 1–1000')
    const start = performance.now()
    const output = validateOutput(values.output, values.repo)
    const identity = scannerIdentity()
    const source = new GitSource(values.repo, values.ref ?? 'HEAD', !!values['working-tree'])
    let controls: ControlInventory | undefined
    let colourAssignments: ColourAssignmentReport | undefined
    let layoutAllowances: LayoutAllowance[] = []
    let review: ReviewReport | undefined
    const inventory = await inspectInventory(source, {
      order: values.order,
      withSourceIndex: (index, findings, system) => {
        const result = inspectControlAnalysis(
          source,
          values.order as 'forward' | 'reverse',
          system.resolve,
          system.metadata
        )
        controls = result.controls
        colourAssignments = result.colourAssignments
        review = result.review
        const remaining = withoutVerifiedColourUsages(findings, colourAssignments)
        const layout = classifyLayout(
          mergeSourceFindings([...remaining, ...colourAssignments.findings], review.findings)
        )
        const finalFindings = layout.findings
        layoutAllowances = layout.allowances
        return {
          replaceFindings: finalFindings,
          findings: [],
          unchecked: [
            ...colourAssignments.unchecked,
            ...review.unchecked,
            ...controls.unchecked.filter(inspectionFailure),
          ],
        }
      },
      batchSize,
      progress: (done, total) =>
        process.stderr.write(`Inspected ${done}/${total} consumer roots\n`),
    })
    if (!controls) throw new Error('Control analysis did not complete')
    source.assertUnchanged()
    writeResults(
      output,
      inventory,
      identity,
      {
        elapsedMs: performance.now() - start,
        maxRss: process.resourceUsage().maxRSS,
        maxRssUnit: 'KiB (process.resourceUsage)',
        order: values.order,
        batchSize,
      },
      controls,
      {
        colourAssignments: colourAssignments!,
        layoutAllowances,
        review: review!,
      }
    )
    process.stdout.write(
      `${inventory.findings.length} styling rule findings; ${controls.records.length} control/source candidates; ${inventory.unchecked.length} styling and ${controls.unchecked.length} control analysis diagnostics. Results: ${JSON.stringify(output)}\n`
    )
    if (inventory.status === 'incomplete') {
      process.stderr.write(
        `${inventory.coverageFailures.length} inspection failures; scan incomplete.\n`
      )
      return 2
    }
    return inventory.findings.length ? 1 : 0
  } catch (error) {
    process.stderr.write(
      `Inventory failed: ${JSON.stringify(error instanceof Error ? error.message : String(error))}\n`
    )
    return 2
  }
}

if (import.meta.main) process.exitCode = await main()
