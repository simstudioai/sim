import Ajv from 'ajv'
import { describe, expect, it } from 'vitest'
import {
  managementToolContracts,
  managementToolDefinitions,
} from '@/lib/api/contracts/mothership-management-tools'

const workspaceId = '6bbd0147-86ae-4e0b-aa32-26c64e61f58d'
const examples = {
  workspaces: [
    { action: 'create', name: 'Research' },
    { action: 'create', name: 'Research', skipDefaultWorkflow: true },
  ],
  settings: [
    { action: 'list', scope: 'organization' },
    { action: 'get', scope: 'workspace', workspaceId, section: 'members' },
    { action: 'open', scope: 'account', section: 'profile' },
    { action: 'describe', scope: 'organization', section: 'members', operation: 'list_page' },
    {
      action: 'execute',
      scope: 'organization',
      section: 'members',
      operation: 'list_page',
      input: { limit: 10 },
    },
    { action: 'update', scope: 'account', section: 'profile', changes: { timezone: 'UTC' } },
  ],
  search_sources: [
    { action: 'list', connectorType: 'google_drive', mine: true },
    { action: 'get', connectorId: 'source-1' },
    { action: 'providers' },
    { action: 'setup', connectorType: 'google_drive', accessMode: 'admin' },
    { action: 'approve', connectorType: 'google_drive', approved: true },
  ],
}

describe('management tool provider contract', () => {
  for (const definition of managementToolDefinitions) {
    it(`${definition.id} exposes an object root accepted by both providers`, () => {
      expect(definition.parameters.type).toBe('object')
      for (const keyword of ['oneOf', 'anyOf', 'allOf']) {
        expect(definition.parameters).not.toHaveProperty(keyword)
      }
      const validate = new Ajv({ strict: false, validateFormats: false }).compile(
        definition.parameters
      )
      const canonical = managementToolContracts.find(
        (item) => item.id === definition.id
      )!.inputSchema
      for (const input of examples[definition.id]) {
        expect(canonical.safeParse(input).success).toBe(true)
        expect(validate(input), JSON.stringify(validate.errors)).toBe(true)
        expect(validate({ ...input, unexpected: true })).toBe(false)
      }
      expect(validate({ action: 'arbitrary_operation' })).toBe(false)
    })
  }

  it('publishes exact action variants for CLI required fields and allowed flags', () => {
    for (const definition of managementToolDefinitions) {
      for (const input of examples[definition.id]) {
        const validate = new Ajv({ strict: false, validateFormats: false }).compile(
          definition.actionSchemas[input.action]
        )
        expect(validate(input), JSON.stringify(validate.errors)).toBe(true)
        expect(validate({ ...input, unexpected: true })).toBe(false)
      }
    }
  })
})
