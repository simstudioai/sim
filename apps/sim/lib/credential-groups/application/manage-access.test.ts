import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  resourcePolicyRepositoryMock,
  resourcePolicyRepositoryMockFns,
} from '@sim/testing/mocks/resource-policy-repository.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compileCredentialGroupWorkflowAccessPolicy } from '@/lib/credential-groups/application/workflow-access-policy'
import { CREDENTIAL_GROUP_WORKFLOW_CATALOG_LIMIT } from '@/lib/credential-groups/limits'

const hoisted = vi.hoisted(() => ({
  requireAvailability: vi.fn(),
  resolveGroup: vi.fn(),
}))

vi.mock('@/lib/credential-groups/application/context', () => ({
  requireCredentialGroupSettingsAvailable: hoisted.requireAvailability,
  resolveCredentialGroupSettingsContext: hoisted.resolveGroup,
}))

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/resource-policies/repository', () => resourcePolicyRepositoryMock)

import {
  readCredentialGroupAccess,
  updateCredentialGroupAccess,
} from '@/lib/credential-groups/application/manage-access'
import { ResourcePolicyRevisionConflictError } from '@/lib/resource-policies/repository'

const mocks = {
  ...hoisted,
  requirePolicy: resourcePolicyRepositoryMockFns.mockRequireResourcePolicy,
  writePolicy: resourcePolicyRepositoryMockFns.mockWriteResourcePolicy,
}

const resolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission

const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
  credentialGroupId: 'group-1',
  name: 'Support',
  status: 'active' as const,
  options: [],
}
const principal = createSessionPrincipal({ userId: 'admin-1' })
const target = {
  assertedWorkspaceId: 'workspace-1',
  credentialGroupId: 'group-1',
}

function document(allowedWorkflowIds: string[] = []) {
  return compileCredentialGroupWorkflowAccessPolicy({
    credentialGroupId: context.credentialGroupId,
    allowedWorkflowIds,
  })
}

function storedPolicy(revision = 1, policyDocument = document(['workflow-1', 'workflow-2'])) {
  return {
    id: 'policy-1',
    workspaceId: 'workspace-1',
    revision,
    document: policyDocument,
    createdAt: new Date('2026-08-20T00:00:00.000Z'),
    updatedAt: new Date('2026-08-20T00:00:00.000Z'),
  }
}

const WORKFLOWS = [
  { id: 'workflow-1', name: 'Support workflow', nameLength: 16 },
  { id: 'workflow-2', name: 'Finance workflow', nameLength: 16 },
]

describe('Credential Group workflow access operations', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.resolveGroup.mockResolvedValue(context)
    resolvePermission.mockResolvedValue('admin')
    mocks.requireAvailability.mockResolvedValue(undefined)
    mocks.requirePolicy.mockResolvedValue(storedPolicy())
    queueTableRows(schemaMock.workflow, WORKFLOWS)
  })

  it('returns the unchanged workflow access wire shape', async () => {
    await expect(readCredentialGroupAccess.execute({ principal, input: target })).resolves.toEqual({
      revision: 1,
      allowedWorkflowIds: ['workflow-1', 'workflow-2'],
      workflows: [
        { id: 'workflow-1', name: 'Support workflow' },
        { id: 'workflow-2', name: 'Finance workflow' },
      ],
    })
  })

  it('fails before loading the catalog when stored policy is noncanonical', async () => {
    mocks.requirePolicy.mockResolvedValue(
      storedPolicy(1, {
        ...document([]),
        statements: [
          {
            ...document(['workflow-1']).statements[0],
            sid: 'OlderWorkflowGrant',
          },
        ],
      })
    )

    await expect(readCredentialGroupAccess.execute({ principal, input: target })).rejects.toThrow()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('requires settings availability before reading policy storage', async () => {
    mocks.requireAvailability.mockRejectedValue(new Error('Credential Groups are not available'))

    await expect(readCredentialGroupAccess.execute({ principal, input: target })).rejects.toThrow(
      'Credential Groups are not available'
    )
    expect(mocks.requirePolicy).not.toHaveBeenCalled()
  })

  it('fails when stored access references an archived or unavailable workflow', async () => {
    resetDbChainMock()
    queueTableRows(schemaMock.workflow, [WORKFLOWS[0]])

    await expect(readCredentialGroupAccess.execute({ principal, input: target })).rejects.toThrow(
      'references unavailable workflow workflow-2'
    )
  })

  it('fails closed when the bounded workflow catalog overflows', async () => {
    resetDbChainMock()
    queueTableRows(
      schemaMock.workflow,
      Array.from({ length: CREDENTIAL_GROUP_WORKFLOW_CATALOG_LIMIT + 1 }, (_, index) => ({
        id: `workflow-${index}`,
        name: `Workflow ${index}`,
        nameLength: `Workflow ${index}`.length,
      }))
    )

    await expect(readCredentialGroupAccess.execute({ principal, input: target })).rejects.toThrow(
      `exceeds the ${CREDENTIAL_GROUP_WORKFLOW_CATALOG_LIMIT} row limit`
    )
  })

  it('requires current workspace-admin permission', async () => {
    resolvePermission.mockResolvedValue('write')

    await expect(
      updateCredentialGroupAccess.execute({
        principal,
        input: { ...target, expectedRevision: 1, allowedWorkflowIds: ['workflow-1'] },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.writePolicy).not.toHaveBeenCalled()
  })

  it('rejects unavailable workflow selections before writes', async () => {
    await expect(
      updateCredentialGroupAccess.execute({
        principal,
        input: { ...target, expectedRevision: 1, allowedWorkflowIds: ['workflow-3'] },
      })
    ).rejects.toMatchObject({ code: 'validation', message: 'Policy workflow was not found' })
    expect(mocks.writePolicy).not.toHaveBeenCalled()
  })

  it('rejects a stale revision before loading workflow references', async () => {
    mocks.requirePolicy.mockResolvedValue(storedPolicy(2))

    await expect(
      updateCredentialGroupAccess.execute({
        principal,
        input: { ...target, expectedRevision: 1, allowedWorkflowIds: ['workflow-1'] },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mocks.writePolicy).not.toHaveBeenCalled()
  })

  it('maps optimistic-write conflicts to an application conflict', async () => {
    mocks.writePolicy.mockRejectedValue(new ResourcePolicyRevisionConflictError())

    await expect(
      updateCredentialGroupAccess.execute({
        principal,
        input: { ...target, expectedRevision: 1, allowedWorkflowIds: ['workflow-1'] },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
  })
})
