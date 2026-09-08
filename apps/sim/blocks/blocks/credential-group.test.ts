/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/triggers', () => ({ getTrigger: () => ({ subBlocks: [] }) }))

import { CredentialGroupBlock } from '@/blocks/blocks/credential-group'

describe('Connected Accounts block', () => {
  it('uses the workspace container without selectable or manual group inputs', () => {
    expect(CredentialGroupBlock.name).toBe('Connected Accounts (Legacy)')
    expect(CredentialGroupBlock.hideFromToolbar).toBe(true)
    const operation = CredentialGroupBlock.subBlocks.find((field) => field.id === 'operation')
    expect(operation?.options).toEqual([
      { label: 'List Credentials', id: 'list_credentials' },
      { label: 'List MCP Connections', id: 'list_mcp_connections' },
      { label: 'Send Invite', id: 'send_invite' },
      { label: 'Get Invite Link', id: 'get_invite_link' },
      { label: 'List People', id: 'list_people' },
    ])
    expect(CredentialGroupBlock.inputs).not.toHaveProperty('credentialGroupId')
    expect(CredentialGroupBlock.outputs).not.toHaveProperty('credentialGroups')
    expect(
      CredentialGroupBlock.subBlocks.some((field) => field.canonicalParamId === 'credentialGroupId')
    ).toBe(false)
    expect(
      CredentialGroupBlock.subBlocks.find((field) => field.id === 'providerFilter')?.dependsOn
    ).toBeUndefined()
  })
})
