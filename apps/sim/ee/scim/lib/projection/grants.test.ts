/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type MappingRow,
  type ProjectionGrant,
  planGrantChanges,
  resolveDesiredGrants,
} from '@/ee/scim/lib/projection/grants'

function workspaceRow(workspaceId: string, permissionType: 'admin' | 'write' | 'read'): MappingRow {
  return {
    targetKind: 'workspace',
    workspaceId,
    permissionType,
    permissionGroupId: null,
    role: null,
  }
}

describe('resolveDesiredGrants', () => {
  it('keeps the stronger level when two groups grant the same workspace', () => {
    const desired = resolveDesiredGrants([
      workspaceRow('ws-1', 'read'),
      workspaceRow('ws-1', 'admin'),
    ])
    expect(desired).toEqual([
      { targetKind: 'workspace', targetId: 'ws-1', permissionType: 'admin' },
    ])
  })

  it('does not lower a level a later row asks for less of', () => {
    const desired = resolveDesiredGrants([
      workspaceRow('ws-1', 'write'),
      workspaceRow('ws-1', 'read'),
    ])
    expect(desired[0].permissionType).toBe('write')
  })

  it('emits one grant per permission group and per role however many groups repeat them', () => {
    const rows: MappingRow[] = [
      {
        targetKind: 'permission_group',
        permissionGroupId: 'pg-1',
        workspaceId: null,
        permissionType: null,
        role: null,
      },
      {
        targetKind: 'permission_group',
        permissionGroupId: 'pg-1',
        workspaceId: null,
        permissionType: null,
        role: null,
      },
      {
        targetKind: 'org_role',
        permissionGroupId: null,
        workspaceId: null,
        permissionType: null,
        role: 'admin',
      },
      {
        targetKind: 'org_role',
        permissionGroupId: null,
        workspaceId: null,
        permissionType: null,
        role: 'admin',
      },
    ]
    expect(resolveDesiredGrants(rows)).toEqual([
      { targetKind: 'permission_group', targetId: 'pg-1' },
      { targetKind: 'org_role', targetId: 'admin' },
    ])
  })

  it('drops rows whose target column is missing', () => {
    const rows: MappingRow[] = [
      {
        targetKind: 'workspace',
        workspaceId: 'ws-1',
        permissionType: null,
        permissionGroupId: null,
        role: null,
      },
      {
        targetKind: 'permission_group',
        permissionGroupId: null,
        workspaceId: null,
        permissionType: null,
        role: null,
      },
      {
        targetKind: 'something_else',
        permissionGroupId: 'x',
        workspaceId: 'y',
        permissionType: 'admin',
        role: 'admin',
      },
    ]
    expect(resolveDesiredGrants(rows)).toEqual([])
  })
})

describe('planGrantChanges', () => {
  const workspace = (
    targetId: string,
    permissionType: 'admin' | 'write' | 'read'
  ): ProjectionGrant => ({
    targetKind: 'workspace',
    targetId,
    permissionType,
  })

  it('plans nothing when desired and current agree, which is what makes a reconcile idempotent', () => {
    const grants = [
      workspace('ws-1', 'write'),
      { targetKind: 'permission_group' as const, targetId: 'pg-1' },
    ]
    expect(planGrantChanges(grants, [...grants].reverse())).toEqual({ withdraw: [], apply: [] })
  })

  it('withdraws what is no longer desired and applies what is new', () => {
    const plan = planGrantChanges([workspace('ws-2', 'read')], [workspace('ws-1', 'read')])
    expect(plan.withdraw).toEqual([workspace('ws-1', 'read')])
    expect(plan.apply).toEqual([{ grant: workspace('ws-2', 'read') }])
  })

  it('carries the previous level when a workspace changes level in either direction', () => {
    expect(
      planGrantChanges([workspace('ws-1', 'admin')], [workspace('ws-1', 'read')]).apply
    ).toEqual([{ grant: workspace('ws-1', 'admin'), previousGrant: workspace('ws-1', 'read') }])
    expect(
      planGrantChanges([workspace('ws-1', 'read')], [workspace('ws-1', 'admin')]).apply
    ).toEqual([{ grant: workspace('ws-1', 'read'), previousGrant: workspace('ws-1', 'admin') }])
  })

  it('repairs missing and lowered access even when the provenance still matches', () => {
    const current = workspace('ws-1', 'admin')
    expect(planGrantChanges([current], [current], []).apply).toEqual([
      { grant: current, previousGrant: current },
    ])
    expect(planGrantChanges([current], [current], [workspace('ws-1', 'read')]).apply).toEqual([
      { grant: current, previousGrant: current },
    ])
    expect(
      planGrantChanges([workspace('ws-1', 'read')], [workspace('ws-1', 'read')], [current])
    ).toEqual({
      apply: [],
      withdraw: [],
    })
  })

  it('never withdraws a grant that is also desired at a different level', () => {
    const plan = planGrantChanges([workspace('ws-1', 'read')], [workspace('ws-1', 'admin')])
    expect(plan.withdraw).toEqual([])
  })
})
