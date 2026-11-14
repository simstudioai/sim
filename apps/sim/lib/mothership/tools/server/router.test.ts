import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BaseServerTool, ServerToolContext } from '@/lib/mothership/tools/server/base-tool'
import { changelogServerTool } from '@/lib/mothership/tools/server/changelog'
import { dashboardsServerTool } from '@/lib/mothership/tools/server/dashboards'
import { ffmpegServerTool } from '@/lib/mothership/tools/server/media/ffmpeg'
import { routeExecution } from '@/lib/mothership/tools/server/router'
import { organizationSearchSourcesServerTool } from '@/lib/mothership/tools/server/search-sources'
import { settingsServerTool } from '@/lib/mothership/tools/server/settings'
import { testsServerTool } from '@/lib/mothership/tools/server/tests'
import { workspacesServerTool } from '@/lib/mothership/tools/server/workspaces'

const tools: BaseServerTool[] = [
  settingsServerTool,
  dashboardsServerTool,
  changelogServerTool,
  testsServerTool,
  workspacesServerTool,
  organizationSearchSourcesServerTool,
  ffmpegServerTool,
]

/** The shape an unattributed inbox message runs with: the owner as principal, capped to read. */
const cappedWorkspaceRun: ServerToolContext = {
  userId: 'owner',
  workspaceId: 'workspace',
  chatId: 'chat',
  toolCallId: 'call',
  copilotToolExecution: true,
  requestMode: 'agent',
  userPermission: 'read',
}

const writes: Array<[string, Record<string, unknown>]> = [
  [
    'settings',
    {
      action: 'execute',
      scope: 'workspace',
      section: 'teammates',
      operation: 'invite',
      input: { emails: ['outsider@example.com'], permission: 'admin' },
    },
  ],
  ['settings', { action: 'update', scope: 'workspace', section: 'general', changes: {} }],
  ['dashboards', { action: 'set', content: '# Revenue' }],
  [
    'changelog',
    {
      action: 'publish',
      title: 'Release',
      body: 'Notes',
      bump: 'patch',
      bumpReason: 'Fixes',
      changes: [{ text: 'Fix' }],
    },
  ],
  ['changelog', { action: 'update', releaseId: 'release', expectedRevision: '1' }],
  ['tests', { action: 'create', name: 'billing', title: 'Billing' }],
  ['tests', { action: 'update', name: 'billing', title: 'Billing' }],
  ['tests', { action: 'delete', name: 'billing' }],
  ['tests', { action: 'run', version: 'draft' }],
  ['workspaces', { action: 'create', name: 'Research' }],
  ['search_sources', { action: 'approve', connectorType: 'slack', approved: true }],
  ['ffmpeg', { operation: 'probe', inputs: { files: [{ path: 'files/a.mp4' }] } }],
]

const reads: Array<[string, Record<string, unknown>]> = [
  ['settings', { action: 'list', scope: 'workspace' }],
  [
    'settings',
    {
      action: 'execute',
      scope: 'workspace',
      section: 'teammates',
      operation: 'list_invitations',
      input: {},
    },
  ],
  ['dashboards', { action: 'get' }],
  ['changelog', { action: 'list' }],
  ['tests', { action: 'list', version: 'draft' }],
  ['search_sources', { action: 'list' }],
]

const dispatched = vi.fn()

beforeEach(() => {
  dispatched.mockReset()
  for (const tool of tools) {
    vi.spyOn(tool, 'execute').mockImplementation(async () => {
      dispatched(tool.name)
      return { success: true }
    })
  }
})

/** Dispatch is what is under test; the stubbed result need not satisfy each tool's output schema. */
async function routeIgnoringOutput(
  toolName: string,
  payload: Record<string, unknown>,
  context: ServerToolContext
) {
  await routeExecution(toolName, payload, context).catch(() => undefined)
}

describe('a run capped below its principal’s role', () => {
  it.each(writes)('refuses %s %j before dispatch', async (toolName, payload) => {
    await expect(routeExecution(toolName, payload, cappedWorkspaceRun)).rejects.toThrow(
      "requires write access. You have 'read' permission."
    )
    expect(dispatched).not.toHaveBeenCalled()
  })

  it('refuses a write when the run carries no permission at all', async () => {
    await expect(
      routeExecution(
        'dashboards',
        { action: 'set', content: '# Revenue' },
        {
          ...cappedWorkspaceRun,
          userPermission: undefined,
        }
      )
    ).rejects.toThrow("You have 'none' permission.")
    expect(dispatched).not.toHaveBeenCalled()
  })

  it.each(reads)('still answers %s %j', async (toolName, payload) => {
    await routeIgnoringOutput(toolName, payload, cappedWorkspaceRun)
    expect(dispatched).toHaveBeenCalledExactlyOnceWith(toolName)
  })
})

describe('a run whose permission admits writes', () => {
  it('dispatches a write at write permission', async () => {
    await routeIgnoringOutput(
      'dashboards',
      { action: 'set', content: '# Revenue' },
      { ...cappedWorkspaceRun, userPermission: 'write' }
    )
    expect(dispatched).toHaveBeenCalledExactlyOnceWith('dashboards')
  })

  it.each([
    ['an organization chat', { organizationId: 'org', workspaceId: undefined }],
    ['an organization chat acting on a workspace', { chatOrganizationId: 'org' }],
  ])(
    'leaves %s to the live role its operations authorize',
    async (_label, scope: Partial<ServerToolContext>) => {
      await routeIgnoringOutput(
        'search_sources',
        { action: 'approve', connectorType: 'slack', approved: true },
        { ...cappedWorkspaceRun, userPermission: undefined, ...scope }
      )
      expect(dispatched).toHaveBeenCalledExactlyOnceWith('search_sources')
    }
  )
})
