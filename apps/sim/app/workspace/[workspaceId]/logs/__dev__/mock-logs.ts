import type { WorkflowLog } from '@/stores/logs/filters/types'

const MOCK_WORKFLOW = {
  id: '__mock__',
  name: 'mock-workflow',
  color: '#6366f1',
}

const base = (overrides: Partial<WorkflowLog>): WorkflowLog => ({
  id: `mock-${overrides.trigger}-1`,
  workflowId: MOCK_WORKFLOW.id,
  executionId: `mock-exec-${overrides.trigger}-1`,
  level: 'info',
  status: 'success',
  duration: '1.2s',
  trigger: null,
  createdAt: new Date().toISOString(),
  workflow: MOCK_WORKFLOW,
  cost: { total: 0.001, input: 0.0005, output: 0.0005 },
  ...overrides,
})

export const DEV_MOCK_LOGS: WorkflowLog[] = [
  base({ id: 'mock-gcal-1', trigger: 'google_calendar', executionId: 'mock-exec-gcal-1' }),
  base({ id: 'mock-gmail-1', trigger: 'gmail', executionId: 'mock-exec-gmail-1' }),
  base({ id: 'mock-slack-1', trigger: 'slack', executionId: 'mock-exec-slack-1' }),
  base({
    id: 'mock-gh-1',
    trigger: 'github',
    executionId: 'mock-exec-gh-1',
    status: 'failed',
    level: 'error',
  }),
]
