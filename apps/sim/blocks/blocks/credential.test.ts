/** @vitest-environment node */
import { createBlock } from '@sim/testing'
import { expect, it, vi } from 'vitest'

vi.mock('@/triggers', () => ({ getTrigger: () => ({ subBlocks: [] }) }))

import { CredentialBlock } from '@/blocks/blocks/credential'
import { collectBlockFieldIssues } from '@/serializer/index'

it.each(['list_organization_accounts', 'list_organization_mcp_connections'])(
  'allows %s through workflow validation without an email',
  (operation) => {
    const params = { operation, organizationProviders: ['google-email'], mcpProvider: 'fireflies' }
    const block = createBlock({
      type: 'credential',
      subBlocks: {
        operation: { id: 'operation', type: 'dropdown', value: operation },
        organizationProviders: {
          id: 'organizationProviders',
          type: 'dropdown',
          value: ['google-email'],
        },
        mcpProvider: { id: 'mcpProvider', type: 'dropdown', value: 'fireflies' },
      },
    })
    expect(collectBlockFieldIssues(block, CredentialBlock, params).missingRequiredFields).toEqual(
      []
    )
  }
)

it('continues to require the enrollment email when finding one organization account', () => {
  const block = createBlock({
    type: 'credential',
    subBlocks: {
      operation: { id: 'operation', type: 'dropdown', value: 'find_organization_account' },
      organizationProvider: { id: 'organizationProvider', type: 'dropdown', value: 'google-email' },
    },
  })
  const params = { operation: 'find_organization_account', organizationProvider: 'google-email' }
  expect(collectBlockFieldIssues(block, CredentialBlock, params).missingRequiredFields).toEqual([
    'Email',
  ])
})
