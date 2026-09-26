import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import {
  type ColourAssignmentReport,
  withoutVerifiedColourUsages,
} from '#control-analysis/colour-assignments'
import type { ControlInventory } from '#control-analysis/inventory'
import { classifyLayout, type LayoutAllowance } from '#control-analysis/layout-allowances'
import type { ReviewReport } from '#control-analysis/review'
import { mergeSourceFindings } from '#control-analysis/review'
import {
  matchReviews,
  type ReviewDecisions,
  readReviewLedger,
} from '#control-analysis/review-ledger'
import {
  mergeShadowFindings,
  type ShadowExtrasReport,
  withoutApprovedShadows,
} from '#control-analysis/shadow-extras'
import {
  inspectSimplifications,
  type SimplificationReport,
} from '#control-analysis/simplifications'
import {
  classifyTypography,
  inspectTypography,
  type TypographyReview,
} from '#control-analysis/typography'
import { inspectionFailure } from '#design-conformance/model'
import { GitSource } from '#design-conformance/worktree-source'
import { scannerIdentity } from './identity'
import { inspectInventory } from './inventory'
import { validateOutput, writeResults } from './report'

const requiredRuntime = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
).packageManager.replace(/^bun@/, '') as string
const usage = `Usage: bun run design:scan --repo <checkout-or-bare-repo> (--ref <commit-or-ref> | --working-tree) --output <new-external-directory>
Optional: --order forward|reverse --batch-size 25 --reviews <external.json>
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
        reviews: { type: 'string' },
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
    const ownershipReview = inspectTypography(source)
    const excludedPaths = new Set(
      ownershipReview.ownership
        .filter((owner) => owner.status === 'verified')
        .map((owner) => owner.file)
    )
    const scopedSource = {
      // The control graph needs excluded module paths to resolve product imports,
      // but its inventory skips those sources before reading or inspecting them.
      entries: source.entries.filter((entry) => !excludedPaths.has(entry.path)),
      read: (entry: Parameters<typeof source.read>[0]) => source.read(entry),
      readOwnership: (entry: Parameters<typeof source.readOwnership>[0]) =>
        source.readOwnership(entry),
    }
    let controls: ControlInventory | undefined
    let simplifications: SimplificationReport | undefined
    let colourAssignments: ColourAssignmentReport | undefined
    let shadowExtras: ShadowExtrasReport | undefined
    let typographyReview: TypographyReview | undefined
    let layoutAllowances: LayoutAllowance[] = []
    let review: ReviewReport | undefined
    const inventory = await inspectInventory(source, {
      order: values.order,
      excludedPaths,
      withSourceIndex: (index, findings, system) => {
        const result = inspectSimplifications(
          scopedSource,
          findings,
          values.order as 'forward' | 'reverse',
          index,
          system.resolve,
          ownershipReview
        )
        controls = result.controls
        simplifications = result.simplifications
        colourAssignments = result.colourAssignments
        shadowExtras = result.shadowExtras
        typographyReview = result.typographyReview
        review = result.review
        const remaining = withoutVerifiedColourUsages(
          withoutApprovedShadows(findings, shadowExtras),
          colourAssignments
        )
        const layout = classifyLayout(
          classifyTypography(
            mergeShadowFindings(
              mergeSourceFindings(
                [...remaining, ...colourAssignments.findings, ...simplifications.findings],
                review.findings
              ),
              shadowExtras.findings
            ),
            typographyReview
          )
        )
        const finalFindings = layout.findings
        layoutAllowances = layout.allowances
        const findingIds = new Set(finalFindings.map((finding) => finding.id))
        for (const record of controls.records) {
          record.findingIds = record.findingIds.filter((id) => findingIds.has(id))
          record.potentialFindingIds = record.potentialFindingIds.filter((id) => findingIds.has(id))
        }
        for (const finding of simplifications.findings) {
          finding.relatedFindingIds = finding.relatedFindingIds.filter((id) => findingIds.has(id))
        }
        return {
          replaceFindings: finalFindings,
          findings: [],
          unchecked: [
            ...colourAssignments.unchecked,
            ...shadowExtras.unchecked,
            ...review.unchecked,
            ...controls.unchecked.filter((n) => inspectionFailure(n.reason)),
          ],
        }
      },
      batchSize,
      progress: (done, total) =>
        process.stderr.write(`Inspected ${done}/${total} consumer roots\n`),
    })
    if (!controls) throw new Error('Control analysis did not complete')
    source.assertUnchanged()
    const reviewDecisions: ReviewDecisions | undefined = values.reviews
      ? matchReviews(readReviewLedger(values.reviews, values.repo), inventory.findings, [])
      : undefined
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
      simplifications,
      colourAssignments,
      shadowExtras,
      typographyReview,
      layoutAllowances,
      review,
      reviewDecisions
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
