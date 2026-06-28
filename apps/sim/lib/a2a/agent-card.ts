import type { AgentCard } from '@a2a-js/sdk'
import {
  A2A_DEFAULT_CAPABILITIES,
  A2A_DEFAULT_INPUT_MODES,
  A2A_DEFAULT_OUTPUT_MODES,
  A2A_PROTOCOL_VERSION,
} from './constants'
import type { AgentAuthentication, AgentCapabilities, AgentSkill } from './types'
import { buildA2AEndpointUrl } from './utils'

interface BuildAgentCardAgent {
  id: string
  name: string
  description?: string | null
  version: string
  capabilities?: AgentCapabilities
  skills?: AgentSkill[]
  authentication?: AgentAuthentication | null
}

interface BuildAgentCardWorkflow {
  name?: string | null
  description?: string | null
}

interface BuildAgentCardInput {
  agent: BuildAgentCardAgent
  baseUrl: string
  /** Provider organization name (whitelabel-aware brand name). */
  providerOrganization: string
  /** Optional source workflow, used only for skill/description fallbacks. */
  workflow?: BuildAgentCardWorkflow
}

/**
 * Build a spec-compliant {@link AgentCard} (A2A v0.3) for a Sim agent.
 *
 * Single source of truth shared by the public serve endpoint, the
 * `.well-known/agent-card.json` discovery endpoint, and the management endpoint
 * so the three never drift.
 */
export function buildAgentCard({
  agent,
  baseUrl,
  providerOrganization,
  workflow,
}: BuildAgentCardInput): AgentCard {
  const description =
    agent.description ||
    workflow?.description ||
    `${agent.name} - A2A Agent powered by ${providerOrganization}`

  const schemes = agent.authentication?.schemes ?? []
  const isPublic = schemes.includes('none')

  const skills: AgentSkill[] =
    agent.skills && agent.skills.length > 0
      ? agent.skills
      : generateSkillsFromWorkflow(workflow?.name || agent.name, workflow?.description)

  const card: AgentCard = {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: agent.name,
    description,
    url: buildA2AEndpointUrl(baseUrl, agent.id),
    version: agent.version,
    preferredTransport: 'JSONRPC',
    documentationUrl: `${baseUrl}/docs/a2a`,
    provider: {
      organization: providerOrganization,
      url: baseUrl,
    },
    capabilities: {
      ...A2A_DEFAULT_CAPABILITIES,
      ...agent.capabilities,
    },
    skills,
    defaultInputModes: [...A2A_DEFAULT_INPUT_MODES],
    defaultOutputModes: [...A2A_DEFAULT_OUTPUT_MODES],
  }

  if (!isPublic) {
    card.securitySchemes = {
      apiKey: {
        type: 'apiKey',
        name: 'X-API-Key',
        in: 'header',
        description: 'API key authentication',
      },
    }
    card.security = [{ apiKey: [] }]
  }

  return card
}

export function generateSkillsFromWorkflow(
  workflowName: string,
  workflowDescription: string | undefined | null,
  tags?: string[]
): AgentSkill[] {
  const skill: AgentSkill = {
    id: 'execute',
    name: `Execute ${workflowName}`,
    description: workflowDescription || `Execute the ${workflowName} workflow`,
    tags: tags || [],
  }

  return [skill]
}
