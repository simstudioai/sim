/**
 * @vitest-environment node
 *
 * The raw `/api/table/**` routes that authenticate with
 * `checkSessionOrInternalAuth` accept an internal executor JWT, whose `userId`
 * is the subject the executor embedded rather than a person asking for
 * anything. Reading it bare applies that person's permission group to a
 * delegation the executor exemption deliberately passes ungated — so these pin
 * the derivation (`capabilityGovernedAuthUserId`) at each gate, on a group
 * whose config would refuse if it were consulted.
 */
import {
  hybridAuthMockFns,
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  resetPermissionGroupScopeMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listWorkspaceExportJobs: vi.fn(),
  checkWorkspaceAccess: vi.fn(),
  getUserEntityPermissions: vi.fn(),
  createTable: vi.fn(),
  listTables: vi.fn(),
  getWorkspaceTableLimits: vi.fn(),
  findActiveFolder: vi.fn(),
  getUserSettings: vi.fn(),
  runDetached: vi.fn(),
  runTableImport: vi.fn(),
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)
vi.mock('@/lib/table/jobs/service', () => ({
  listWorkspaceExportJobs: mocks.listWorkspaceExportJobs,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mocks.checkWorkspaceAccess,
  getUserEntityPermissions: mocks.getUserEntityPermissions,
}))
vi.mock('@/lib/table', () => ({
  createTable: mocks.createTable,
  deleteTable: vi.fn(),
  getWorkspaceTableLimits: mocks.getWorkspaceTableLimits,
  listTables: mocks.listTables,
  releaseJobClaim: vi.fn(),
  sanitizeName: (name: string) => name,
  TABLE_LIMITS: { MAX_TABLE_NAME_LENGTH: 64 },
}))
vi.mock('@/lib/table/import-runner', () => ({ runTableImport: mocks.runTableImport }))
vi.mock('@/lib/folders/queries', () => ({ findActiveFolder: mocks.findActiveFolder }))
vi.mock('@/lib/users/queries', () => ({ getUserSettings: mocks.getUserSettings }))
vi.mock('@/lib/core/utils/background', () => ({ runDetached: mocks.runDetached }))
vi.mock('@/lib/core/config/env-flags', () => ({ isTriggerDevEnabled: false }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { POST as importAsync } from '@/app/api/table/import-async/route'
import { GET as listJobs } from '@/app/api/table/jobs/route'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const TABLE_ID = '22222222-2222-4222-8222-222222222222'
const ACTOR_ID = 'run-actor'

/** The run's actor, embedded in the executor's internal JWT. */
function authenticateAsExecutor() {
  hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
    success: true,
    userId: ACTOR_ID,
    authType: 'internal_jwt',
  })
}

/** The same person, calling the same route from their own browser session. */
function authenticateAsSession() {
  hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
    success: true,
    userId: ACTOR_ID,
    authType: 'session',
  })
}

function getExportJobs() {
  return listJobs(
    new NextRequest(`http://localhost/api/table/jobs?workspaceId=${WORKSPACE_ID}&type=export`)
  )
}

function startImport() {
  return importAsync(
    new NextRequest('http://localhost/api/table/import-async', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        fileKey: `workspace/${WORKSPACE_ID}/upload.csv`,
        fileName: 'upload.csv',
      }),
      headers: { 'content-type': 'application/json' },
    })
  )
}

describe('the subject the raw table routes gate on', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetPermissionGroupScopeMock()
    mocks.checkWorkspaceAccess.mockResolvedValue({ hasAccess: true })
    mocks.getUserEntityPermissions.mockResolvedValue('admin')
    mocks.listWorkspaceExportJobs.mockResolvedValue([{ id: 'job-1' }])
    mocks.listTables.mockResolvedValue([])
    mocks.getWorkspaceTableLimits.mockResolvedValue({ maxTables: 100 })
    mocks.getUserSettings.mockResolvedValue({ timezone: 'UTC' })
    mocks.createTable.mockResolvedValue({ id: TABLE_ID })
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideTablesTab: true,
      disableTableExport: true,
    })
  })

  describe('an executor delegation carrying the actor’s id', () => {
    beforeEach(authenticateAsExecutor)

    it('lists the workspace’s export jobs without consulting the actor’s group', async () => {
      const response = await getExportJobs()

      expect(await response.json()).toEqual({ success: true, data: { jobs: [{ id: 'job-1' }] } })
      expect(permissionGroupScopeMockFns.mockResolvePermissionGroupConfig).not.toHaveBeenCalled()
    })

    it('starts an import without consulting the actor’s group', async () => {
      const response = await startImport()

      expect(response.status).toBe(200)
      expect(mocks.createTable).toHaveBeenCalled()
      expect(permissionGroupScopeMockFns.mockResolvePermissionGroupConfig).not.toHaveBeenCalled()
    })
  })

  describe('the same person on their own session', () => {
    beforeEach(authenticateAsSession)

    it('is handed an empty export tray', async () => {
      const response = await getExportJobs()

      expect(await response.json()).toEqual({ success: true, data: { jobs: [] } })
      expect(mocks.listWorkspaceExportJobs).not.toHaveBeenCalled()
    })

    it('is refused the import, and no table is created', async () => {
      const response = await startImport()

      expect(response.status).toBe(403)
      expect(mocks.createTable).not.toHaveBeenCalled()
    })
  })
})
