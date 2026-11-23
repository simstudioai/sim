/**
 * A workflow lint report with no findings, carrying every field the v2 lint
 * contract publishes. A fresh object per call, so a test that spreads a finding
 * in never leaks it into another.
 *
 * @example
 * ```ts
 * mocks.buildWorkflowLintReport.mockResolvedValue({
 *   ...createEmptyWorkflowLintReport(),
 *   orphanBlocks: [{ blockId: 'fn', blockName: 'Fn', blockType: 'function' }],
 * })
 * ```
 */
export function createEmptyWorkflowLintReport() {
  return {
    sources: [],
    sinks: [],
    orphanBlocks: [],
    emptyOutgoingPorts: [],
    invalidBranchPorts: [],
    invalidConnectionTargets: [],
    fieldIssues: [],
    unresolvedReferences: [],
    tableFieldIssues: [],
    manualRunIssue: null,
    notes: [],
  }
}
