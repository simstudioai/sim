/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ json: vi.fn(), resolveAccount: vi.fn(), bundle: vi.fn() }))
vi.mock('@/lib/internal/oracle-fusion/client', () => ({ requestOracleFusionJson: mocks.json }))
vi.mock('@/lib/oauth/credential-service', () => ({ resolveOAuthAccountId: mocks.resolveAccount }))
vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({ resolveSelectorCredentialBundle: mocks.bundle }))

import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { MAX_SELECTOR_OPTIONS } from '@/lib/selectors/limits'
import { SelectorConnectionUnavailableError, SelectorContextUnavailableError, SelectorOptionsUnavailableError } from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { oracleFusionProjectManagementSelectorAttachments as attachments } from '@/lib/selectors/server/providers/oracle-fusion-project-management'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

type Key = keyof typeof attachments
const destination = { accessToken: 'dXNlcjpwYXNz', instanceUrl: 'https://example.fa.us2.oraclecloud.com' }

function args(key: Key, overrides: Partial<ExecuteServerSelectorArgs> = {}): ExecuteServerSelectorArgs {
  return {
    selectorKey: key, context: {}, request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' }, workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1', references: new Map(), protectedValues: createSelectorProtectedValues(),
    ...overrides,
  }
}

function page(items: unknown[], extra: Record<string, unknown> = {}) {
  return { items, count: items.length, limit: 50, offset: 0, hasMore: false, ...extra }
}

async function execute(key: Key, overrides: Partial<ExecuteServerSelectorArgs> = {}) {
  return attachments[key].execute(args(key, overrides), destination)
}

async function prepare(key: Key, input: ExecuteServerSelectorArgs) {
  const policy = attachments[key].destination
  if (typeof policy === 'string') throw new Error('Expected a prepared destination')
  expect(policy.kind).toBe('credential-bound')
  return policy.prepare(input)
}

describe('Oracle Project Management credential-bound selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveAccount.mockResolvedValue({ credentialType: 'service_account', providerId: 'oracle-fusion-service-account' })
    mocks.bundle.mockResolvedValue(destination)
  })

  it('prepares only the authorized Oracle Fusion service-account destination', async () => {
    const key = 'oracleFusionProjectManagement.projects'
    const input = args(key, {
      credential: { suppliedId: 'credential-1', access: { resolvedCredentialId: 'credential-1', credentialType: 'service_account', credentialOwnerUserId: 'owner-1' } as NonNullable<ExecuteServerSelectorArgs['credential']>['access'] },
    })
    expect(attachments[key].credential).toEqual({ kind: 'stored', field: 'oauthCredential', serviceIds: ['oracle_fusion_project_management'] })
    expect(await prepare(key, input)).toEqual(destination)
    expect(mocks.resolveAccount).toHaveBeenCalledWith('credential-1')
    expect(mocks.bundle).toHaveBeenCalledWith({ credential: input.credential, protectedValues: input.protectedValues })
    mocks.resolveAccount.mockResolvedValueOnce({ credentialType: 'service_account', providerId: 'netsuite-service-account' })
    await expect(prepare(key, input)).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
    await expect(prepare(key, args(key))).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
    expect(mocks.json).not.toHaveBeenCalled()
  })

  it.each([
    ['projects', 'projects', { ProjectId: '999999999999999999', ProjectName: 'Delivery', ProjectNumber: 'P1' }, '999999999999999999', 'Delivery'],
    ['organizations', 'projectClassifiedOrganizationsLOV', { OrganizationName: 'Consulting', OrganizationId: 101 }, 'Consulting', 'Consulting'],
    ['resources', 'projectEnterpriseResources', { ResourceId: 808, ResourceDisplayName: 'Staff Member', ResourceEmail: 'staff@example.test', PersonId: 999 }, 'staff@example.test', 'Staff Member'],
    ['roles', 'projectRolesLOV', { ProjectRoleId: 1, ProjectRoleName: 'Project Manager' }, 'Project Manager', 'Project Manager'],
    ['deliverableTypes', 'deliverableTypesLOV', { DeliverableTypeId: 1, Name: 'General', DeliverableTypeClass: 'DOCUMENT' }, '1', 'General'],
    ['statuses', 'projectStatusesLOV', { ProjectStatusCode: 'APPROVED', ProjectStatusName: 'Approved', StatusObjectCode: 'SYNTHETIC_PROJECT_OBJECT' }, 'APPROVED', 'Approved (SYNTHETIC_PROJECT_OBJECT)'],
  ] as const)('projects safe %s options with the persisted write value', async (name, path, record, id, label) => {
    mocks.json.mockResolvedValue(page([{ ...record, accessToken: 'secret-canary', links: [{ href: 'https://not-a-public-option.test' }] }]))
    const result = await execute(`oracleFusionProjectManagement.${name}`)
    expect(result).toMatchObject({ kind: 'list', items: [{ id, label }] })
    expect(JSON.stringify(result)).not.toContain('secret-canary')
    expect(JSON.stringify(result)).not.toContain('not-a-public-option')
    expect(mocks.json.mock.calls[0][0]).toEqual(destination)
    expect(mocks.json.mock.calls[0][1].address).toEqual({ family: 'fscm', relativePath: path })
  })

  it('limits organizations to active project-owning classifications', async () => {
    mocks.json.mockResolvedValue(page([]))
    await execute('oracleFusionProjectManagement.organizations')
    expect(mocks.json.mock.calls[0][1].query.q).toBe("ClassificationCode='PA_PROJECT_ORG' and Status='A'")
  })

  it('escapes provider-side search and preserves the server paging offset', async () => {
    mocks.json.mockResolvedValue(page([{ ProjectId: 101, ProjectName: "O'Neil", ProjectNumber: 'P1' }], { offset: 50, hasMore: true }))
    const result = await execute('oracleFusionProjectManagement.projects', { request: { kind: 'list', search: "O'Neil", cursor: '50' } })
    expect(result).toMatchObject({ kind: 'list', nextCursor: '51', items: [{ id: '101', label: "O'Neil" }] })
    expect(mocks.json.mock.calls[0][1].query).toMatchObject({ offset: 50, limit: 50, q: "ProjectName like '%O''Neil%'", fields: 'ProjectId,ProjectName,ProjectNumber' })
    expect(mocks.json).toHaveBeenCalledTimes(1)
  })

  it('hydrates name-valued organizations with a query rather than treating the name as a numeric path ID', async () => {
    mocks.json.mockResolvedValue(page([{ OrganizationName: 'Consulting', OrganizationId: 101 }], { limit: 2 }))
    expect(await execute('oracleFusionProjectManagement.organizations', { request: { kind: 'detail', id: 'Consulting' } })).toEqual({ kind: 'detail', item: { id: 'Consulting', label: 'Consulting', meta: { detail: '101' } } })
    expect(mocks.json.mock.calls[0][1].address.relativePath).toBe('projectClassifiedOrganizationsLOV')
    expect(mocks.json.mock.calls[0][1].query.q).toContain("OrganizationName='Consulting'")
    mocks.json.mockResolvedValueOnce(page([], { limit: 2 }))
    expect(await execute('oracleFusionProjectManagement.projects', { request: { kind: 'detail', id: '101' } })).toEqual({ kind: 'detail', item: null })
  })

  it('requires active parents and queries task assignments within both the project and task', async () => {
    await expect(execute('oracleFusionProjectManagement.tasks')).rejects.toBeInstanceOf(SelectorContextUnavailableError)
    await expect(execute('oracleFusionProjectManagement.laborAssignments', { context: { projectId: '101' } })).rejects.toBeInstanceOf(SelectorContextUnavailableError)
    expect(mocks.json).not.toHaveBeenCalled()
    mocks.json.mockResolvedValueOnce(page([{ TaskId: 202, Name: 'Design', TaskNumber: 'T1' }]))
    await execute('oracleFusionProjectManagement.tasks', { context: { projectId: '101' } })
    expect(mocks.json.mock.calls[0][1].address.relativePath).toBe('projectPlanDetails/101/child/Tasks')
    mocks.json.mockResolvedValueOnce(page([{ TaskLaborResourceAssignmentId: 707, ResourceName: 'Staff', ResourceEmail: 'staff@example.test' }], { limit: 2 }))
    const result = await execute('oracleFusionProjectManagement.laborAssignments', { context: { projectId: '101', taskId: '202' }, request: { kind: 'detail', id: '707' } })
    expect(result).toMatchObject({ kind: 'detail', item: { id: '707', label: 'Staff' } })
    expect(mocks.json.mock.calls[1][1]).toMatchObject({ address: { family: 'fscm', relativePath: 'projectPlans/101/child/TaskLaborResourceAssignments' }, query: { q: 'TaskId=202 and TaskLaborResourceAssignmentId=707' } })
  })

  it('uses project-specific membership IDs, not person IDs', async () => {
    mocks.json.mockResolvedValue(page([{ TeamMemberId: 606, PersonId: 999, PersonName: 'Staff', ProjectRole: 'Project Manager' }]))
    expect(await execute('oracleFusionProjectManagement.teamMembers', { context: { projectId: '101' } })).toMatchObject({ kind: 'list', items: [{ id: '606', label: 'Staff' }] })
  })

  it('skips resources without an email while advancing the original provider page', async () => {
    mocks.json.mockResolvedValue(page([{ ResourceId: 808, ResourceDisplayName: 'No email', ResourceEmail: null }], { hasMore: true }))
    expect(await execute('oracleFusionProjectManagement.resources')).toMatchObject({ kind: 'list', items: [], nextCursor: '1' })
  })

  it('reports the provider cap and rejects malformed or over-budget cursors', async () => {
    mocks.json.mockResolvedValue(page([{ ProjectId: 101, ProjectName: 'Last', ProjectNumber: 'P1' }], { limit: 1, offset: MAX_SELECTOR_OPTIONS - 1, hasMore: true }))
    const result = await execute('oracleFusionProjectManagement.projects', { request: { kind: 'list', cursor: String(MAX_SELECTOR_OPTIONS - 1) } })
    expect(result).not.toHaveProperty('nextCursor')
    expect(result).toMatchObject({ diagnostics: { truncated: { reason: 'provider-cap', limit: MAX_SELECTOR_OPTIONS } } })
    for (const cursor of ['-1', '1.5', String(MAX_SELECTOR_OPTIONS)]) {
      await expect(execute('oracleFusionProjectManagement.projects', { request: { kind: 'list', cursor } })).rejects.toBeInstanceOf(SelectorContextUnavailableError)
    }
  })

  it('rejects malformed collections and preserves safe status and cancellation behavior', async () => {
    mocks.json.mockResolvedValueOnce(page([], { hasMore: true }))
    await expect(execute('oracleFusionProjectManagement.projects')).rejects.toBeInstanceOf(SelectorOptionsUnavailableError)
    mocks.json.mockRejectedValueOnce(new OracleFusionProviderError('Safe authentication failure', 401))
    await expect(execute('oracleFusionProjectManagement.projects')).rejects.toEqual(new SelectorConnectionUnavailableError(401))
    const controller = new AbortController()
    controller.abort()
    await expect(execute('oracleFusionProjectManagement.projects', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
