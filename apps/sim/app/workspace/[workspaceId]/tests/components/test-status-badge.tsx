import { Badge } from '@sim/emcn'
import type { WorkflowTestRecord } from '@/lib/api/contracts/workflow-tests'

type BadgeVariant = 'green' | 'red' | 'amber' | 'gray'
type TestStatus = WorkflowTestRecord['status']

const TEST_STATUS: Record<TestStatus, { label: string; variant: BadgeVariant }> = {
  passing: { label: 'Passed', variant: 'green' },
  failing: { label: 'Failed', variant: 'red' },
  error: { label: 'Didn’t run', variant: 'red' },
  running: { label: 'Running', variant: 'amber' },
  changed: { label: 'Changed', variant: 'gray' },
  not_run: { label: 'Not run', variant: 'gray' },
}

interface TestStatusBadgeProps {
  status: TestStatus
}

/** A test's latest outcome, styled like a log's status. */
export function TestStatusBadge({ status }: TestStatusBadgeProps) {
  const config = TEST_STATUS[status]
  return (
    <Badge variant={config.variant} dot size='sm'>
      {config.label}
    </Badge>
  )
}
