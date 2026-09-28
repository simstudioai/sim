import {
  type ColourAssignmentReport,
  ColourAssignments,
} from '#control-analysis/colour-assignments'
import { type ControlInventory, inspectControls } from '#control-analysis/inventory'
import type { ControlSource, InventoryFinding } from '#control-analysis/model'
import { ReviewCollector, type ReviewReport } from '#control-analysis/review'
import { inspectShadowExtras, type ShadowExtrasReport } from '#control-analysis/shadow-extras'
import { inspectTypography, type TypographyReview } from '#control-analysis/typography'
import type { GeneratedContracts } from '#design-conformance/generated-contracts'
import { canonical, hash } from '#design-conformance/model'
import type { SourceIndex } from '#design-conformance/source-summary'

/** Shared control analysis for the diff check and complete scan. */
export function inspectControlAnalysis(
  source: ControlSource,
  styling: InventoryFinding[] = [],
  order: 'forward' | 'reverse' = 'forward',
  sourceIndex?: SourceIndex,
  centralReference?: Parameters<typeof inspectControls>[4],
  ownershipReview?: TypographyReview,
  metadata?: GeneratedContracts
): {
  controls: ControlInventory
  colourAssignments: ColourAssignmentReport
  shadowExtras: ShadowExtrasReport
  typographyReview: TypographyReview
  review: ReviewReport
} {
  const colourAssignments = new ColourAssignments(source)
  const review = new ReviewCollector(source, metadata ?? sourceIndex?.metadata)
  let staticInputs: Parameters<typeof colourAssignments.finish>[0] | undefined
  const controls = inspectControls(source, styling, order, sourceIndex, centralReference, {
    program(input) {
      colourAssignments.program(input)
      review.program(input)
    },
    complete(graph) {
      staticInputs = graph.staticInputs
      review.complete(graph)
    },
  })
  if (!staticInputs) throw new Error('Control source graph unavailable')
  const colourReport = colourAssignments.finish(staticInputs)
  const typography = ownershipReview ?? inspectTypography(source)
  const shadows = inspectShadowExtras(
    source,
    (name) => colourAssignments.globalColour(name),
    colourReport
  )
  const stylingReview = review.finish(controls)
  for (const item of shadows.approved)
    stylingReview.findings.push({
      id: hash(canonical(['local-shadow', item])),
      observedFrom: [item.file],
      rule: 'local-shadow',
      contract: 'local-shadow',
      kind: 'usage-violation',
      category: 'effects',
      property: 'box-shadow',
      value: item.id,
      reason: item.reason,
      file: item.file,
      line: item.line,
      column: 1,
      context: item.selector,
    })
  for (const item of typography.classifications)
    if (item.disposition === 'extra')
      stylingReview.findings.push({
        id: hash(canonical(['specialised-typography', item])),
        observedFrom: [item.file],
        rule: 'specialised-typography',
        contract: 'specialised-typography',
        kind: 'usage-violation',
        category: 'typography',
        property: item.property,
        value: item.value,
        reason: item.reason,
        file: item.file,
        line: item.line,
        column: 1,
        context: item.property,
      })
  return {
    controls,
    colourAssignments: colourReport,
    review: stylingReview,
    typographyReview: typography,
    shadowExtras: shadows,
  }
}
