import { describe, expect, it } from 'vitest'
import { unorderedScopePart } from '@/lib/api/cursor-binding'
import {
  buildFilterConditions,
  buildOrgScopeCondition,
  decodeAuditLogCursor,
} from '@/lib/audit-logs/query'

const ORG_ID = 'org-1'
const MEMBER_IDS = ['user-1', 'user-2']
const WORKSPACE_IDS = ['ws-1', 'ws-2']

interface MockCondition {
  type?: string
  conditions?: MockCondition[]
  column?: string
  values?: string[]
  left?: string
  right?: string
  strings?: string[]
}

function asCondition(value: unknown): MockCondition {
  return value as MockCondition
}

/**
 * Asserts the condition matches null-workspace rows tied to the organization
 * via metadata or the organization resource itself.
 */
function expectOrgLevelCondition(condition: MockCondition, organizationId: string): void {
  expect(condition.type).toBe('and')
  const [nullCheck, orgLink] = condition.conditions!
  expect(nullCheck).toMatchObject({ type: 'isNull', column: 'auditLog.workspaceId' })

  expect(orgLink.type).toBe('or')
  const [metadataMatch, orgResourceMatch] = orgLink.conditions!
  expect(metadataMatch.strings?.join('?')).toContain("->>'organizationId' =")
  expect(metadataMatch.values).toContain(organizationId)

  expect(orgResourceMatch.type).toBe('and')
  expect(orgResourceMatch.conditions).toEqual([
    expect.objectContaining({ type: 'eq', left: 'auditLog.resourceType', right: 'organization' }),
    expect.objectContaining({ type: 'eq', left: 'auditLog.resourceId', right: organizationId }),
  ])
}

describe('buildOrgScopeCondition', () => {
  it('never uses actor membership as a standalone boundary (default scope)', () => {
    const condition = asCondition(
      buildOrgScopeCondition({
        organizationId: ORG_ID,
        orgWorkspaceIds: WORKSPACE_IDS,
        orgMemberIds: MEMBER_IDS,
        includeDeparted: false,
      })
    )

    expect(condition.type).toBe('and')
    const [orgScope, actorFilter] = condition.conditions!

    expect(orgScope.type).toBe('or')
    const [workspaceScope, orgLevel] = orgScope.conditions!
    expect(workspaceScope).toMatchObject({
      type: 'inArray',
      column: 'auditLog.workspaceId',
      values: WORKSPACE_IDS,
    })
    expectOrgLevelCondition(orgLevel, ORG_ID)

    expect(actorFilter).toMatchObject({
      type: 'or',
      conditions: [
        expect.objectContaining({
          type: 'inArray',
          column: 'auditLog.actorId',
          values: MEMBER_IDS,
        }),
        expect.objectContaining({ type: 'isNull', column: 'auditLog.actorId' }),
      ],
    })
  })

  it('omits the actor filter entirely when includeDeparted is true', () => {
    const condition = asCondition(
      buildOrgScopeCondition({
        organizationId: ORG_ID,
        orgWorkspaceIds: WORKSPACE_IDS,
        orgMemberIds: MEMBER_IDS,
        includeDeparted: true,
      })
    )

    expect(condition.type).toBe('or')
    const [workspaceScope, orgLevel] = condition.conditions!
    expect(workspaceScope).toMatchObject({
      type: 'inArray',
      column: 'auditLog.workspaceId',
      values: WORKSPACE_IDS,
    })
    expectOrgLevelCondition(orgLevel, ORG_ID)

    expect(JSON.stringify(condition)).not.toContain('actorId')
  })

  it('still applies the actor filter on top of the org scope with no workspaces', () => {
    const condition = asCondition(
      buildOrgScopeCondition({
        organizationId: ORG_ID,
        orgWorkspaceIds: [],
        orgMemberIds: MEMBER_IDS,
        includeDeparted: false,
      })
    )

    expect(condition.type).toBe('and')
    const [orgLevel, actorFilter] = condition.conditions!
    expectOrgLevelCondition(orgLevel, ORG_ID)
    expect(actorFilter).toMatchObject({
      type: 'or',
      conditions: [
        expect.objectContaining({
          type: 'inArray',
          column: 'auditLog.actorId',
          values: MEMBER_IDS,
        }),
        expect.objectContaining({ type: 'isNull', column: 'auditLog.actorId' }),
      ],
    })
  })

  it('only matches system events when the org has no current members', () => {
    const condition = asCondition(
      buildOrgScopeCondition({
        organizationId: ORG_ID,
        orgWorkspaceIds: WORKSPACE_IDS,
        orgMemberIds: [],
        includeDeparted: false,
      })
    )

    expect(condition.type).toBe('and')
    const [, actorFilter] = condition.conditions!
    expect(actorFilter).toMatchObject({ type: 'isNull', column: 'auditLog.actorId' })
  })
})

/**
 * `resourceType` is a comma-separated set, and the v2 cursor scope fingerprints
 * the same list. The query and the scope must agree on the members, or either
 * two different result sets share one stamp or two spellings of one result set
 * get different stamps and page 2 is refused.
 */
describe('buildFilterConditions resourceType', () => {
  function resourceTypeCondition(resourceType: string): MockCondition {
    const conditions = buildFilterConditions({ resourceType })
    expect(conditions).toHaveLength(1)
    return asCondition(conditions[0])
  }

  it('filters identically however the caller orders, spaces, or repeats members', () => {
    const canonical = resourceTypeCondition('file,workflow')
    for (const spelling of ['workflow,file', 'file, workflow', ' workflow ,file,file']) {
      expect(resourceTypeCondition(spelling)).toEqual(canonical)
    }
  })

  it('agrees with the cursor scope on the member list', () => {
    for (const spelling of ['file,workflow', 'workflow, file', 'file,workflow,file']) {
      expect(asCondition(buildFilterConditions({ resourceType: spelling })[0]).values).toEqual(
        unorderedScopePart(spelling)!.split(',')
      )
      expect(unorderedScopePart(spelling)).toBe(unorderedScopePart('file,workflow'))
    }
  })
})

describe('decodeAuditLogCursor', () => {
  it.each([
    'not-base64',
    Buffer.from('{}').toString('base64'),
    Buffer.from(JSON.stringify({ createdAt: 'not-a-date', id: 'audit-1' })).toString('base64'),
    Buffer.from(JSON.stringify({ createdAt: '2026-01-01T00:00:00.000Z', id: 1 })).toString(
      'base64'
    ),
  ])('rejects malformed cursor %s', (cursor) => {
    expect(decodeAuditLogCursor(cursor)).toBeNull()
  })
})
