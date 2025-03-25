export const STORAGE_KEYS = {
  REGISTRY: 'workflow-registry',
  WORKFLOW: (id: string) => `workflow-${id}`,
  SUBBLOCK: (id: string) => `subblock-values-${id}`,
}

export const API_ENDPOINTS = {
  WORKFLOW: '/api/db/workflow',
  ENVIRONMENT: '/api/db/environment',
  SCHEDULE: '/api/schedules/schedule',
  WORKFLOW_VARIABLES: '/api/db/workflow/variables',
}

export const SYNC_INTERVALS = {
  DEFAULT: 30000, // 30 seconds
}
