/**
 * Round-trip proof tooling for the corpus tests: the fast-check workflow generator, the oracles
 * each property runs, and the per-block-type report. Test infrastructure only; nothing at runtime
 * imports it.
 */

export { workflowStateArbitrary } from './arbitraries'
export { findDifferences } from './diff'
export {
  assertNoErrors,
  assertNoopDiff,
  assertNoopIdentity,
  executionParity,
  idempotence,
  type OracleResult,
} from './oracles'
export { createProofReport, type ProofProperty, reportPathVariable } from './report'
