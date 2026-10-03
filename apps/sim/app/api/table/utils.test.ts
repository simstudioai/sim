import { describe, expect, it } from 'vitest'
import { capabilityGovernedAuthUserId } from '@/lib/auth/hybrid'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { TableRowNotFoundError } from '@/lib/table/rows/errors'
import type { ColumnDefinition } from '@/lib/table/types'
import {
  orchestrationErrorResponse,
  orchestrationOutcomeErrorResponse,
  tableFilterError,
} from '@/app/api/table/utils'

/** Mimics drizzle's DrizzleQueryError: message is the failed SQL, real error on `cause`. */
function wrapLikeDrizzle(cause: Error): Error {
  return new Error('Failed query: insert into "user_table_rows" ...', { cause })
}

describe('orchestrationErrorResponse', () => {
  it('answers the code the failure carries, not one derived from its wording', () => {
    expect(orchestrationErrorResponse(new TableRowNotFoundError())?.status).toBe(404)
    // The phrase that used to force a 400 no longer decides anything.
    expect(
      orchestrationErrorResponse(new OrchestrationError('conflict', 'Row 3: must be unique'))
        ?.status
    ).toBe(409)
  })

  it('unwraps a classified failure drizzle wrapped in a query error', () => {
    expect(
      orchestrationErrorResponse(
        wrapLikeDrizzle(new OrchestrationError('validation', 'Row 3: bad'))
      )?.status
    ).toBe(400)
  })
})

/**
 * The async destructive routes (delete-async, cancel-runs, columns/run)
 * validate the WIRE filter here. The predicate branch must reject unknown
 * storage keys the way the sync bulk routes do — the `toLegacyFilter`
 * downgrade compiles a typo'd field into a clause that silently matches
 * nothing, turning a scoped delete/run into a no-op.
 */
describe('tableFilterError', () => {
  const columns: ColumnDefinition[] = [{ id: 'col_status', name: 'status', type: 'string' }]

  it('400s a predicate naming an unknown storage key', async () => {
    const response = tableFilterError(
      { all: [{ field: 'statuss', op: 'eq', value: 'x' }] },
      columns
    )
    expect(response?.status).toBe(400)
    const body = await response?.json()
    expect(body.error).toMatch(/Unknown filter column "statuss"/)
  })

  it('400s a structurally invalid predicate (empty group, dual group keys)', () => {
    expect(tableFilterError({ all: [] } as never, columns)?.status).toBe(400)
    expect(
      tableFilterError(
        {
          all: [{ field: 'col_status', op: 'eq', value: 'a' }],
          any: [{ field: 'col_status', op: 'eq', value: 'b' }],
        } as never,
        columns
      )?.status
    ).toBe(400)
  })
})

describe('orchestrationOutcomeErrorResponse', () => {
  /**
   * Shaped like a driver fault surfacing verbatim — a statement plus its bound
   * parameters — so the assertion proves none of it reaches the response body.
   */
  const leakyMessage =
    'Failed query: delete from "user_table" where "user_table"."id" = $1 params: tbl-1'

  it('replaces an unclassified failure message with the fallback', async () => {
    const response = orchestrationOutcomeErrorResponse(
      { success: false, error: leakyMessage, errorCode: 'internal' },
      'Failed to delete table'
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({ error: 'Failed to delete table' })
    expect(JSON.stringify(body)).not.toContain('Failed query')
    expect(JSON.stringify(body)).not.toContain('params:')
  })

  it('carries the rejecting lock kind on a 423', async () => {
    const response = orchestrationOutcomeErrorResponse(
      { error: 'Table is locked against deletion', errorCode: 'locked', lock: 'delete' },
      'Failed to delete table'
    )

    expect(response.status).toBe(423)
    expect(await response.json()).toEqual({
      error: 'Table is locked against deletion',
      lock: 'delete',
    })
  })
})

describe('capabilityGovernedAuthUserId', () => {
  /**
   * The executor embeds the run's actor in the internal JWT — the workspace
   * billing owner, or the member who merely triggered the run. Reading a
   * governed subject off it applies that bystander's permission group to an
   * executor call, which is the substitution the subject exists to remove.
   */
  it('names nobody for an internal JWT even though it carries a user id', () => {
    expect(
      capabilityGovernedAuthUserId({
        success: true,
        userId: 'billing-owner',
        authType: 'internal_jwt',
      })
    ).toBeNull()
  })

  it('names nobody for a workspace API key, whose user id is the key creator', () => {
    expect(
      capabilityGovernedAuthUserId({
        success: true,
        userId: 'key-creator',
        authType: 'api_key',
        apiKeyType: 'workspace',
      })
    ).toBeNull()
  })
})
