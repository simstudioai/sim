/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { workspaceHostContextSchema } from '@/lib/api/contracts/workspaces'

const viewerSchema = workspaceHostContextSchema.shape.viewer
const viewer = {
  permission: 'read' as const,
  isHostOrganizationMember: false,
  isHostOrganizationAdmin: false,
}

describe('workspaceHostContextSchema organizationRole', () => {
  it.each(['owner', 'admin', 'member'] as const)(
    'accepts canonical role %s',
    (organizationRole) => {
      expect(viewerSchema.safeParse({ ...viewer, organizationRole }).success).toBe(true)
    }
  )

  it('retains null and omission for rolling response compatibility', () => {
    expect(viewerSchema.safeParse({ ...viewer, organizationRole: null }).success).toBe(true)
    expect(viewerSchema.safeParse(viewer).success).toBe(true)
  })

  it('rejects non-canonical organization roles', () => {
    expect(viewerSchema.safeParse({ ...viewer, organizationRole: 'billing-owner' }).success).toBe(
      false
    )
  })
})
