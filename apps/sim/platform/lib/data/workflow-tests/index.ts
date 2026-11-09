/**
 * The Tests tab's logic seam. The list and a test's results read the legacy workflow-test hooks and
 * contract unchanged; only their views are ported into the zone.
 */

export type {
  WorkflowTestDetail,
  WorkflowTestRecord,
} from '@/lib/api/contracts/workflow-tests'
export {
  useRefreshWorkflowTest,
  useRunWorkflowTests,
  useWorkflowTest,
  useWorkflowTestRun,
  useWorkflowTests,
} from '@/hooks/queries/workflow-tests'
export { useWorkflowTestsAccess } from '@/platform/lib/data/workflow-tests/access'
export {
  testDetailParsers,
  testsParsers,
  testsSortParams,
  testsUrlKeys,
} from '@/platform/lib/data/workflow-tests/navigation'
