/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/credential-groups/enrollments', () => ({
  createCredentialGroupInvitationLink: vi.fn(),
  inviteCredentialGroupEnrollment: vi.fn(),
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  isKnowledgeMemberAccessAvailable: vi.fn(),
}))
vi.mock('@/lib/knowledge/connectors/member-queue', () => ({ dispatchMemberSync: vi.fn() }))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveSystemBillingAttribution: vi.fn(),
}))
vi.mock('@/lib/credential-groups/service', () => ({
  createCredentialGroup: vi.fn(),
  listCredentialGroups: vi.fn(),
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({ getUsersWithPermissions: vi.fn() }))

import {
  deriveViewerConnectorMembership,
  pickProvisionedGroupName,
} from '@/lib/knowledge/connectors/member-provisioning'

describe('pickProvisionedGroupName', () => {
  it('names the group after the connector and steps past taken names', () => {
    expect(pickProvisionedGroupName('Google Drive', [])).toBe('Google Drive')
    expect(pickProvisionedGroupName('Google Drive', ['google drive'])).toBe('Google Drive 2')
    expect(pickProvisionedGroupName('Google Drive', ['Google Drive', 'Google Drive 2'])).toBe(
      'Google Drive 3'
    )
  })

  it('gives up with a pointer to Settings once every candidate is taken', () => {
    const taken = [
      'Google Drive',
      'Google Drive 2',
      'Google Drive 3',
      'Google Drive 4',
      'Google Drive 5',
    ]
    expect(() => pickProvisionedGroupName('Google Drive', taken)).toThrow('Settings')
  })
})

describe('deriveViewerConnectorMembership', () => {
  it.each([
    [true, 'active', 'completed', 'connected'],
    [true, 'active', 'in_progress', 'connected'],
    [true, 'needs_reauth', 'completed', 'needs_reauth'],
    [true, null, 'invited', 'invited'],
    [true, null, 'delivery_failed', 'invited'],
    [true, null, 'in_progress', 'invited'],
    [true, null, 'completed', 'invited'],
    [true, 'revoked', 'completed', 'invited'],
    [true, 'active', 'revoked', 'revoked'],
    [true, null, 'revoked', 'revoked'],
    [true, null, null, 'not_enrolled'],
    [false, 'active', 'completed', 'unverified_email'],
  ] as const)(
    'verified %s + credential %s + enrollment %s → %s',
    (emailVerified, managedOauthStatus, enrollmentStatus, expected) => {
      expect(
        deriveViewerConnectorMembership({ emailVerified, managedOauthStatus, enrollmentStatus })
      ).toBe(expected)
    }
  )
})
