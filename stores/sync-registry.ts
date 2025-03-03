import { environmentSync } from './settings/environment/sync'
import { SyncManager } from './sync'
import { workflowSync } from './workflows/sync'

// Registry of all sync managers
export const syncManagers: SyncManager[] = [workflowSync, environmentSync]

// Export individual sync managers for direct use
export { workflowSync, environmentSync }
