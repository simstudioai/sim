/**
 * Round-trip proof tooling, served from `@sim/workflow-code/proof` rather than the main entry so
 * runtime consumers (the Code tab, the CLI) never load fast-check. Pure, like the rest of the
 * package: the app supplies registry-derived corpora, the serializer and the report file write.
 */

export {
  ADVERSARIAL_STRING_FRAGMENTS,
  adversarialStringArbitrary,
  blockNameArbitrary,
  collidingNamesArbitrary,
  jsCodeBodyArbitrary,
  uniqueBlockNamesArbitrary,
  type WorkflowArbitraryOptions,
  workflowStateArbitrary,
} from './arbitraries'
export { type Difference, findDifferences, firstTextDifference } from './diff'
export {
  alignWorkflowIds,
  assertNoopIdentity,
  decodeStructured,
  type ExecutionParityInput,
  executionParity,
  idempotence,
  type OracleName,
  type OracleResult,
  type SerializedWorkflowLike,
  withoutAnnotations,
} from './oracles'
export { createSeededRandom, type SeededRandom } from './random'
export {
  type BlockTypeParity,
  createProofReport,
  PROOF_PROPERTIES,
  type ProofOutcome,
  type ProofProperty,
  type ProofReport,
  type ProofReportCollector,
  type ProofStatus,
  reportPathVariable,
} from './report'
