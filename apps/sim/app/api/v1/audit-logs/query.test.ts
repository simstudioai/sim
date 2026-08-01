/**
 * @vitest-environment node
 *
 * Tests for the enterprise audit-log tenant boundary. The global drizzle-orm
 * mock returns structured operator objects, so these tests assert directly on
 * the predicate tree.
 */
import { dbChainMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildOrgScopeCondition, getOrgWorkspaceIds } from '@/app/api/v1/audit-logs/query'

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
  expect(nullCheck).toMatchObject({ type: 'isNull', column: 'workspaceId' })

  expect(orgLink.type).toBe('or')
  const [metadataMatch, orgResourceMatch] = orgLink.conditions!
  expect(metadataMatch.strings?.join('?')).toContain("->>'organizationId' =")
  expect(metadataMatch.values).toContain(organizationId)

  expect(orgResourceMatch.type).toBe('and')
  expect(orgResourceMatch.conditions).toEqual([
    expect.objectContaining({ type: 'eq', left: 'resourceType', right: 'organization' }),
    expect.objectContaining({ type: 'eq', left: 'resourceId', right: organizationId }),
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
      column: 'workspaceId',
      values: WORKSPACE_IDS,
    })
    expectOrgLevelCondition(orgLevel, ORG_ID)

    expect(actorFilter).toMatchObject({
      type: 'or',
      conditions: [
        expect.objectContaining({ type: 'inArray', column: 'actorId', values: MEMBER_IDS }),
        expect.objectContaining({ type: 'isNull', column: 'actorId' }),
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
      column: 'workspaceId',
      values: WORKSPACE_IDS,
    })
    expectOrgLevelCondition(orgLevel, ORG_ID)

    expect(JSON.stringify(condition)).not.toContain('actorId')
  })

  it('falls back to the org-level branch alone when the org has no workspaces', () => {
    const condition = asCondition(
      buildOrgScopeCondition({
        organizationId: ORG_ID,
        orgWorkspaceIds: [],
        orgMemberIds: MEMBER_IDS,
        includeDeparted: true,
      })
    )

    expectOrgLevelCondition(condition, ORG_ID)
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
        expect.objectContaining({ type: 'inArray', column: 'actorId', values: MEMBER_IDS }),
        expect.objectContaining({ type: 'isNull', column: 'actorId' }),
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
    expect(actorFilter).toMatchObject({ type: 'isNull', column: 'actorId' })
  })
})

describe('getOrgWorkspaceIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('selects workspaces by organization ownership, not member ownership', async () => {
    const ids = await getOrgWorkspaceIds(ORG_ID)

    expect(ids).toEqual([])
    expect(dbChainMockFns.where).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'eq', left: 'organizationId', right: ORG_ID })
    )
  })
})
