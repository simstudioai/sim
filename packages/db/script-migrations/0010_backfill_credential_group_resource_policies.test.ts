/**
 * @vitest-environment node
 */
import { readFile } from 'node:fs/promises'
import type { Sql } from 'postgres'
import { describe, expect, it, vi } from 'vitest'
import {
  CREDENTIAL_GROUP_POLICY_BATCH_SIZE,
  CREDENTIAL_GROUP_POLICY_DOCUMENT_MAX_BYTES,
  CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT,
  type CredentialGroupPolicyLifecycleStore,
  createDefaultCredentialGroupPolicyDocument,
  createPostgresCredentialGroupPolicyLifecycleStore,
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

function normalizeSql(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

describe('Credential Group resource policy lifecycle', () => {
  it('accepts only the canonical actor-only or actor-plus-workflow document', () => {
    expect(
      parseCredentialGroupPolicyDocument(
        createDefaultCredentialGroupPolicyDocument('group-1'),
        'group-1'
      )
    ).toEqual(createDefaultCredentialGroupPolicyDocument('group-1'))
    expect(
      parseCredentialGroupPolicyDocument(
        WORKFLOW_POLICY('group-1', ['workflow-1', 'workflow-2']),
        'group-1'
      )
    ).toEqual(WORKFLOW_POLICY('group-1', ['workflow-1', 'workflow-2']))
  })

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

  it('uses idempotent lifecycle DDL and bounded canonical inserts', async () => {
    const queries: string[] = []
    const query = vi.fn((strings: TemplateStringsArray) => {
      const text = normalizeSql(strings.join('?'))
      queries.push(text)
      if (text.includes('INSERT INTO resource_policy')) {
        return Promise.resolve([{ resourceId: 'group-1' }])
      }
      return Promise.resolve([])
    })
    const sql = query as unknown as Sql
    sql.begin = vi.fn(async (callback) => callback(sql)) as Sql['begin']
    const store = createPostgresCredentialGroupPolicyLifecycleStore(sql)

    await store.installLifecycleTrigger()
    await expect(
      store.insertDefaultPolicies([
        { id: 'group-1', workspaceId: 'workspace-1', createdBy: 'user-1' },
      ])
    ).resolves.toBe(1)
    await store.listPolicies('', 2)

    expect(queries).toHaveLength(6)
    expect(queries[0]).toBe("SET LOCAL lock_timeout = '5s'")
    expect(queries[1]).toContain('CREATE OR REPLACE FUNCTION')
    expect(queries[1]).toContain("'sid', 'CredentialGroupActorCredentialAccess'")
    expect(queries[1]).toContain("'credential_group:ActorOwnsCredential', true")
    expect(queries[1]).toContain('IF NEW."workspace_id" IS NULL THEN RETURN NEW; END IF;')
    expect(queries[2]).toContain('DROP TRIGGER IF EXISTS')
    expect(queries[3]).toContain('CREATE TRIGGER')
    expect(queries[4]).toContain('ON CONFLICT (resource_type, resource_id) DO NOTHING')
    expect(queries[4]).toContain('AND cg.workspace_id IS NOT NULL')
    expect(queries[5]).toContain('octet_length(document::text)')
    expect(queries[5]).toContain('THEN document ELSE NULL')
    await store.listMissingPolicies('', 2)
    await store.findRelationalInvariantViolation()
    expect(queries[6]).toContain('AND cg.workspace_id IS NOT NULL')
    expect(queries[7]).toContain('WHERE rp.resource_id IS NULL')
    expect(queries[7]).toContain('rp.organization_id IS DISTINCT FROM cg.organization_id')
  })

  it('keeps table creation in 0309 and lifecycle reconciliation in the db:push post-step', async () => {
    const migration = normalizeSql(
      await readFile(
        new URL('../migrations/0309_material_blonde_phantom.sql', import.meta.url),
        'utf8'
      )
    )
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8')
    ) as { scripts: Record<string, string> }
    const helperSource = await readFile(
      new URL('../credential-group-resource-policies.ts', import.meta.url),
      'utf8'
    )

    expect(migration).toContain('CREATE TABLE "resource_policy"')
    expect(migration).not.toContain('credential_group_resource_policy_lifecycle')
    expect(packageJson.scripts['db:push']).toContain(
      'scripts/reconcile-credential-group-resource-policies.ts'
    )
    expect(helperSource).not.toContain('LegacyResourcePolicy')
    expect(helperSource).not.toContain("document ? 'grants'")
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
  it('accepts deny-by-default and the maximum workspace allowlist', () => {
    expect(() => validateOrganizationAccountPolicyDocument(policy([]), 'group-org')).not.toThrow()
    expect(() =>
      validateOrganizationAccountPolicyDocument(
        policy(Array.from({ length: 1000 }, (_, i) => `workspace-${String(i).padStart(4, '0')}`)),
        'group-org'
      )
    ).not.toThrow()
  })
  it.each([
    ['b', 'a'],
    ['a', 'a'],
  ])('rejects unsorted or duplicate workspace principals', (...ids) => {
    expect(() => validateOrganizationAccountPolicyDocument(policy(ids), 'group-org')).toThrow(
      'unique and sorted'
    )
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
