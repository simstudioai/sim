import { describe, expect, it, vi } from 'vitest'
import {
  CREDENTIAL_GROUP_POLICY_BATCH_SIZE,
  CREDENTIAL_GROUP_POLICY_DOCUMENT_MAX_BYTES,
  CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT,
  type CredentialGroupPolicyLifecycleStore,
  createDefaultCredentialGroupPolicyDocument,
  type MissingCredentialGroupPolicyRow,
  parseCredentialGroupPolicyDocument,
  reconcileCredentialGroupResourcePolicies,
  type StoredCredentialGroupPolicyRow,
  validateOrganizationAccountPolicyDocument,
} from '../credential-group-resource-policies'

const WORKFLOW_POLICY = (id: string, workflowIds: string[]) => ({
  version: 1 as const,
  resource: { type: 'credential_group' as const, id },
  statements: [
    createDefaultCredentialGroupPolicyDocument(id).statements[0],
    {
      sid: 'WorkflowCredentialAccess' as const,
      effect: 'allow' as const,
      actions: ['credential_groups.credentials.use'] as const,
      principals: workflowIds.map((workflowId) => ({ type: 'workflow' as const, workflowId })),
      condition: { StringEquals: { 'execution:WorkflowMode': 'deployment' as const } },
    },
  ] as const,
})

function _normalizeSql(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

describe('Credential Group resource policy lifecycle', () => {
  it.each([
    ['wrong target', WORKFLOW_POLICY('group-2', ['workflow-1'])],
    [
      'multiple statements',
      {
        ...WORKFLOW_POLICY('group-1', ['workflow-1']),
        statements: [
          createDefaultCredentialGroupPolicyDocument('group-1').statements[0],
          WORKFLOW_POLICY('group-1', ['workflow-1']).statements[1],
          WORKFLOW_POLICY('group-1', ['workflow-2']).statements[1],
        ],
      },
    ],
    [
      'noncanonical SID',
      {
        ...WORKFLOW_POLICY('group-1', ['workflow-1']),
        statements: [
          createDefaultCredentialGroupPolicyDocument('group-1').statements[0],
          { ...WORKFLOW_POLICY('group-1', ['workflow-1']).statements[1], sid: 'AnotherRule' },
        ],
      },
    ],
    [
      'deny effect',
      {
        ...WORKFLOW_POLICY('group-1', ['workflow-1']),
        statements: [
          createDefaultCredentialGroupPolicyDocument('group-1').statements[0],
          { ...WORKFLOW_POLICY('group-1', ['workflow-1']).statements[1], effect: 'deny' },
        ],
      },
    ],
    [
      'extra action',
      {
        ...WORKFLOW_POLICY('group-1', ['workflow-1']),
        statements: [
          createDefaultCredentialGroupPolicyDocument('group-1').statements[0],
          {
            ...WORKFLOW_POLICY('group-1', ['workflow-1']).statements[1],
            actions: ['credential_groups.credentials.use', 'credential_groups.read'],
          },
        ],
      },
    ],
    [
      'non-workflow principal',
      {
        ...WORKFLOW_POLICY('group-1', ['workflow-1']),
        statements: [
          createDefaultCredentialGroupPolicyDocument('group-1').statements[0],
          {
            ...WORKFLOW_POLICY('group-1', ['workflow-1']).statements[1],
            principals: [{ type: 'user', userId: 'user-1' }],
          },
        ],
      },
    ],
    ['unsorted principals', WORKFLOW_POLICY('group-1', ['workflow-2', 'workflow-1'])],
    ['duplicate principals', WORKFLOW_POLICY('group-1', ['workflow-1', 'workflow-1'])],
    [
      'draft condition',
      {
        ...WORKFLOW_POLICY('group-1', ['workflow-1']),
        statements: [
          createDefaultCredentialGroupPolicyDocument('group-1').statements[0],
          {
            ...WORKFLOW_POLICY('group-1', ['workflow-1']).statements[1],
            condition: { StringEquals: { 'execution:WorkflowMode': 'draft' } },
          },
        ],
      },
    ],
    [
      'array condition',
      {
        ...WORKFLOW_POLICY('group-1', ['workflow-1']),
        statements: [
          createDefaultCredentialGroupPolicyDocument('group-1').statements[0],
          {
            ...WORKFLOW_POLICY('group-1', ['workflow-1']).statements[1],
            condition: { StringEquals: { 'execution:WorkflowMode': ['deployment'] } },
          },
        ],
      },
    ],
    [
      'extra field',
      {
        ...WORKFLOW_POLICY('group-1', ['workflow-1']),
        statements: [
          createDefaultCredentialGroupPolicyDocument('group-1').statements[0],
          { ...WORKFLOW_POLICY('group-1', ['workflow-1']).statements[1], note: 'unsupported' },
        ],
      },
    ],
    [
      'too many principals',
      WORKFLOW_POLICY(
        'group-1',
        Array.from(
          { length: CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT + 1 },
          (_, index) => `workflow-${String(index).padStart(3, '0')}`
        )
      ),
    ],
  ])('rejects %s', (_label, document) => {
    expect(() => parseCredentialGroupPolicyDocument(document, 'group-1')).toThrow()
  })

  it('installs lifecycle first, backfills bounded pages, and preserves valid policies on rerun', async () => {
    const missingRows: MissingCredentialGroupPolicyRow[] = [
      { id: 'group-2', workspaceId: 'workspace-1', createdBy: 'user-1' },
    ]
    const policies: StoredCredentialGroupPolicyRow[] = [
      {
        id: 'policy-1',
        workspaceId: 'workspace-1',
        resourceId: 'group-1',
        revision: 7,
        documentBytes: 1024,
        document: WORKFLOW_POLICY('group-1', ['workflow-1']),
      },
    ]
    const calls: string[] = []
    const store: CredentialGroupPolicyLifecycleStore = {
      async installLifecycleTrigger() {
        calls.push('install')
      },
      async listMissingPolicies(afterId, limit) {
        calls.push(`missing:${afterId}:${limit}`)
        return missingRows.filter((row) => row.id > afterId).slice(0, limit)
      },
      async insertDefaultPolicies(rows) {
        calls.push(`insert:${rows.length}`)
        for (const row of rows) {
          missingRows.splice(
            missingRows.findIndex((candidate) => candidate.id === row.id),
            1
          )
          policies.push({
            id: `policy-${row.id}`,
            workspaceId: row.workspaceId,
            resourceId: row.id,
            revision: 1,
            documentBytes: 128,
            document: createDefaultCredentialGroupPolicyDocument(row.id),
          })
        }
        return rows.length
      },
      async findRelationalInvariantViolation() {
        calls.push('invariants')
        return null
      },
      async listPolicies(afterId, limit) {
        calls.push(`validate:${afterId}:${limit}`)
        return [...policies]
          .filter((row) => row.id > afterId)
          .sort((left, right) => left.id.localeCompare(right.id))
          .slice(0, limit)
      },
    }

    await expect(
      reconcileCredentialGroupResourcePolicies(store, { batchSize: 2 })
    ).resolves.toEqual({ scannedMissing: 1, inserted: 1, validated: 2 })
    expect(policies[0]).toMatchObject({
      revision: 7,
      document: WORKFLOW_POLICY('group-1', ['workflow-1']),
    })
    expect(calls[0]).toBe('install')

    calls.length = 0
    await expect(
      reconcileCredentialGroupResourcePolicies(store, { batchSize: 2 })
    ).resolves.toEqual({ scannedMissing: 0, inserted: 0, validated: 2 })
    expect(calls[0]).toBe('install')
  })

  it('fails fast on malformed rows, relational violations, and invalid page bounds', async () => {
    const base: CredentialGroupPolicyLifecycleStore = {
      installLifecycleTrigger: vi.fn(),
      listMissingPolicies: vi.fn().mockResolvedValue([]),
      insertDefaultPolicies: vi.fn(),
      findRelationalInvariantViolation: vi.fn().mockResolvedValue(null),
      listPolicies: vi.fn().mockResolvedValue([]),
    }

    await expect(
      reconcileCredentialGroupResourcePolicies(base, {
        batchSize: CREDENTIAL_GROUP_POLICY_BATCH_SIZE + 1,
      })
    ).rejects.toThrow('batch size must be between')

    await expect(
      reconcileCredentialGroupResourcePolicies({
        ...base,
        findRelationalInvariantViolation: vi
          .fn()
          .mockResolvedValue({ kind: 'orphan', resourceId: 'group-1' }),
      })
    ).rejects.toThrow('orphan policy for group-1')

    await expect(
      reconcileCredentialGroupResourcePolicies({
        ...base,
        listMissingPolicies: vi
          .fn()
          .mockResolvedValue([{ id: '', workspaceId: 'workspace-1', createdBy: null }]),
      })
    ).rejects.toThrow('non-advancing page')

    await expect(
      reconcileCredentialGroupResourcePolicies({
        ...base,
        listPolicies: vi.fn().mockResolvedValueOnce([
          {
            id: 'policy-1',
            workspaceId: 'workspace-1',
            resourceId: 'group-1',
            revision: 0,
            documentBytes: 128,
            document: createDefaultCredentialGroupPolicyDocument('group-1'),
          },
        ]),
      })
    ).rejects.toThrow('invalid revision')

    await expect(
      reconcileCredentialGroupResourcePolicies({
        ...base,
        listPolicies: vi.fn().mockResolvedValueOnce([
          {
            id: 'policy-1',
            workspaceId: 'workspace-1',
            resourceId: 'group-1',
            revision: 1,
            documentBytes: CREDENTIAL_GROUP_POLICY_DOCUMENT_MAX_BYTES + 1,
            document: null,
          },
        ]),
      })
    ).rejects.toThrow('exceeds the 32768-byte limit')
  })
})

describe('organization account policy validation', () => {
  const policy = (ids: string[]) => ({
    version: 2,
    resource: { type: 'credential_group', id: 'group-org' },
    statements: ids.length
      ? [
          {
            sid: 'WorkspaceCredentialAccess',
            effect: 'allow',
            actions: ['credential_groups.credentials.use'],
            principals: ids.map((workspaceId) => ({ type: 'workspace', workspaceId })),
          },
        ]
      : [],
  })
  it('accepts integration conditions without rewriting organization policy grants', () => {
    const statement = policy(['a']).statements[0]
    const typed = {
      ...policy([]),
      statements: [
        {
          ...statement,
          sid: 'WorkspaceCredentialAccess:oauth:gmail',
          condition: { StringEquals: { 'credential_group:CredentialType': 'oauth:gmail' } },
        },
      ],
    }
    expect(() => validateOrganizationAccountPolicyDocument(typed, 'group-org')).not.toThrow()
    expect(() =>
      validateOrganizationAccountPolicyDocument(
        { ...typed, statements: [...typed.statements, statement] },
        'group-org'
      )
    ).toThrow('overlapping')
    expect(() =>
      validateOrganizationAccountPolicyDocument(
        { ...typed, statements: [...typed.statements, ...typed.statements] },
        'group-org'
      )
    ).toThrow('invalid')
    expect(() =>
      validateOrganizationAccountPolicyDocument(
        {
          ...typed,
          statements: [
            {
              ...typed.statements[0],
              condition: { StringNotEquals: { 'credential_group:CredentialType': 'oauth:gmail' } },
            },
          ],
        },
        'group-org'
      )
    ).toThrow()
  })
  it('rejects workflow grants and a policy for another group', () => {
    expect(() =>
      validateOrganizationAccountPolicyDocument(
        WORKFLOW_POLICY('group-org', ['workflow-1']),
        'group-org'
      )
    ).toThrow('version must be 2')
    expect(() => validateOrganizationAccountPolicyDocument(policy([]), 'other-group')).toThrow(
      'canonical resource'
    )
  })
})
