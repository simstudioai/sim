/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createPermissionGroupBodySchema,
  permissionGroupFullConfigSchema,
  updatePermissionGroupBodySchema,
} from '@/lib/api/contracts/permission-groups'
import {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  parsePermissionGroupConfig,
} from '@/lib/permission-groups/types'

describe('createPermissionGroupBodySchema', () => {
  it('accepts a name-only body (scope is resolved and validated server-side)', () => {
    const result = createPermissionGroupBodySchema.safeParse({ name: 'Engineering' })
    expect(result.success).toBe(true)
  })

  it('accepts a default group', () => {
    const result = createPermissionGroupBodySchema.safeParse({
      name: 'Baseline',
      isDefault: true,
    })
    expect(result.success).toBe(true)
  })

  it('accepts a specific-scope group with workspaces', () => {
    const result = createPermissionGroupBodySchema.safeParse({
      name: 'Contractors',
      workspaceIds: ['ws-1'],
    })
    expect(result.success).toBe(true)
  })

  it('accepts a name + empty workspaces (the create route enforces at least one)', () => {
    const result = createPermissionGroupBodySchema.safeParse({
      name: 'Contractors',
      workspaceIds: [],
    })
    expect(result.success).toBe(true)
  })

  it('rejects a default group that targets specific workspaces', () => {
    const result = createPermissionGroupBodySchema.safeParse({
      name: 'Baseline',
      isDefault: true,
      workspaceIds: ['ws-1'],
    })
    expect(result.success).toBe(false)
  })
})

describe('updatePermissionGroupBodySchema', () => {
  it('accepts an empty update', () => {
    expect(updatePermissionGroupBodySchema.safeParse({}).success).toBe(true)
  })

  it('accepts demoting the default via isDefault:false alone (the route re-scopes it)', () => {
    expect(updatePermissionGroupBodySchema.safeParse({ isDefault: false }).success).toBe(true)
  })

  it('accepts emptying scope (group then governs nothing)', () => {
    const result = updatePermissionGroupBodySchema.safeParse({ workspaceIds: [] })
    expect(result.success).toBe(true)
  })

  it('accepts a specific scope with workspaces', () => {
    const result = updatePermissionGroupBodySchema.safeParse({
      workspaceIds: ['ws-1', 'ws-2'],
    })
    expect(result.success).toBe(true)
  })

  it('accepts promoting a group to the default', () => {
    expect(updatePermissionGroupBodySchema.safeParse({ isDefault: true }).success).toBe(true)
  })

  it('rejects promoting to the default while naming workspaces', () => {
    const result = updatePermissionGroupBodySchema.safeParse({
      isDefault: true,
      workspaceIds: ['ws-1'],
    })
    expect(result.success).toBe(false)
  })
})

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
  it('matches parsePermissionGroupConfig so a saved config compares equal', () => {
    const stored = parsePermissionGroupConfig({
      allowedIntegrations: ['slack'],
      hideCopilot: true,
    })
    const overWire = permissionGroupFullConfigSchema.parse(structuredClone(stored))
    expect(JSON.stringify(overWire)).toBe(JSON.stringify(stored))
  })

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
