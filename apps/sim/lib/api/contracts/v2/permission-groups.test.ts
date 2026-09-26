import { describe, expect, it } from 'vitest'
import {
  v2BulkAddPermissionGroupMembersBodySchema,
  v2CreatePermissionGroupBodySchema,
  v2UpdatePermissionGroupBodySchema,
} from '@/lib/api/contracts/v2/permission-groups'

describe('public permission group boundaries', () => {
  it.each([
    {},
    { userIds: [] },
    { addAllOrganizationMembers: false },
    { userIds: ['user-1'], addAllOrganizationMembers: true },
  ])('rejects an ambiguous or empty bulk selection: %j', (body) => {
    expect(v2BulkAddPermissionGroupMembersBodySchema.safeParse(body).success).toBe(false)
  })

  it('bounds explicit bulk membership input before any work starts', () => {
    expect(
      v2BulkAddPermissionGroupMembersBodySchema.safeParse({
        userIds: Array.from({ length: 1001 }, (_, index) => `user-${index}`),
      }).success
    ).toBe(false)
  })

  it('requires workspace scope for a new non-default group', () => {
    expect(v2CreatePermissionGroupBodySchema.safeParse({ name: 'Restricted' }).success).toBe(false)
    expect(
      v2CreatePermissionGroupBodySchema.safeParse({
        name: 'Restricted',
        workspaceIds: ['workspace-1'],
      }).success
    ).toBe(true)
  })

  it('rejects explicit workspace targets on a default group', () => {
    expect(
      v2CreatePermissionGroupBodySchema.safeParse({
        name: 'Default',
        isDefault: true,
        workspaceIds: ['workspace-1'],
      }).success
    ).toBe(false)
    expect(
      v2CreatePermissionGroupBodySchema.safeParse({ name: 'Default', isDefault: true }).success
    ).toBe(true)
  })

  it('preserves the difference between unrestricted and empty allowlists', () => {
    expect(
      v2UpdatePermissionGroupBodySchema.parse({ config: { allowedIntegrations: null } }).config
        ?.allowedIntegrations
    ).toBeNull()
    expect(
      v2UpdatePermissionGroupBodySchema.parse({ config: { allowedIntegrations: [] } }).config
        ?.allowedIntegrations
    ).toEqual([])
  })
})
