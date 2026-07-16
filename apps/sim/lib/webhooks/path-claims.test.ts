/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

type Condition =
  | { kind: 'and'; conditions: Condition[] }
  | { kind: 'eq'; column: string; value: unknown }
  | { kind: 'lte'; column: string; value: unknown }

vi.mock('drizzle-orm', () => ({
  and: (...conditions: Condition[]) => ({ kind: 'and', conditions }),
  eq: (column: string, value: unknown) => ({ kind: 'eq', column, value }),
  lte: (column: string, value: unknown) => ({ kind: 'lte', column, value }),
}))

import type { DbOrTx } from '@sim/workflow-persistence/types'
import {
  claimWebhookPath,
  StaleWebhookPathClaimGenerationError,
  WebhookPathClaimConflictError,
} from '@/lib/webhooks/path-claims'

interface ClaimRow {
  path: string
  workflowId: string
  generation: number
}

function conditionValue(condition: Condition, column: string): unknown {
  if (condition.kind === 'eq' && condition.column === column) return condition.value
  if (condition.kind !== 'and') return undefined
  for (const nested of condition.conditions) {
    const value = conditionValue(nested, column)
    if (value !== undefined) return value
  }
  return undefined
}

function createClaimTx(claims: Map<string, ClaimRow>): DbOrTx {
  return {
    insert: () => ({
      values: (values: ClaimRow) => ({
        onConflictDoUpdate: () => ({
          returning: async () => {
            const current = claims.get(values.path)
            if (
              current &&
              (current.workflowId !== values.workflowId || current.generation > values.generation)
            ) {
              return []
            }
            const claimed = { ...values }
            claims.set(values.path, claimed)
            return [claimed]
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: (condition: Condition) => ({
          limit: async () => {
            const path = conditionValue(condition, 'path') as string
            const current = claims.get(path)
            return current ? [current] : []
          },
        }),
      }),
    }),
  } as unknown as DbOrTx
}

describe('webhook path claims', () => {
  it('atomically gives a normalized path to one workflow under concurrent claims', async () => {
    const claims = new Map<string, ClaimRow>()
    const results = await Promise.allSettled([
      claimWebhookPath(createClaimTx(claims), {
        path: ' /shared/path/ ',
        workflowId: 'workflow-a',
        generation: 1,
      }),
      claimWebhookPath(createClaimTx(claims), {
        path: 'shared/path',
        workflowId: 'workflow-b',
        generation: 1,
      }),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejection = results.find((result) => result.status === 'rejected')
    expect(rejection).toBeDefined()
    if (rejection?.status !== 'rejected') throw new Error('Expected one rejected claim')
    expect(rejection.reason).toBeInstanceOf(WebhookPathClaimConflictError)
    expect(claims.get('shared/path')?.workflowId).toMatch(/^workflow-[ab]$/)
  })

  it('allows the same workflow to advance but rejects a stale generation', async () => {
    const claims = new Map<string, ClaimRow>()
    const tx = createClaimTx(claims)
    await claimWebhookPath(tx, { path: 'events', workflowId: 'workflow-a', generation: 3 })
    await claimWebhookPath(tx, { path: '/events/', workflowId: 'workflow-a', generation: 4 })

    await expect(
      claimWebhookPath(tx, { path: 'events', workflowId: 'workflow-a', generation: 3 })
    ).rejects.toBeInstanceOf(StaleWebhookPathClaimGenerationError)
    expect(claims.get('events')?.generation).toBe(4)
  })
})
