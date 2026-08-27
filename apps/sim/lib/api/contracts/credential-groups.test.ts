import { describe, expect, it } from 'vitest'
import {
  createCredentialGroupBodySchema,
  credentialGroupEnrollmentDetailSchema,
  credentialGroupEnrollmentListQuerySchema,
  credentialGroupSchema,
  inviteCredentialGroupEnrollmentsBodySchema,
  sharedCredentialGroupOAuthCallbackContract,
  updateCredentialGroupBodySchema,
} from '@/lib/api/contracts/credential-groups'

describe('credential group contracts', () => {
  it('describes the shared managed OAuth callback as a redirect', () => {
    expect(sharedCredentialGroupOAuthCallbackContract.response).toEqual({ mode: 'redirect' })
  })

  it('accepts a group before account types are added', () => {
    const parsed = createCredentialGroupBodySchema.parse({
      name: 'Support team',
      options: [],
    })

    expect(parsed.options).toEqual([])
  })

  it('accepts one option per provider after the group exists', () => {
    const parsed = updateCredentialGroupBodySchema.parse({
      options: [
        { provider: 'gmail', label: 'Gmail', required: true },
        { provider: 'google-calendar', label: 'Google Calendar', required: true },
        {
          provider: 'slack',
          label: 'Slack',
          required: true,
          slackBotCredentialId: '11111111-1111-4111-8111-111111111111',
        },
      ],
    })

    expect(parsed.options).toHaveLength(3)
  })

  it('rejects the removed multiple-account option', () => {
    const result = createCredentialGroupBodySchema.safeParse({
      name: 'Support team',
      options: [
        {
          provider: 'gmail',
          label: 'Primary inbox',
          required: true,
          allowMultiple: true,
        },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('rejects duplicate option labels case-insensitively', () => {
    const result = createCredentialGroupBodySchema.safeParse({
      name: 'Support team',
      options: [
        {
          provider: 'gmail',
          label: 'Inbox',
          required: true,
        },
        {
          provider: 'gmail',
          label: 'inbox',
          required: true,
        },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('rejects duplicate providers', () => {
    const result = createCredentialGroupBodySchema.safeParse({
      name: 'Support team',
      options: [
        { provider: 'gmail', label: 'Primary inbox', required: true },
        { provider: 'gmail', label: 'Escalations', required: true },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('requires a custom bot for Slack option updates', () => {
    const missingApp = updateCredentialGroupBodySchema.safeParse({
      options: [
        {
          provider: 'slack',
          label: 'Slack',
          required: true,
        },
      ],
    })
    const withApp = updateCredentialGroupBodySchema.safeParse({
      options: [
        {
          provider: 'slack',
          label: 'Slack',
          required: true,
          slackBotCredentialId: '11111111-1111-4111-8111-111111111111',
        },
      ],
    })

    expect(missingApp.success).toBe(false)
    expect(withApp.success).toBe(true)
  })

  it('rejects duplicate option IDs on update', () => {
    const option = {
      id: 'option-1',
      provider: 'gmail' as const,
      required: true,
    }
    const result = updateCredentialGroupBodySchema.safeParse({
      options: [
        { ...option, label: 'Inbox' },
        { ...option, label: 'Escalations' },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('rejects the authorization-app identity from settings responses', () => {
    const result = credentialGroupSchema.safeParse({
      id: 'group-1',
      workspaceId: 'workspace-1',
      name: 'Support team',
      description: null,
      options: [
        {
          id: 'option-1',
          provider: 'gmail',
          label: 'Inbox',
          required: true,
          status: 'active',
          authorizationAppId: 'server-only',
        },
      ],
      status: 'active',
      createdAt: '2026-08-10T12:00:00.000Z',
      updatedAt: '2026-08-10T12:00:00.000Z',
    })

    expect(result.success).toBe(false)
  })

  it('accepts a batch of invitation emails', () => {
    const result = inviteCredentialGroupEnrollmentsBodySchema.parse({
      emails: ['alex@example.com', 'sam@example.com'],
    })

    expect(result.emails).toEqual(['alex@example.com', 'sam@example.com'])
  })

  it('rejects invitation batches larger than 100 recipients', () => {
    const result = inviteCredentialGroupEnrollmentsBodySchema.safeParse({
      emails: Array.from({ length: 101 }, (_, index) => `user-${index}@example.com`),
    })

    expect(result.success).toBe(false)
  })

  it('rejects invalid invitation email addresses', () => {
    const result = inviteCredentialGroupEnrollmentsBodySchema.safeParse({
      emails: ['not-an-email'],
    })

    expect(result.success).toBe(false)
  })

  it('bounds enrollment pages and defaults them to 50 rows', () => {
    expect(credentialGroupEnrollmentListQuerySchema.parse({})).toEqual({ limit: 50 })
    expect(credentialGroupEnrollmentListQuerySchema.safeParse({ limit: 101 }).success).toBe(false)
  })

  it('accepts aggregated provider connections on an enrollment', () => {
    const result = credentialGroupEnrollmentDetailSchema.parse({
      id: 'enrollment-1',
      credentialGroupId: 'group-1',
      email: 'alex@example.com',
      status: 'completed',
      expiresAt: '2026-08-18T12:00:00.000Z',
      invitedAt: '2026-08-11T12:00:00.000Z',
      sentAt: '2026-08-11T12:00:01.000Z',
      completedAt: '2026-08-11T12:05:00.000Z',
      revokedAt: null,
      expired: false,
      createdAt: '2026-08-11T12:00:00.000Z',
      updatedAt: '2026-08-11T12:05:00.000Z',
      connections: [{ provider: 'gmail', status: 'active', count: 2 }],
    })

    expect(result.connections).toEqual([{ provider: 'gmail', status: 'active', count: 2 }])
  })
})
