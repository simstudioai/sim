export const STORAGE_KEYS = {
  REGISTRY: 'workflow-registry',
  WORKFLOW: (id: string) => `workflow-${id}`,
  SUBBLOCK: (id: string) => `subblock-values-${id}`,
}

export const API_ENDPOINTS = {
  WORKFLOW: '/api/workflows/sync',
  ENVIRONMENT: '/api/environment',
  SCHEDULE: '/api/schedules/schedule',
  SETTINGS: '/api/settings',
  WORKFLOW_VARIABLES: '/api/workflows/[id]/variables',
}

export const SYNC_INTERVALS = {
  DEFAULT: 30000, // 30 seconds
}
