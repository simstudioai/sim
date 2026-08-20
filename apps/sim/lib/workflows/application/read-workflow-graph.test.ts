/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  resolveContext: vi.fn(),
  resolvePermission: vi.fn(),
  loadSnapshot: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {},
  AuditResourceType: { WORKFLOW: 'workflow' },
  recordAudit: mocks.recordAudit,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.resolveContext,
}))
vi.mock('@/lib/workflows/queries', () => ({ loadWorkflowReadSnapshot: mocks.loadSnapshot }))

import { readWorkflowGraph } from '@/lib/workflows/application/read-workflow-graph'

const context = {
  workflowId: 'workflow-1',
  workflow: { id: 'workflow-1', name: 'Daily digest', workspaceId: 'workspace-1' },
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const principal = { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' }
const input = { workflowId: 'workflow-1' }

/** The stored column shape, including the `workflowId` this surface withholds. */
const STORED_VARIABLES = {
  'var-1': { id: 'var-1', workflowId: 'workflow-1', name: 'region', type: 'string', value: 'eu' },
}
/** What the read projects: canonical variables, no `workflowId`. */
const PROJECTED_VARIABLES = {
  'var-1': { id: 'var-1', name: 'region', type: 'string', value: 'eu' },
}

describe('readWorkflowGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.loadSnapshot.mockResolvedValue({
      workflowRecord: { id: 'workflow-1', variables: STORED_VARIABLES },
      normalizedData: { blocks: { 'block-1': { id: 'block-1' } }, edges: [] },
    })
  })

  it('returns the unsanitized draft graph with loop and parallel containers always present', async () => {
    await expect(readWorkflowGraph.execute({ principal, input })).resolves.toEqual({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      blocks: { 'block-1': { id: 'block-1' } },
      edges: [],
      loops: {},
      parallels: {},
      variables: PROJECTED_VARIABLES,
    })
  })

  /**
   * The column has carried a JSON string and a legacy array as well as the
   * current record, and nothing on any write path bounds `type` to the enum the
   * response publishes. Parsing is what stops a strict outbound schema from
   * rejecting a workflow this endpoint exists to open.
   */
  it.each([
    ['a JSON string', JSON.stringify(STORED_VARIABLES)],
    ['a legacy array', Object.values(STORED_VARIABLES)],
  ])('reads variables stored as %s', async (_shape, stored) => {
    mocks.loadSnapshot.mockResolvedValue({
      workflowRecord: { id: 'workflow-1', variables: stored },
      normalizedData: { blocks: { 'block-1': { id: 'block-1' } }, edges: [] },
    })

    await expect(readWorkflowGraph.execute({ principal, input })).resolves.toMatchObject({
      variables: PROJECTED_VARIABLES,
    })
  })

  /**
   * The pollability guarantee: auditing this read would force `headSafe: false`
   * and make the endpoint unusable for the polling it exists to serve.
   */
  it('records no audit event', async () => {
    await readWorkflowGraph.execute({ principal, input })

    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('is not found when the workflow has no normalized state', async () => {
    mocks.loadSnapshot.mockResolvedValue({
      workflowRecord: { id: 'workflow-1', variables: null },
      normalizedData: null,
    })

    await expect(readWorkflowGraph.execute({ principal, input })).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('rejects a principal kind the operation does not accept before canonical loading', async () => {
    await expect(
      readWorkflowGraph.execute({
        principal: {
          kind: 'credential_group_enrollment',
          workspaceId: 'workspace-1',
          credentialGroupId: 'group-1',
          enrollmentId: 'enrollment-1',
          email: 'someone@example.com',
          invitationTokenHash: 'hash',
        },
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.resolveContext).not.toHaveBeenCalled()
  })

  it('answers the authorization phase without loading the graph', async () => {
    await readWorkflowGraph.authorize?.({ principal, input })

    expect(mocks.loadSnapshot).not.toHaveBeenCalled()
  })
})
