/**
 * @vitest-environment node
 */
import { dbChainMockFns, hasMockCondition, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/credential-groups/providers', () => ({
  isCredentialGroupProvider: (provider: string) => provider === 'slack',
  getCredentialGroupProviderId: () => 'slack',
}))

import {
  listCredentialGroupCredentialReferences,
  loadCredentialGroupEnrollmentAccessForSubject,
} from '@/lib/credential-groups/credentials'

describe('listCredentialGroupCredentialReferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns the invited email associated with each managed credential', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'credential-1',
        email: 'person@example.com',
        displayName: 'Personal Gmail',
        providerId: 'google-email',
        providerSubjectId: 'google-subject-1',
        providerTenantId: null,
        createdAt: new Date('2026-08-12T12:00:00.000Z'),
      },
    ])

    const result = await listCredentialGroupCredentialReferences({
      workspaceId: 'workspace-1',
      credentialGroupId: 'group-1',
      credentialGroupOptionIds: ['option-1'],
      limit: 50,
    })

    expect(result).toEqual({
      credentials: [
        {
          credentialId: 'credential-1',
          email: 'person@example.com',
          displayName: 'Personal Gmail',
          providerId: 'google-email',
          providerSubjectId: 'google-subject-1',
          providerTenantId: null,
        },
      ],
      nextCursor: null,
    })
  })

  it('filters credential references by normalized enrollment email', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await listCredentialGroupCredentialReferences({
      workspaceId: 'workspace-1',
      credentialGroupId: 'group-1',
      credentialGroupOptionIds: ['option-1'],
      email: 'person@example.com',
      limit: 50,
    })

    const where = dbChainMockFns.where.mock.calls.at(-1)?.[0]
    expect(
      hasMockCondition(
        where,
        (condition) => condition.type === 'eq' && condition.right === 'person@example.com'
      )
    ).toBe(true)
  })

  it('resolves a Slack subject by stable tenant and user identifiers', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { enrollmentId: 'enrollment-1', email: 'person@example.com' },
    ])

    await expect(
      loadCredentialGroupEnrollmentAccessForSubject('group-1', {
        kind: 'external_user',
        provider: 'slack',
        tenantId: 'T123',
        subjectId: 'U123',
      })
    ).resolves.toEqual({ enrollmentId: 'enrollment-1', email: 'person@example.com' })
  })

  it('does not treat a chat-authenticated email as Credential Group enrollment access', async () => {
    await expect(
      loadCredentialGroupEnrollmentAccessForSubject('group-1', {
        kind: 'authenticated_email',
        email: 'person@example.com',
      })
    ).resolves.toBeNull()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('fails fast when one external subject resolves to multiple enrollments', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { enrollmentId: 'enrollment-1', email: 'first@example.com' },
      { enrollmentId: 'enrollment-2', email: 'second@example.com' },
    ])

    await expect(
      loadCredentialGroupEnrollmentAccessForSubject('group-1', {
        kind: 'external_user',
        provider: 'slack',
        tenantId: 'T123',
        subjectId: 'U123',
      })
    ).rejects.toThrow('multiple Credential Group enrollments')
  })
})
