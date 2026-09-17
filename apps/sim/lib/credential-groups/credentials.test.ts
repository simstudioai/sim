/**
 * @vitest-environment node
 */

import { credential, credentialGroupEnrollment } from '@sim/db/schema'
import { dbChainMockFns, hasMockCondition, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/credential-groups/providers', () => ({
  isCredentialGroupProvider: (provider: string) => provider === 'slack',
  getCredentialGroupProviderId: () => 'slack',
}))

import {
  CredentialGroupCredentialCursorNotFoundError,
  listCredentialGroupCredentialReferences,
  loadCredentialGroupEnrollmentAccessForSubject,
} from '@/lib/credential-groups/credentials'

describe('listCredentialGroupCredentialReferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('keeps the enrollment email separate from the verified provider account email', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'credential-1',
        email: 'person@example.com',
        accountEmail: 'personal@example.com',
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
          accountEmail: 'personal@example.com',
          displayName: 'Personal Gmail',
          providerId: 'google-email',
          providerSubjectId: 'google-subject-1',
          providerTenantId: null,
        },
      ],
      nextCursor: null,
    })
  })

  it('lists every provider account across pages without an email filter or secret projection', async () => {
    const row = (id: string, accountEmail: string) => ({
      id,
      email: 'person@example.com',
      accountEmail,
      displayName: accountEmail,
      providerId: 'google-email',
      providerSubjectId: `subject-${id}`,
      providerTenantId: null,
      createdAt: new Date('2026-08-12T12:00:00.000Z'),
    })
    const rows = [
      row('first', 'one@example.com'),
      row('second', 'two@example.com'),
      row('third', 'three@example.com'),
    ]
    dbChainMockFns.limit.mockResolvedValueOnce(rows)
    const input = {
      organizationId: 'organization-1',
      credentialGroupId: 'group-1',
      credentialGroupOptionIds: ['gmail-option'],
      credentialProviderIds: ['google-email'],
      limit: 2,
    }
    const first = await listCredentialGroupCredentialReferences(input)
    expect(first.nextCursor).toBe('second')
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'second' }]).mockResolvedValueOnce([rows[2]])
    const second = await listCredentialGroupCredentialReferences({
      ...input,
      cursor: first.nextCursor!,
    })
    expect(second.nextCursor).toBeNull()
    expect(
      [...first.credentials, ...second.credentials].map((account) => account.accountEmail)
    ).toEqual(['one@example.com', 'two@example.com', 'three@example.com'])
    expect(dbChainMockFns.limit.mock.calls.map(([limit]) => limit)).toEqual([3, 1, 3])

    for (const [where] of dbChainMockFns.where.mock.calls) {
      for (const [column, value] of [
        [credential.organizationId, 'organization-1'],
        [credentialGroupEnrollment.credentialGroupId, 'group-1'],
        [credential.managedOauthStatus, 'active'],
        [credential.createdBy, credentialGroupEnrollment.userId],
      ]) {
        expect(
          hasMockCondition(
            where,
            (condition) =>
              condition.type === 'eq' && condition.left === column && condition.right === value
          )
        ).toBe(true)
      }
      expect(
        hasMockCondition(
          where,
          (condition) =>
            condition.type === 'inArray' &&
            condition.column === credential.credentialGroupOptionId &&
            JSON.stringify(condition.values) === '["gmail-option"]'
        )
      ).toBe(true)
      expect(
        hasMockCondition(
          where,
          (condition) =>
            condition.type === 'eq' && condition.left === credentialGroupEnrollment.email
        )
      ).toBe(false)
    }
    expect(Object.keys(dbChainMockFns.select.mock.calls[0]![0])).toEqual([
      'id',
      'email',
      'accountEmail',
      'displayName',
      'providerId',
      'providerSubjectId',
      'providerTenantId',
      'managedOauthStatus',
      'enrollmentStatus',
      'createdAt',
    ])
  })

  it.each([null, '', 'not-an-email'])(
    'fails fast when the provider account email is invalid: %s',
    async (accountEmail) => {
      dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'credential-1', accountEmail }])
      await expect(
        listCredentialGroupCredentialReferences({
          organizationId: 'organization-1',
          credentialGroupId: 'group-1',
          credentialGroupOptionIds: ['gmail-option'],
          limit: 50,
        })
      ).rejects.toThrow('no valid provider account email')
    }
  )

  it('rejects a cursor outside the current provider and organization scope before reading a page', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    await expect(
      listCredentialGroupCredentialReferences({
        organizationId: 'organization-1',
        credentialGroupId: 'group-1',
        credentialGroupOptionIds: ['gmail-option'],
        credentialProviderIds: ['google-email'],
        cursor: 'foreign-credential',
        limit: 2,
      })
    ).rejects.toBeInstanceOf(CredentialGroupCredentialCursorNotFoundError)
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
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
