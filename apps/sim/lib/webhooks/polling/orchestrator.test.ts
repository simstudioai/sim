/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(() => true),
  workspace: vi.fn(),
  route: vi.fn(async (organizationId: string | null | undefined) => ({ organizationId })),
  webhooks: vi.fn(),
  poll: vi.fn(),
}))

vi.mock('@/lib/core/network/config.server', () => ({
  isOutboundRoutingEnabled: mocks.enabled,
  resolveOutboundRoute: mocks.route,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.workspace,
}))
vi.mock('@/lib/webhooks/polling/registry', () => ({
  getPollingHandler: () => ({ provider: 'gmail', label: 'Gmail', pollWebhook: mocks.poll }),
}))
vi.mock('@/lib/webhooks/polling/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/webhooks/polling/utils')>()),
  fetchActiveWebhooks: mocks.webhooks,
}))

import {
  resolveCurrentOutboundRoute,
  runWithOutboundOrganization,
} from '@/lib/core/network/context.server'
import { pollProvider } from '@/lib/webhooks/polling/orchestrator'
import type { PollWebhookContext } from '@/lib/webhooks/polling/types'

function entry(workspaceId: string | null) {
  return {
    webhook: { id: `webhook-${workspaceId}` },
    workflow: { id: `workflow-${workspaceId}`, workspaceId },
  }
}

describe('polling outbound scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enabled.mockReturnValue(true)
  })

  it('isolates concurrent organizations and personal workspaces and restores the caller', async () => {
    const organizations = new Map<string, string | null>([
      ['workspace-a', 'org-a'],
      ['workspace-b', 'org-b'],
      ['workspace-personal', null],
    ])
    mocks.webhooks.mockResolvedValue([...organizations.keys()].map(entry))
    mocks.workspace.mockImplementation(async (workspaceId: string) => ({
      workspaceOrganizationId: organizations.get(workspaceId),
    }))
    let arrived = 0
    let release = () => {}
    const allStarted = new Promise<void>((resolve) => {
      release = resolve
    })
    mocks.poll.mockImplementation(async ({ workflowData }: PollWebhookContext) => {
      arrived++
      if (arrived === organizations.size) release()
      await allStarted
      expect(await resolveCurrentOutboundRoute()).toEqual({
        organizationId: organizations.get(workflowData.workspaceId!),
      })
      return 'success'
    })

    await runWithOutboundOrganization('caller-org', async () => {
      expect(await pollProvider('gmail')).toEqual({ total: 3, successful: 3, failed: 0 })
      expect(await resolveCurrentOutboundRoute()).toEqual({ organizationId: 'caller-org' })
    })
    expect(mocks.workspace).toHaveBeenCalledTimes(3)
    expect(mocks.poll).toHaveBeenCalledTimes(3)
  })

  it('does not contact the provider for a missing or archived workspace', async () => {
    mocks.webhooks.mockResolvedValue([entry('removed-workspace')])
    mocks.workspace.mockResolvedValue(null)

    expect(await pollProvider('gmail')).toEqual({ total: 1, successful: 0, failed: 1 })
    expect(mocks.poll).not.toHaveBeenCalled()
  })

  it('preserves legacy polling without ownership reads when routing is unconfigured', async () => {
    mocks.enabled.mockReturnValue(false)
    mocks.webhooks.mockResolvedValue([entry(null)])
    mocks.poll.mockResolvedValue('success')

    expect(await pollProvider('gmail')).toEqual({ total: 1, successful: 1, failed: 0 })
    expect(mocks.workspace).not.toHaveBeenCalled()
    expect(mocks.poll).toHaveBeenCalledOnce()
  })
})
