/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildAgentCard } from '@/lib/a2a/agent-card'
import { A2A_PROTOCOL_VERSION } from '@/lib/a2a/constants'

const BASE_URL = 'https://example.com'

const baseAgent = {
  id: 'agent-1',
  name: 'Support Agent',
  version: '2.1.0',
}

describe('buildAgentCard', () => {
  it('emits a spec-compliant v0.3 AgentCard', () => {
    const card = buildAgentCard({
      agent: baseAgent,
      baseUrl: BASE_URL,
      providerOrganization: 'Sim',
    })

    expect(card.protocolVersion).toBe(A2A_PROTOCOL_VERSION)
    expect(card.name).toBe('Support Agent')
    expect(card.version).toBe('2.1.0')
    expect(card.preferredTransport).toBe('JSONRPC')
    expect(card.url).toBe('https://example.com/api/a2a/serve/agent-1')
    expect(card.provider).toEqual({ organization: 'Sim', url: BASE_URL })
    expect(card.documentationUrl).toBe('https://example.com/docs/a2a')
  })

  it('uses MIME types (not "text") for default input/output modes', () => {
    const card = buildAgentCard({
      agent: baseAgent,
      baseUrl: BASE_URL,
      providerOrganization: 'Sim',
    })

    expect(card.defaultInputModes).toEqual(['text/plain', 'application/json'])
    expect(card.defaultOutputModes).toEqual(['text/plain', 'application/json'])
  })

  it('reports the agent version distinct from the protocol version', () => {
    const card = buildAgentCard({
      agent: { ...baseAgent, version: '9.9.9' },
      baseUrl: BASE_URL,
      providerOrganization: 'Sim',
    })

    expect(card.version).toBe('9.9.9')
    expect(card.protocolVersion).toBe(A2A_PROTOCOL_VERSION)
    expect(card.version).not.toBe(card.protocolVersion)
  })

  it('adds an apiKey security scheme when auth is required', () => {
    const card = buildAgentCard({
      agent: { ...baseAgent, authentication: { schemes: ['bearer', 'apiKey'] } },
      baseUrl: BASE_URL,
      providerOrganization: 'Sim',
    })

    expect(card.securitySchemes).toEqual({
      apiKey: {
        type: 'apiKey',
        name: 'X-API-Key',
        in: 'header',
        description: 'API key authentication',
      },
    })
    expect(card.security).toEqual([{ apiKey: [] }])
  })

  it('omits security schemes for public ("none") agents', () => {
    const card = buildAgentCard({
      agent: { ...baseAgent, authentication: { schemes: ['none'] } },
      baseUrl: BASE_URL,
      providerOrganization: 'Sim',
    })

    expect(card.securitySchemes).toBeUndefined()
    expect(card.security).toBeUndefined()
  })

  it('synthesizes a default execute skill from the workflow when none are set', () => {
    const card = buildAgentCard({
      agent: baseAgent,
      baseUrl: BASE_URL,
      providerOrganization: 'Sim',
      workflow: { name: 'Triage', description: 'Triage inbound tickets' },
    })

    expect(card.skills).toEqual([
      {
        id: 'execute',
        name: 'Execute Triage',
        description: 'Triage inbound tickets',
        tags: [],
      },
    ])
  })

  it('prefers explicit agent skills over the synthesized default', () => {
    const skills = [
      { id: 'summarize', name: 'Summarize', description: 'Summarize text', tags: ['nlp'] },
    ]
    const card = buildAgentCard({
      agent: { ...baseAgent, skills },
      baseUrl: BASE_URL,
      providerOrganization: 'Sim',
      workflow: { name: 'Triage' },
    })

    expect(card.skills).toBe(skills)
  })

  it('falls back to workflow then a generated description', () => {
    const withWorkflow = buildAgentCard({
      agent: baseAgent,
      baseUrl: BASE_URL,
      providerOrganization: 'Sim',
      workflow: { description: 'From workflow' },
    })
    expect(withWorkflow.description).toBe('From workflow')

    const generated = buildAgentCard({
      agent: baseAgent,
      baseUrl: BASE_URL,
      providerOrganization: 'Acme',
    })
    expect(generated.description).toBe('Support Agent - A2A Agent powered by Acme')
  })
})
