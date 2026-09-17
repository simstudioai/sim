/** @vitest-environment node */
import type { OrganizationDelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolve = vi.hoisted(() => vi.fn())
const sectionAccess = vi.hoisted(() => vi.fn())
vi.mock('@/lib/settings/application/organization-section-access', () => ({
  authorizeOrganizationSettingsSection: sectionAccess,
}))
const searchAvailable = vi.hoisted(() => vi.fn(() => Promise.resolve(false)))
vi.mock('@/lib/knowledge/access/availability', () => ({
  isKnowledgeMemberAccessAvailable: searchAvailable,
}))
vi.mock('@/lib/mothership/application/settings-context', () => ({
  resolveSettingsContext: resolve,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { startOrganizationAccountConnection } from '@/lib/credential-groups/application/organization-accounts'
import {
  getDataDrain,
  listDataDrains,
  runDataDrain,
  testDataDrain,
  updateDataDrain,
} from '@/lib/data-drains/application/use-cases'
import { settingsServerTool } from '@/lib/mothership/tools/server/settings'
import { updateOrganizationMemberRole } from '@/lib/organizations/application/member-role'
import { readOrganizationRoster } from '@/lib/organizations/application/member-roster'
import {
  readOrganizationSettings,
  updateOrganizationSettings,
} from '@/lib/organizations/application/settings'
import { updateCurrentUserPreferences } from '@/lib/users/application/preferences'

const principal: OrganizationDelegatedPrincipal = {
  kind: 'organization_delegated',
  serviceId: 'copilot',
  organizationId: 'org',
  subjectUserId: 'actor',
  delegationId: 'call',
  audience: 'sim:settings',
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  resourceScope: { chatId: 'chat' },
}
const value = {
  id: 'org',
  name: 'Example',
  slug: 'example',
  logo: null,
  updatedAt: '2026-09-15T12:00:00.000Z',
}
const drain = {
  id: 'drain',
  organizationId: 'org',
  name: 'Exports',
  source: 'audit_logs' as const,
  destinationType: 'webhook' as const,
  destinationConfig: { url: 'https://example.com?secret=hidden' },
  scheduleCadence: 'daily' as const,
  enabled: true,
  cursor: 'private-cursor',
  createdBy: 'actor',
  lastRunAt: null,
  lastSuccessAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('settings tool dispatch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    searchAvailable.mockResolvedValue(false)
    sectionAccess.mockResolvedValue(true)
    resolve
      .mockReset()
      .mockResolvedValue({ scope: 'organization', organizationId: 'org', principal })
  })

  it('omits denied organization sections and refuses their setup or schema discovery', async () => {
    sectionAccess.mockImplementation(async ({ section }) => section !== 'security')
    const result = await settingsServerTool.execute({ scope: 'organization', action: 'list' })
    expect(result).not.toMatchObject({
      sections: expect.arrayContaining([expect.objectContaining({ id: 'security' })]),
    })
    for (const action of ['open', 'get'] as const) {
      await expect(
        settingsServerTool.execute({ scope: 'organization', action, section: 'security' })
      ).rejects.toThrow('unavailable')
    }
    expect(sectionAccess).toHaveBeenCalledWith({
      organizationId: 'org',
      userId: 'actor',
      section: 'security',
    })
  })

  it('discovers names without eagerly reading every setting or dumping every schema', async () => {
    const read = vi.spyOn(readOrganizationSettings, 'execute')
    const result = await settingsServerTool.execute({ scope: 'organization', action: 'list' })
    expect(result).toMatchObject({
      scope: 'organization',
      sections: expect.arrayContaining([expect.objectContaining({ id: 'members' })]),
    })
    expect(JSON.stringify(result)).not.toContain('inputSchema')
    expect(read).not.toHaveBeenCalled()
  })

  it('routes connected-account setup to the supported Search page when Search replaces it', async () => {
    searchAvailable.mockResolvedValue(true)
    expect(
      await settingsServerTool.execute({
        scope: 'organization',
        action: 'open',
        section: 'connected-accounts',
      })
    ).toMatchObject({ setupUrl: '/o/org/settings/integrations', status: 'requires_user_setup' })
    searchAvailable.mockResolvedValue(false)
    sectionAccess.mockResolvedValue(true)
    expect(
      await settingsServerTool.execute({
        scope: 'organization',
        action: 'open',
        section: 'connected-accounts',
      })
    ).toMatchObject({ setupUrl: '/o/org/settings/connected-accounts' })
  })

  it('does not advertise platform-admin controls as ordinary account settings', async () => {
    resolve.mockResolvedValue({ scope: 'account', organizationId: 'org', principal })
    const result = await settingsServerTool.execute({ scope: 'account', action: 'list' })
    expect(JSON.stringify(result)).not.toContain('/settings/mothership')
    expect(JSON.stringify(result)).not.toContain('/settings/admin')
  })

  it('explains the canonical archived resource family operations', async () => {
    resolve.mockResolvedValue({ scope: 'workspace', workspaceId: 'workspace', principal })
    expect(
      await settingsServerTool.execute({
        scope: 'workspace',
        action: 'open',
        section: 'recently-deleted',
      })
    ).toMatchObject({
      cli: expect.arrayContaining(['workflows restore', 'files restore', 'tables restore']),
      userSetup: expect.stringContaining('scope archived'),
    })
  })

  it('pages roster metadata through the canonical organization authority and preserves refusals', async () => {
    const read = vi.spyOn(readOrganizationRoster, 'execute').mockResolvedValue({
      members: [],
      pendingInvitations: [],
      workspaces: Array.from({ length: 40 }, (_, i) => ({
        id: String(i).padStart(2, '0'),
        name: `Workspace ${i}`,
      })),
    })
    const result = await settingsServerTool.execute({
      scope: 'organization',
      section: 'members',
      action: 'execute',
      operation: 'list_page',
      input: { offset: 25, limit: 10 },
    })
    expect(read).toHaveBeenCalledWith({ principal, input: { organizationId: 'org' } })
    expect(result).toMatchObject({
      result: {
        workspaces: {
          total: 40,
          offset: 25,
          nextOffset: 35,
          truncated: true,
          items: expect.arrayContaining([{ id: '25', name: 'Workspace 25' }]),
        },
      },
    })
    read.mockRejectedValue(new OrchestrationError('forbidden', 'Directory access withheld'))
    await expect(
      settingsServerTool.execute({
        scope: 'organization',
        section: 'members',
        action: 'execute',
        operation: 'list_page',
        input: {},
      })
    ).rejects.toThrow('Directory access withheld')
  })

  it('reads through the shared use case and returns the canonical update contract', async () => {
    const read = vi.spyOn(readOrganizationSettings, 'execute').mockResolvedValue(value)
    const result = await settingsServerTool.execute({
      scope: 'organization',
      section: 'general',
      action: 'get',
    })
    expect(read).toHaveBeenCalledWith({ principal, input: { organizationId: 'org' } })
    expect(result).toMatchObject({
      value,
      updateSchema: { type: 'object', additionalProperties: false },
    })
  })

  it('describes only the requested operation and rejects inherited property names', async () => {
    const result = await settingsServerTool.execute({
      scope: 'organization',
      section: 'members',
      action: 'describe',
      operation: 'invite',
    })
    expect(result).toMatchObject({
      operation: 'invite',
      inputSchema: { type: 'object', properties: { emails: { type: 'array' } } },
    })
    expect(JSON.stringify(result).length).toBeLessThan(2500)
    await expect(
      settingsServerTool.execute({
        scope: 'organization',
        section: 'members',
        action: 'describe',
        operation: 'toString',
      })
    ).rejects.toThrow('Unknown operation')
  })

  it('validates update fields before the protected mutation', async () => {
    const update = vi.spyOn(updateOrganizationSettings, 'execute').mockResolvedValue(value)
    await expect(
      settingsServerTool.execute({
        scope: 'organization',
        section: 'general',
        action: 'update',
        changes: { organizationId: 'foreign', metadata: {} },
      })
    ).rejects.toThrow('Unrecognized')
    expect(update).not.toHaveBeenCalled()
    await settingsServerTool.execute({
      scope: 'organization',
      section: 'general',
      action: 'update',
      changes: { name: 'Example' },
    })
    expect(update).toHaveBeenCalledWith({
      principal,
      input: { organizationId: 'org', patch: { name: 'Example' } },
    })
  })

  it('binds collection operations to the authorized organization and preserves policy errors', async () => {
    const update = vi
      .spyOn(updateOrganizationMemberRole, 'execute')
      .mockRejectedValue(new Error('Administrator required'))
    await expect(
      settingsServerTool.execute({
        scope: 'organization',
        section: 'members',
        action: 'execute',
        operation: 'set_role',
        input: { userId: 'member', role: 'admin', organizationId: 'foreign' },
      })
    ).rejects.toThrow('Unrecognized')
    expect(update).not.toHaveBeenCalled()
    await expect(
      settingsServerTool.execute({
        scope: 'organization',
        section: 'members',
        action: 'execute',
        operation: 'set_role',
        input: { userId: 'member', role: 'admin' },
      })
    ).rejects.toThrow('Administrator required')
    expect(update).toHaveBeenCalledWith({
      principal,
      input: { organizationId: 'org', userId: 'member', role: 'admin' },
    })
  })

  it('never exposes drain destinations, cursors or provider errors through management results', async () => {
    vi.spyOn(listDataDrains, 'execute').mockResolvedValue([drain])
    vi.spyOn(getDataDrain, 'execute').mockResolvedValue(drain)
    vi.spyOn(testDataDrain, 'execute').mockResolvedValue({
      drain,
      ok: false,
      error: 'provider request secret=hidden',
    })
    vi.spyOn(runDataDrain, 'execute').mockResolvedValue({ drain, jobId: 'job' })
    const results = [
      await settingsServerTool.execute({
        scope: 'organization',
        section: 'data-drains',
        action: 'get',
      }),
    ]
    for (const operation of ['get', 'test', 'run'])
      results.push(
        await settingsServerTool.execute({
          scope: 'organization',
          section: 'data-drains',
          action: 'execute',
          operation,
          input: { drainId: 'drain' },
        })
      )
    expect(JSON.stringify(results)).not.toMatch(/hidden|private-cursor|destinationConfig/)
    expect(results[2]).toMatchObject({
      result: { ok: false, error: expect.stringContaining('Settings') },
    })
    expect(results[3]).toMatchObject({ result: { status: 'queued', jobId: 'job' } })
  })

  it('rejects drain credential writes and preserves the bounded run-history contract', async () => {
    const write = vi.spyOn(updateDataDrain, 'execute')
    await expect(
      settingsServerTool.execute({
        scope: 'organization',
        section: 'data-drains',
        action: 'execute',
        operation: 'update',
        input: { drainId: 'drain', changes: { destinationCredentials: { token: 'value' } } },
      })
    ).rejects.toThrow('Unrecognized')
    expect(write).not.toHaveBeenCalled()
    await expect(
      settingsServerTool.execute({
        scope: 'organization',
        section: 'data-drains',
        action: 'execute',
        operation: 'runs',
        input: { drainId: 'drain', limit: 1000 },
      })
    ).rejects.toThrow()
  })

  it('returns the existing organization account authorization link as a user setup step', async () => {
    const connect = vi.spyOn(startOrganizationAccountConnection, 'execute').mockResolvedValue({
      invitationLink: 'https://sim.test/enroll/test',
      authorizationUrl: 'https://sim.test/oauth/test',
    })
    const result = await settingsServerTool.execute({
      scope: 'organization',
      section: 'connected-accounts',
      action: 'execute',
      operation: 'connect',
      input: { optionId: 'gmail' },
    })
    expect(connect).toHaveBeenCalledWith({
      principal,
      input: { organizationId: 'org', optionId: 'gmail' },
    })
    expect(result).toMatchObject({
      result: { status: 'requires_user_setup', authorizationUrl: 'https://sim.test/oauth/test' },
    })
  })
})

it('publishes a preference refresh only after the canonical write succeeds', async () => {
  resolve.mockResolvedValue({ scope: 'account', principal })
  const update = vi
    .spyOn(updateCurrentUserPreferences, 'execute')
    .mockResolvedValue({ success: true })
  const input = {
    scope: 'account',
    section: 'preferences',
    action: 'update',
    changes: { theme: 'light' },
  } as const
  const result = await settingsServerTool.execute(input)
  expect(result).toMatchObject({
    resources: [
      { op: 'refresh', resource: { type: 'settings', scope: 'account', id: 'preferences' } },
    ],
  })
  update.mockRejectedValueOnce(new Error('Write refused'))
  await expect(settingsServerTool.execute(input)).rejects.toThrow('Write refused')
})

it('publishes scoped refreshes for writes, while settings queries remain side-effect free', async () => {
  resolve.mockResolvedValue({ scope: 'organization', organizationId: 'org', principal })
  sectionAccess.mockResolvedValue(true)
  vi.spyOn(updateOrganizationSettings, 'execute').mockResolvedValue(value)
  expect(
    await settingsServerTool.execute({
      scope: 'organization',
      section: 'general',
      action: 'update',
      changes: { name: 'Example' },
    })
  ).toMatchObject({
    resources: [
      {
        op: 'refresh',
        resource: { type: 'settings', scope: 'organization', organizationId: 'org', id: 'general' },
      },
    ],
  })
  vi.spyOn(readOrganizationSettings, 'execute').mockResolvedValue(value)
  expect(
    await settingsServerTool.execute({ scope: 'organization', section: 'general', action: 'get' })
  ).not.toHaveProperty('resources')
})
