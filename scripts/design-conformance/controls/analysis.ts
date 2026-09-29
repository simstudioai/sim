import {
  type ColourAssignmentReport,
  ColourAssignments,
} from '#design-conformance/controls/colour-assignments'
import { type ControlInventory, inspectControls } from '#design-conformance/controls/inventory'
import type { ControlSource } from '#design-conformance/controls/model'
import { ReviewCollector, type ReviewReport } from '#design-conformance/controls/review'
import type { GeneratedContracts } from '#design-conformance/system/generated-contracts'

/** Shared control analysis for the diff check and complete scan. */
export function inspectControlAnalysis(
  source: ControlSource,
  order: 'forward' | 'reverse' = 'forward',
  centralReference?: Parameters<typeof inspectControls>[2],
  metadata?: GeneratedContracts
): {
  controls: ControlInventory
  colourAssignments: ColourAssignmentReport
  review: ReviewReport
} {
  const colourAssignments = new ColourAssignments(source)
  const review = new ReviewCollector(source, metadata)
  let staticInputs: Parameters<typeof colourAssignments.finish>[0] | undefined
  const controls = inspectControls(source, order, centralReference, {
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
  const stylingReview = review.finish(controls)
  return {
    controls,
    colourAssignments: colourReport,
    review: stylingReview,
  }
}
