export const STORAGE_KEYS = {
  REGISTRY: 'workflow-registry',
  WORKFLOW: (id: string) => `workflow-${id}`,
  SUBBLOCK: (id: string) => `subblock-values-${id}`,
}

export const API_ENDPOINTS = {
  SYNC: '/api/workflows/sync',
  ENVIRONMENT: '/api/environment',
  WORKFLOW_STATUS: '/api/workflows/[id]/status',
  WORKFLOW_VARIABLES: '/api/workflows/[id]/variables',
  WORKFLOW_SYNC: '/api/workflows/sync',
  SCHEDULE: '/api/schedules',
  SETTINGS: '/api/settings',
  WORKFLOWS: '/api/workflows',
}

export const SYNC_INTERVALS = {
  DEFAULT: 30000, // 30 seconds
}
