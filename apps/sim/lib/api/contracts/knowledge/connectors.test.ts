/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createConnectorBodySchema,
  updateConnectorAccessBodySchema,
} from '@/lib/api/contracts/knowledge/connectors'

const base = {
  connectorType: 'google_drive',
  sourceConfig: { folderId: ['f-1'] },
}

describe('connector access binding contracts', () => {
  it('defaults a create to workspace mode with a credential', () => {
    const parsed = createConnectorBodySchema.parse({ ...base, credentialId: 'cred-1' })
    expect(parsed.accessMode).toBe('workspace')
    expect(parsed.syncIntervalMinutes).toBe(1440)
  })

  it('accepts member access with optional dedicated content credentials', () => {
    for (const credentialId of [undefined, 'content-credential']) {
      expect(
        createConnectorBodySchema.parse({ ...base, accessMode: 'members', credentialId })
      ).toMatchObject({ accessMode: 'members', credentialId })
    }
  })

  it('does not expose caller-selected account container or option IDs', () => {
    const binding = {
      credentialGroupId: 'foreign-group',
      credentialGroupOptionId: 'foreign-option',
    }
    const created = createConnectorBodySchema.parse({ ...base, accessMode: 'members', ...binding })
    const changed = updateConnectorAccessBodySchema.parse({ accessMode: 'members', ...binding })
    for (const parsed of [created, changed]) {
      expect(parsed).not.toHaveProperty('credentialGroupId')
      expect(parsed).not.toHaveProperty('credentialGroupOptionId')
    }
  })

  it('refuses a mode switch that names no mode', () => {
    expect(updateConnectorAccessBodySchema.safeParse({}).success).toBe(false)
    expect(updateConnectorAccessBodySchema.safeParse({ credentialId: 'cred-1' }).success).toBe(
      false
    )
  })

  it('leaves source-specific credential requirements to the authorized operation', () => {
    const parsed = updateConnectorAccessBodySchema.safeParse({ accessMode: 'workspace' })
    expect(parsed.success).toBe(true)
    expect(
      updateConnectorAccessBodySchema.parse({ accessMode: 'members', credentialId: null })
    ).toMatchObject({ accessMode: 'members', credentialId: null })
  })
})
