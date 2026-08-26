/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { principalAuditSource } from '@/lib/core/application/audit-source'

describe('principalAuditSource', () => {
  it('names the delegated service rather than the kind', () => {
    expect(
      principalAuditSource({
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'user-1',
        workspaceId: 'workspace-1',
        delegationId: 'tool-call-1',
        audience: 'sim:workflows',
        issuedAt: new Date(),
        expiresAt: new Date(),
      })
    ).toBe('copilot')
  })

  it.each([
    [{ kind: 'session', userId: 'user-1', sessionId: 'session-1' }, 'session'],
    [{ kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' }, 'personal_api_key'],
    [
      { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-1' },
      'workspace_api_key',
    ],
  ] as const)('names the credential class for %#', (principal, expected) => {
    expect(principalAuditSource(principal)).toBe(expected)
  })
})
