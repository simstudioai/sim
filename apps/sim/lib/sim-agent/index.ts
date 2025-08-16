// Export the main client and types

export type { SimAgentRequest, SimAgentResponse } from './client'
export { SimAgentClient, simAgentClient } from './client'
export { SIM_AGENT_API_URL_DEFAULT } from './constants'

// Import for default export
import { simAgentClient } from './client'

// Re-export for convenience
export default simAgentClient
