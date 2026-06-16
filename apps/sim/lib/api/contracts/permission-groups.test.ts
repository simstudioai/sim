/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createPermissionGroupBodySchema,
  updatePermissionGroupBodySchema,
} from '@/lib/api/contracts/permission-groups'

describe('createPermissionGroupBodySchema', () => {
  it('accepts a group that defaults to all workspaces', () => {
    const result = createPermissionGroupBodySchema.safeParse({ name: 'Engineering' })
    expect(result.success).toBe(true)
  })

  it('accepts a specific-scope group with at least one workspace', () => {
    const result = createPermissionGroupBodySchema.safeParse({
      name: 'Contractors',
      appliesToAllWorkspaces: false,
      workspaceIds: ['ws-1'],
    })
    expect(result.success).toBe(true)
  })

  it('rejects a specific-scope group with no workspaces', () => {
    const result = createPermissionGroupBodySchema.safeParse({
      name: 'Contractors',
      appliesToAllWorkspaces: false,
      workspaceIds: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a specific-scope group that omits workspaceIds', () => {
    const result = createPermissionGroupBodySchema.safeParse({
      name: 'Contractors',
      appliesToAllWorkspaces: false,
    })
    expect(result.success).toBe(false)
  })

  it('rejects a default group that targets specific workspaces', () => {
    const result = createPermissionGroupBodySchema.safeParse({
      name: 'Baseline',
      isDefault: true,
      appliesToAllWorkspaces: false,
      workspaceIds: ['ws-1'],
    })
    expect(result.success).toBe(false)
  })

  it('accepts a default group that applies to all workspaces', () => {
    const result = createPermissionGroupBodySchema.safeParse({
      name: 'Baseline',
      isDefault: true,
      appliesToAllWorkspaces: true,
    })
    expect(result.success).toBe(true)
  })

  it('rejects a default group with workspaceIds (appliesToAllWorkspaces omitted)', () => {
    const result = createPermissionGroupBodySchema.safeParse({
      name: 'Baseline',
      isDefault: true,
      workspaceIds: ['ws-1'],
    })
    expect(result.success).toBe(false)
  })

  it('rejects an all-workspaces group that also names specific workspaces', () => {
    const result = createPermissionGroupBodySchema.safeParse({
      name: 'Engineering',
      appliesToAllWorkspaces: true,
      workspaceIds: ['ws-1'],
    })
    expect(result.success).toBe(false)
  })
})

describe('updatePermissionGroupBodySchema', () => {
  it('accepts an empty update', () => {
    expect(updatePermissionGroupBodySchema.safeParse({}).success).toBe(true)
  })

  it('rejects switching to specific scope with no workspaces', () => {
    const result = updatePermissionGroupBodySchema.safeParse({
      appliesToAllWorkspaces: false,
      workspaceIds: [],
    })
    expect(result.success).toBe(false)
  })

  it('accepts switching to specific scope with workspaces', () => {
    const result = updatePermissionGroupBodySchema.safeParse({
      appliesToAllWorkspaces: false,
      workspaceIds: ['ws-1', 'ws-2'],
    })
    expect(result.success).toBe(true)
  })

  it('rejects making a specific-scope group the default', () => {
    const result = updatePermissionGroupBodySchema.safeParse({
      isDefault: true,
      appliesToAllWorkspaces: false,
      workspaceIds: ['ws-1'],
    })
    expect(result.success).toBe(false)
  })

  it('rejects workspaceIds when making the group the default', () => {
    const result = updatePermissionGroupBodySchema.safeParse({
      isDefault: true,
      workspaceIds: ['ws-1'],
    })
    expect(result.success).toBe(false)
  })

  it('rejects workspaceIds on an all-workspaces update', () => {
    const result = updatePermissionGroupBodySchema.safeParse({
      appliesToAllWorkspaces: true,
      workspaceIds: ['ws-1'],
    })
    expect(result.success).toBe(false)
  })
})
