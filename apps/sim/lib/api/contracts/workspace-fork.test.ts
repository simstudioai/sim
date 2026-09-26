/**
 * @vitest-environment node
 *
 * Boundary coverage for the fork-sync contract slices. The two `.default(...)` fields are
 * rollout tolerance: a new client must parse an OLD server's response, which omits them.
 */
import { describe, expect, it } from 'vitest'
import {
  forkWorkspaceBodySchema,
  getForkLineageContract,
  getForkResourcesContract,
  updateForkSyncDefaultBodySchema,
  updateForkSyncDefaultContract,
} from '@/lib/api/contracts/workspace-fork'

describe('updateForkSyncDefaultBodySchema', () => {
  it.each([true, false])('accepts excludeNewWorkflows=%p', (value) => {
    expect(updateForkSyncDefaultBodySchema.parse({ excludeNewWorkflows: value })).toEqual({
      excludeNewWorkflows: value,
    })
  })

  /** No default: the caller must state the policy, so a malformed body cannot silently opt a lineage in. */
  it('requires the flag rather than defaulting it', () => {
    expect(updateForkSyncDefaultBodySchema.safeParse({}).success).toBe(false)
  })

  it('rejects a non-boolean', () => {
    expect(updateForkSyncDefaultBodySchema.safeParse({ excludeNewWorkflows: 'yes' }).success).toBe(
      false
    )
  })

  it('is wired to the PUT sync-default route', () => {
    expect(updateForkSyncDefaultContract.method).toBe('PUT')
    expect(updateForkSyncDefaultContract.path).toBe('/api/workspaces/[id]/fork/sync-default')
  })

  it('returns the applied value and how many lineage members changed', () => {
    expect(
      updateForkSyncDefaultContract.response.schema.parse({
        excludeNewWorkflows: true,
        workspacesUpdated: 4,
      })
    ).toEqual({ excludeNewWorkflows: true, workspacesUpdated: 4 })
  })
})

describe('forkWorkspaceBodySchema.copyUnsyncedWorkflows', () => {
  /** Off by default, so a fork carries exactly what the Forks page shows as synced. */
  it('defaults to false when the client omits it', () => {
    expect(forkWorkspaceBodySchema.parse({}).copyUnsyncedWorkflows).toBe(false)
  })

  it('carries an explicit opt-in through', () => {
    expect(
      forkWorkspaceBodySchema.parse({ copyUnsyncedWorkflows: true }).copyUnsyncedWorkflows
    ).toBe(true)
  })
})

describe('rollout tolerance', () => {
  it('defaults forkSyncNewWorkflowsExcluded to false for an old server response', () => {
    const schema = getForkLineageContract.response.schema.pick({
      forkSyncNewWorkflowsExcluded: true,
    })
    expect(schema.parse({}).forkSyncNewWorkflowsExcluded).toBe(false)
    expect(schema.parse({ forkSyncNewWorkflowsExcluded: true }).forkSyncNewWorkflowsExcluded).toBe(
      true
    )
  })

  it('defaults unsyncedDeployedWorkflowCount to 0 for an old server response', () => {
    const schema = getForkResourcesContract.response.schema.pick({
      unsyncedDeployedWorkflowCount: true,
    })
    expect(schema.parse({}).unsyncedDeployedWorkflowCount).toBe(0)
    expect(schema.parse({ unsyncedDeployedWorkflowCount: 3 }).unsyncedDeployedWorkflowCount).toBe(3)
  })
})
