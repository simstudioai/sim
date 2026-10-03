/**
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
import { backgroundTaskMock, backgroundTaskMockFns } from '@sim/testing/mocks/background-task.mock'
import { folderQueriesMock, folderQueriesMockFns } from '@sim/testing/mocks/folder-queries.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { tableMock, tableMockFns } from '@sim/testing/mocks/table.mock'
import {
  tableJobsServiceMock,
  tableJobsServiceMockFns,
} from '@sim/testing/mocks/table-jobs-service.mock'
import { usersQueriesMock, usersQueriesMockFns } from '@sim/testing/mocks/users-queries.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  performCreateTableFromCsv: vi.fn(),
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)
vi.mock('@/lib/table/jobs/service', () => tableJobsServiceMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/table', () => tableMock)
vi.mock('@/lib/table/orchestration', () => ({
  performCreateTableFromCsv: hoisted.performCreateTableFromCsv,
}))
vi.mock('@/lib/folders/queries', () => folderQueriesMock)
vi.mock('@/lib/users/queries', () => usersQueriesMock)
vi.mock('@/lib/core/utils/background', () => backgroundTaskMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { POST as importCsv } from '@/app/api/table/import-csv/route'
import { GET as listJobs } from '@/app/api/table/jobs/route'

const mocks = {
  getUserSettings: usersQueriesMockFns.mockGetUserSettings,
  listWorkspaceExportJobs: tableJobsServiceMockFns.mockListWorkspaceExportJobs,
  createTable: tableMockFns.mockCreateTable,
  getWorkspaceTableLimits: tableMockFns.mockGetWorkspaceTableLimits,
  listTables: tableMockFns.mockListTables,
  findActiveFolder: folderQueriesMockFns.mockFindActiveFolder,
  runDetached: backgroundTaskMockFns.mockRunDetached,
  ...hoisted,
  checkWorkspaceAccess: permissionsMockFns.mockCheckWorkspaceAccess,
  getUserEntityPermissions: permissionsMockFns.mockGetUserEntityPermissions,
}

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
    createMockRequest({
      url: `http://localhost/api/table/jobs?workspaceId=${WORKSPACE_ID}&type=export`,
    })
  )
}

function startImport() {
  const form = new FormData()
  form.append('workspaceId', WORKSPACE_ID)
  form.append('file', new Blob(['a,b\n1,2'], { type: 'text/csv' }), 'upload.csv')
  return importCsv(
    new NextRequest('http://localhost/api/table/import-csv', {
      method: 'POST',
      body: form,
    })
  )
}

describe('the subject the raw table routes gate on', () => {
  beforeEach(() => {
    resetPermissionGroupScopeMock()
    mocks.checkWorkspaceAccess.mockResolvedValue({ hasAccess: true })
    mocks.getUserEntityPermissions.mockResolvedValue('admin')
    mocks.listWorkspaceExportJobs.mockResolvedValue([{ id: 'job-1' }])
    mocks.listTables.mockResolvedValue([])
    mocks.getWorkspaceTableLimits.mockResolvedValue({ maxTables: 100 })
    mocks.getUserSettings.mockResolvedValue({ timezone: 'UTC' })
    mocks.createTable.mockResolvedValue({ id: TABLE_ID })
    mocks.performCreateTableFromCsv.mockResolvedValue({
      success: true,
      data: { tableId: TABLE_ID },
    })
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
      expect(mocks.performCreateTableFromCsv).toHaveBeenCalled()
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
      expect(mocks.performCreateTableFromCsv).not.toHaveBeenCalled()
    })
  })
})
