/** @vitest-environment node */
import { createBlock } from '@sim/testing'
import { expect, it, vi } from 'vitest'

vi.mock('@/triggers', () => ({ getTrigger: () => ({ subBlocks: [] }) }))

import { CredentialBlock } from '@/blocks/blocks/credential'
import { collectBlockFieldIssues } from '@/serializer/index'

it.each([
  'list_organization_accounts',
  'list_organization_mcp_connections',
  'list_credential_group_api_keys',
])('allows %s through workflow validation without an email', (operation) => {
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
  expect(collectBlockFieldIssues(block, CredentialBlock, params).missingRequiredFields).toEqual([])
})

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

it('requires an explicit key credential reference when retrieving a key', () => {
  const params = { operation: 'get_credential_group_api_key' }
  const block = createBlock({
    type: 'credential',
    subBlocks: { operation: { id: 'operation', type: 'dropdown', value: params.operation } },
  })
  expect(collectBlockFieldIssues(block, CredentialBlock, params).missingRequiredFields).toEqual([
    'API Key Credential ID',
  ])
  expect(
    collectBlockFieldIssues(block, CredentialBlock, {
      ...params,
      apiKeyCredentialId: '<ListKeys.apiKeys[0].credentialId>',
    }).missingRequiredFields
  ).toEqual([])
  const emailInput = CredentialBlock.subBlocks.find((field) => field.id === 'email')!
  expect(emailInput.condition).toMatchObject({ field: 'operation' })
  expect(emailInput.condition).toHaveProperty(
    'value',
    expect.not.arrayContaining([params.operation])
  )
  expect(CredentialBlock.outputs.email.condition).toMatchObject({
    field: 'operation',
    value: expect.arrayContaining([params.operation]),
  })
})
