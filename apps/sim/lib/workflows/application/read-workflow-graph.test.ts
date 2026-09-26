import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import {
  workflowsQueriesMock,
  workflowsQueriesMockFns,
} from '@sim/testing/mocks/workflows-queries.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/workflows/application/context', () => workflowContextMock)
vi.mock('@/lib/workflows/queries', () => workflowsQueriesMock)

import { readWorkflowGraph } from '@/lib/workflows/application/read-workflow-graph'

const mockRecordAudit = auditMockFns.mockRecordAudit
const mockLoadSnapshot = workflowsQueriesMockFns.mockLoadWorkflowReadSnapshot
const mockResolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const mockResolveContext = workflowContextMockFns.mockResolveActiveWorkflowApplicationContext

const context = {
  workflowId: 'workflow-1',
  workflow: { id: 'workflow-1', name: 'Daily digest', workspaceId: 'workspace-1' },
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const principal = createPersonalApiKeyPrincipal()
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
    mockResolveContext.mockResolvedValue(context)
    mockResolvePermission.mockResolvedValue('read')
    mockLoadSnapshot.mockResolvedValue({
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
    mockLoadSnapshot.mockResolvedValue({
      workflowRecord: { id: 'workflow-1', variables: stored },
      normalizedData: { blocks: { 'block-1': { id: 'block-1' } }, edges: [] },
    })

    await expect(readWorkflowGraph.execute({ principal, input })).resolves.toMatchObject({
      variables: PROJECTED_VARIABLES,
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

    expect(mockResolveContext).not.toHaveBeenCalled()
  })

  /**
   * The `HEAD` existence-leak guard. `defineV2JsonRoute` answers a head-safe
   * probe by calling `authorize()` alone, so an absent or permissive
   * `authorize` would turn every `HEAD` into an unauthenticated existence
   * oracle. Both halves are asserted: it must exist, it must refuse a principal
   * without the role, and it must reach that verdict without reading the graph.
   */
  describe('authorize', () => {
    it('refuses a principal without the minimum role, and never loads the graph', async () => {
      mockResolvePermission.mockResolvedValue(null)

      await expect(readWorkflowGraph.authorize!({ principal, input })).rejects.toMatchObject({
        code: 'forbidden',
      })

      expect(mockLoadSnapshot).not.toHaveBeenCalled()
    })
  })
})
