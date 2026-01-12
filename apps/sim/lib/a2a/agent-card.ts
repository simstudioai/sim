/**
 * A2A Agent Card Generation
 *
 * Generates Agent Cards from workflow metadata and configuration.
 */

import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  A2A_DEFAULT_CAPABILITIES,
  A2A_DEFAULT_INPUT_MODES,
  A2A_DEFAULT_OUTPUT_MODES,
  A2A_PROTOCOL_VERSION,
} from './constants'
import type { AgentCapabilities, AgentSkill } from './types'
import { buildA2AEndpointUrl, sanitizeAgentName } from './utils'

/**
 * App-specific Agent Card type (extends SDK types with app-specific fields)
 */
export interface AppAgentCard {
  name: string
  description: string
  url: string
  protocolVersion: string
  documentationUrl?: string
  provider?: {
    organization: string
    url: string
  }
  capabilities: AgentCapabilities
  skills: AgentSkill[]
  defaultInputModes: string[]
  defaultOutputModes: string[]
}

interface WorkflowData {
  id: string
  name: string
  description?: string | null
}

interface AgentData {
  id: string
  name: string
  description?: string | null
  version: string
  capabilities?: AgentCapabilities
  skills?: AgentSkill[]
}

/**
 * Generate an Agent Card from agent and workflow data
 */
export function generateAgentCard(agent: AgentData, workflow: WorkflowData): AppAgentCard {
  const baseUrl = getBaseUrl()
  const description =
    agent.description || workflow.description || `${agent.name} - A2A Agent powered by Sim Studio`

  return {
    name: agent.name,
    description,
    url: buildA2AEndpointUrl(baseUrl, agent.id),
    protocolVersion: A2A_PROTOCOL_VERSION,
    documentationUrl: `${baseUrl}/docs/a2a`,
    provider: {
      organization: 'Sim Studio',
      url: baseUrl,
    },
    capabilities: {
      ...A2A_DEFAULT_CAPABILITIES,
      ...agent.capabilities,
    },
    skills: agent.skills || [
      {
        id: 'execute',
        name: `Execute ${workflow.name}`,
        description: workflow.description || `Execute the ${workflow.name} workflow`,
        tags: ['workflow', 'automation'],
      },
    ],
    defaultInputModes: [...A2A_DEFAULT_INPUT_MODES],
    defaultOutputModes: [...A2A_DEFAULT_OUTPUT_MODES],
  }
}

/**
 * Generate skills from workflow input format
 */
export function generateSkillsFromWorkflow(
  workflowName: string,
  workflowDescription: string | undefined | null
): AgentSkill[] {
  const skill: AgentSkill = {
    id: 'execute',
    name: `Execute ${workflowName}`,
    description: workflowDescription || `Execute the ${workflowName} workflow`,
    tags: ['workflow', 'automation'],
  }

  return [skill]
}

/**
 * Generate a default agent name from workflow name
 */
export function generateDefaultAgentName(workflowName: string): string {
  return sanitizeAgentName(workflowName)
}

/**
 * Validate agent card structure
 */
export function validateAgentCard(card: unknown): card is AppAgentCard {
  if (!card || typeof card !== 'object') return false

  const c = card as Record<string, unknown>

  if (typeof c.name !== 'string' || !c.name) return false
  if (typeof c.url !== 'string' || !c.url) return false
  if (typeof c.description !== 'string') return false

  if (c.capabilities && typeof c.capabilities !== 'object') return false

  if (!Array.isArray(c.skills)) return false

  return true
}

/**
 * Merge agent card with updates (partial update support)
 */
export function mergeAgentCard(
  existing: AppAgentCard,
  updates: Partial<AppAgentCard>
): AppAgentCard {
  return {
    ...existing,
    ...updates,
    capabilities: {
      ...existing.capabilities,
      ...updates.capabilities,
    },
    skills: updates.skills || existing.skills,
  }
}

/**
 * Create agent card URL paths
 */
export function getAgentCardPaths(agentId: string) {
  const baseUrl = getBaseUrl()
  return {
    card: `${baseUrl}/api/a2a/agents/${agentId}`,
    serve: `${baseUrl}/api/a2a/serve/${agentId}`,
  }
}
