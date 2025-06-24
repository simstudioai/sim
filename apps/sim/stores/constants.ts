// localStorage persistence removed - STORAGE_KEYS no longer needed

export const API_ENDPOINTS = {
  SYNC: '/api/workflows/sync',
  ENVIRONMENT: '/api/environment',
  SCHEDULE: '/api/schedules',
  SETTINGS: '/api/settings',
  WORKFLOWS: '/api/workflows',
  WORKSPACE_PERMISSIONS: (id: string) => `/api/workspaces/${id}/permissions`,
}

// Removed SYNC_INTERVALS - Socket.IO handles real-time sync
