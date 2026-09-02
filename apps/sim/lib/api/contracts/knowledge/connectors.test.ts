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

  it('lets members mode omit the binding, refuses half a binding, and refuses a credential there', () => {
    /** No binding named: the server provisions a credential group for the connector. */
    expect(createConnectorBodySchema.safeParse({ ...base, accessMode: 'members' }).success).toBe(
      true
    )
    expect(
      createConnectorBodySchema.safeParse({
        ...base,
        accessMode: 'members',
        credentialGroupId: 'group-1',
      }).success
    ).toBe(false)
    expect(
      createConnectorBodySchema.safeParse({
        ...base,
        accessMode: 'members',
        credentialGroupId: 'group-1',
        credentialGroupOptionId: 'option-1',
        credentialId: 'cred-1',
      }).success
    ).toBe(false)
    expect(
      createConnectorBodySchema.safeParse({
        ...base,
        accessMode: 'members',
        credentialGroupId: 'group-1',
        credentialGroupOptionId: 'option-1',
      }).success
    ).toBe(true)
  })

  it('refuses a group binding on a workspace-mode connector', () => {
    expect(
      createConnectorBodySchema.safeParse({
        ...base,
        credentialId: 'cred-1',
        credentialGroupId: 'group-1',
      }).success
    ).toBe(false)
  })

  it('applies the same rules to a mode switch', () => {
    expect(
      updateConnectorAccessBodySchema.safeParse({
        accessMode: 'members',
        credentialGroupId: 'group-1',
        credentialGroupOptionId: 'option-1',
      }).success
    ).toBe(true)
    expect(
      updateConnectorAccessBodySchema.safeParse({
        accessMode: 'workspace',
        credentialId: 'cred-1',
      }).success
    ).toBe(true)
    expect(
      updateConnectorAccessBodySchema.safeParse({
        accessMode: 'workspace',
        credentialGroupOptionId: 'option-1',
      }).success
    ).toBe(false)
    expect(
      updateConnectorAccessBodySchema.safeParse({
        accessMode: 'members',
        credentialGroupId: 'group-1',
        credentialGroupOptionId: 'option-1',
        credentialId: 'cred-1',
      }).success
    ).toBe(false)
  })
})
