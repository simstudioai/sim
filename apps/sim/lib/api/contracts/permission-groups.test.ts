import { describe, expect, it } from 'vitest'
import { permissionGroupFullConfigSchema } from '@/lib/api/contracts/permission-groups'
import {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  parsePermissionGroupConfig,
} from '@/lib/permission-groups/fields'

/**
 * The access-control group detail view decides whether its config buffer is
 * dirty by comparing `JSON.stringify(savedConfig)` against
 * `JSON.stringify(editingConfig)`, and reconciles the saved baseline from the
 * update response. That only works while every config that reaches the client —
 * from the list route and from the update route alike — carries the same key
 * order, which holds because both pass through `parsePermissionGroupConfig` and
 * then `permissionGroupFullConfigSchema`. If the two ever drift, the detail view
 * would report unsaved changes forever after a successful save.
 */
describe('permissionGroupFullConfigSchema key order', () => {
  it('keeps an edited client buffer comparable to the server echo', () => {
    const fromList = permissionGroupFullConfigSchema.parse(
      structuredClone(parsePermissionGroupConfig(DEFAULT_PERMISSION_GROUP_CONFIG))
    )
    const edited = { ...fromList, hideDeployChatbot: true, deniedTools: ['slack_canvas'] }
    const serverEcho = permissionGroupFullConfigSchema.parse(
      structuredClone(parsePermissionGroupConfig(edited))
    )
    expect(JSON.stringify(serverEcho)).toBe(JSON.stringify(edited))
  })
})
