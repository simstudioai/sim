/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/credential-groups/enrollments', () => ({
  createCredentialGroupInvitationLink: vi.fn(),
  inviteCredentialGroupEnrollment: vi.fn(),
  loadCredentialGroupInviterIdentity: vi.fn(),
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
    expect(pickProvisionedGroupName('Google Drive', [])).toBe('Google Drive access')
    expect(pickProvisionedGroupName('Google Drive', ['google drive access'])).toBe(
      'Google Drive access 2'
    )
    expect(
      pickProvisionedGroupName('Google Drive', ['Google Drive access', 'Google Drive access 2'])
    ).toBe('Google Drive access 3')
  })

  it('gives up with a pointer to Settings once every candidate is taken', () => {
    const taken = [
      'Google Drive access',
      'Google Drive access 2',
      'Google Drive access 3',
      'Google Drive access 4',
      'Google Drive access 5',
    ]
    expect(() => pickProvisionedGroupName('Google Drive', taken)).toThrow('Settings')
  })
})

describe('deriveViewerConnectorMembership', () => {
  it.each([
    ['active', 'completed', 'connected'],
    ['active', 'in_progress', 'connected'],
    ['needs_reauth', 'completed', 'needs_reauth'],
    [null, 'invited', 'invited'],
    [null, 'delivery_failed', 'invited'],
    [null, 'in_progress', 'invited'],
    [null, 'completed', 'invited'],
    ['revoked', 'completed', 'invited'],
    [null, 'revoked', 'not_enrolled'],
    [null, null, 'not_enrolled'],
  ] as const)(
    'credential %s + enrollment %s → %s',
    (managedOauthStatus, enrollmentStatus, expected) => {
      expect(deriveViewerConnectorMembership({ managedOauthStatus, enrollmentStatus })).toBe(
        expected
      )
    }
  )
})
