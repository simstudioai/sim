/**
 * A2A Agent Card Generation
 *
 * Generates Agent Cards from workflow metadata and configuration.
 */

import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  extractInputFormatFromBlocks,
  generateToolInputSchema,
} from '@/lib/mcp/workflow-tool-schema'
import type { InputFormatField } from '@/lib/workflows/types'
import {
  A2A_DEFAULT_CAPABILITIES,
  A2A_DEFAULT_INPUT_MODES,
  A2A_DEFAULT_OUTPUT_MODES,
} from './constants'
import type {
  AgentAuthentication,
  AgentCapabilities,
  AgentCard,
  AgentSkill,
  JSONSchema,
} from './types'
import { buildA2AEndpointUrl, sanitizeAgentName } from './utils'

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
  authentication?: AgentAuthentication
}

/**
 * Generate an Agent Card from agent and workflow data
 */
export function generateAgentCard(agent: AgentData, workflow: WorkflowData): AgentCard {
  const baseUrl = getBaseUrl()

  return {
    name: agent.name,
    description: agent.description || workflow.description || undefined,
    url: buildA2AEndpointUrl(baseUrl, agent.id),
    version: agent.version || '1.0.0',
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
      },
    ],
    authentication: agent.authentication || {
      schemes: ['bearer', 'apiKey'],
    },
    defaultInputModes: [...A2A_DEFAULT_INPUT_MODES],
    defaultOutputModes: [...A2A_DEFAULT_OUTPUT_MODES],
  }
}

/**
 * Generate skills from workflow input format
 */
export function generateSkillsFromWorkflow(
  workflowId: string,
  workflowName: string,
  workflowDescription: string | undefined | null,
  blocks: Record<string, unknown>
): AgentSkill[] {
  const inputFormat = extractInputFormatFromBlocks(blocks)

  const skill: AgentSkill = {
    id: 'execute',
    name: `Execute ${workflowName}`,
    description: workflowDescription || `Execute the ${workflowName} workflow`,
    tags: ['workflow', 'automation'],
  }

  if (inputFormat && inputFormat.length > 0) {
    skill.inputSchema = convertInputFormatToJSONSchema(inputFormat)
  }

  // Add default output schema
  skill.outputSchema = {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The main text output from the workflow',
      },
      data: {
        type: 'object',
        description: 'Structured data output from the workflow',
      },
    },
  }

  return [skill]
}

/**
 * Convert InputFormatField array to JSON Schema
 */
export function convertInputFormatToJSONSchema(inputFormat: InputFormatField[]): JSONSchema {
  const mcpSchema = generateToolInputSchema(inputFormat)

  return {
    type: 'object',
    properties: mcpSchema.properties as Record<string, JSONSchema>,
    required: mcpSchema.required,
  }
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
export function validateAgentCard(card: unknown): card is AgentCard {
  if (!card || typeof card !== 'object') return false

  const c = card as Record<string, unknown>

  // Required fields
  if (typeof c.name !== 'string' || !c.name) return false
  if (typeof c.url !== 'string' || !c.url) return false
  if (typeof c.version !== 'string' || !c.version) return false

  // Capabilities must be an object
  if (c.capabilities && typeof c.capabilities !== 'object') return false

  // Skills must be an array
  if (!Array.isArray(c.skills)) return false

  return true
}

/**
 * Merge agent card with updates (partial update support)
 */
export function mergeAgentCard(existing: AgentCard, updates: Partial<AgentCard>): AgentCard {
  return {
    ...existing,
    ...updates,
    capabilities: {
      ...existing.capabilities,
      ...updates.capabilities,
    },
    skills: updates.skills || existing.skills,
    authentication: updates.authentication || existing.authentication,
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
