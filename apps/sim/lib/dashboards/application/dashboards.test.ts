import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  flag: vi.fn(),
  get: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}))
vi.mock('@/lib/dashboards/feature-flag', () => ({ requireDashboardsEnabled: hoisted.flag }))
vi.mock('@/lib/dashboards/repository', () => ({
  getWorkspaceDashboard: hoisted.get,
  insertWorkspaceDashboard: hoisted.insert,
  updateDashboardContent: hoisted.update,
}))
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

import {
  readWorkspaceDashboard,
  saveWorkspaceDashboard,
} from '@/lib/dashboards/application/dashboards'

const principal = { kind: 'session' as const, userId: 'actor', sessionId: 'session' }
const input = { workspaceId: 'ws-1' }
const content = 'title: Support\nblocks:\n  - text: Hello'
const row = {
  id: 'dash-1',
  workspaceId: 'ws-1',
  content,
  revision: 3,
  createdBy: 'actor',
  updatedBy: 'actor',
  createdAt: new Date('2026-09-24T00:00:00Z'),
  updatedAt: new Date('2026-09-24T00:00:00Z'),
}

beforeEach(() => {
  hoisted.flag.mockResolvedValue(undefined)
  hoisted.get.mockResolvedValue(row)
  hoisted.insert.mockResolvedValue(row)
  hoisted.update.mockResolvedValue({ ...row, revision: 4 })
  workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('admin')
  workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext.mockResolvedValue({
    workspaceId: 'ws-1',
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
    billedAccountUserId: 'billing-owner',
  })
})

describe('workspace dashboard', () => {
  it('refuses every operation when dashboards are disabled', async () => {
    hoisted.flag.mockRejectedValue(new Error('Dashboards are not enabled'))
    await expect(readWorkspaceDashboard.execute({ principal, input })).rejects.toThrow(
      'Dashboards are not enabled'
    )
    await expect(
      saveWorkspaceDashboard.execute({ principal, input: { ...input, content } })
    ).rejects.toThrow('Dashboards are not enabled')
  })

  it('reads an absent dashboard as empty rather than an error', async () => {
    hoisted.get.mockResolvedValue(null)
    await expect(readWorkspaceDashboard.execute({ principal, input })).resolves.toEqual({
      dashboard: null,
      content: null,
    })
  })

  it('reads the dashboard with its own id and revision', async () => {
    await expect(readWorkspaceDashboard.execute({ principal, input })).resolves.toMatchObject({
      dashboard: { id: 'dash-1', type: 'dashboard', revision: '3' },
      content,
    })
  })

  it('creates the dashboard on the first save', async () => {
    await expect(
      saveWorkspaceDashboard.execute({ principal, input: { ...input, content } })
    ).resolves.toMatchObject({ created: true, dashboard: { id: 'dash-1' } })
  })

  it('refuses a revision-less save once the workspace has a dashboard', async () => {
    hoisted.insert.mockResolvedValue(null)
    await expect(
      saveWorkspaceDashboard.execute({ principal, input: { ...input, content } })
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('replaces the dashboard with its current revision', async () => {
    await expect(
      saveWorkspaceDashboard.execute({
        principal,
        input: { ...input, content, expectedRevision: '3' },
      })
    ).resolves.toMatchObject({ created: false, dashboard: { revision: '4' } })
  })

  it('refuses a stale revision and a dashboard deleted after it was read', async () => {
    hoisted.update.mockResolvedValue(null)
    await expect(
      saveWorkspaceDashboard.execute({
        principal,
        input: { ...input, content, expectedRevision: '2' },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    hoisted.get.mockResolvedValue(null)
    await expect(
      saveWorkspaceDashboard.execute({
        principal,
        input: { ...input, content, expectedRevision: '3' },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('rejects a revision that did not come from a read', async () => {
    await expect(
      saveWorkspaceDashboard.execute({
        principal,
        input: { ...input, content, expectedRevision: 'abc' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
  })

  it.each(['title: Broken\nblocks: invalid', 'title: Missing blocks'])(
    'refuses invalid YAML',
    async (invalid) => {
      await expect(
        saveWorkspaceDashboard.execute({ principal, input: { ...input, content: invalid } })
      ).rejects.toMatchObject({ code: 'validation' })
    }
  )

  it('lets a read-only member read but not save', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')
    await expect(readWorkspaceDashboard.execute({ principal, input })).resolves.toMatchObject({
      content,
    })
    await expect(
      saveWorkspaceDashboard.execute({
        principal,
        input: { ...input, content, expectedRevision: '3' },
      })
    ).rejects.toThrow()
  })
})
