/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseResourcePolicyDocument } from '@/lib/resource-policies/types'

describe('resource policy documents', () => {
  it('accepts exact allow-only grants', () => {
    const document = {
      version: 1 as const,
      resource: { type: 'credential_group' as const, id: 'group-1' },
      grants: [
        {
          id: 'grant-1',
          subject: { type: 'workflow' as const, workflowId: 'workflow-1' },
          actions: ['credential_groups.credentials.use' as const],
        },
      ],
    }

    expect(
      parseResourcePolicyDocument(document, { type: 'credential_group', id: 'group-1' })
    ).toEqual(document)
  })

  it('rejects unknown fields, duplicate subjects, and wrong resource bindings', () => {
    expect(() =>
      parseResourcePolicyDocument(
        {
          version: 1,
          resource: { type: 'credential_group', id: 'group-1' },
          grants: [],
          effect: 'allow',
        },
        { type: 'credential_group', id: 'group-1' }
      )
    ).toThrow()

    expect(() =>
      parseResourcePolicyDocument(
        {
          version: 1,
          resource: { type: 'credential_group', id: 'group-1' },
          grants: [
            {
              id: 'grant-1',
              subject: { type: 'workflow', workflowId: 'workflow-1' },
              actions: ['credential_groups.credentials.use'],
            },
            {
              id: 'grant-2',
              subject: { type: 'workflow', workflowId: 'workflow-1' },
              actions: ['credential_groups.credentials.use'],
            },
          ],
        },
        { type: 'credential_group', id: 'group-1' }
      )
    ).toThrow('subject can only appear once')

    expect(() =>
      parseResourcePolicyDocument(
        {
          version: 1,
          resource: { type: 'credential_group', id: 'group-2' },
          grants: [],
        },
        { type: 'credential_group', id: 'group-1' }
      )
    ).toThrow('does not match')
  })
})
