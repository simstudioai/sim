import { expect } from 'vitest'
import type { ExecutionContext } from '../types'

/**
 * Asserts that a block was executed.
 *
 * @example
 * ```ts
 * expectBlockExecuted(ctx, 'block-1')
 * ```
 */
export function expectBlockExecuted(ctx: ExecutionContext, blockId: string): void {
  expect(ctx.executedBlocks.has(blockId), `Block "${blockId}" should have been executed`).toBe(true)
}

/**
 * Asserts that a block was NOT executed.
 *
 * @example
 * ```ts
 * expectBlockNotExecuted(ctx, 'skipped-block')
 * ```
 */
export function expectBlockNotExecuted(ctx: ExecutionContext, blockId: string): void {
  expect(ctx.executedBlocks.has(blockId), `Block "${blockId}" should not have been executed`).toBe(
    false
  )
}

/**
 * Asserts that blocks were executed in a specific order.
 *
 * @example
 * ```ts
 * expectExecutionOrder(executionLog, ['start', 'step1', 'step2', 'end'])
 * ```
 */
export function expectExecutionOrder(executedBlocks: string[], expectedOrder: string[]): void {
  const actualOrder = executedBlocks.filter((id) => expectedOrder.includes(id))
  expect(actualOrder, 'Blocks should be executed in expected order').toEqual(expectedOrder)
}

/**
 * Asserts that a block has a specific output state.
 *
 * @example
 * ```ts
 * expectBlockOutput(ctx, 'agent-1', { response: 'Hello' })
 * ```
 */
export function expectBlockOutput(
  ctx: ExecutionContext,
  blockId: string,
  expectedOutput: Record<string, any>
): void {
  const state = ctx.blockStates.get(blockId)
  expect(state, `Block "${blockId}" should have state`).toBeDefined()
  expect(state).toMatchObject(expectedOutput)
}

/**
 * Asserts that execution has a specific number of logs.
 *
 * @example
 * ```ts
 * expectLogCount(ctx, 5)
 * ```
 */
export function expectLogCount(ctx: ExecutionContext, expectedCount: number): void {
  expect(ctx.blockLogs.length, `Should have ${expectedCount} logs`).toBe(expectedCount)
}

/**
 * Asserts that a condition decision was made.
 *
 * @example
 * ```ts
 * expectConditionDecision(ctx, 'condition-1', true)
 * ```
 */
export function expectConditionDecision(
  ctx: ExecutionContext,
  blockId: string,
  expectedResult: boolean
): void {
  const decision = ctx.decisions.condition.get(blockId)
  expect(decision, `Condition "${blockId}" should have a decision`).toBeDefined()
  expect(decision).toBe(expectedResult)
}

/**
 * Asserts that a loop was completed.
 *
 * @example
 * ```ts
 * expectLoopCompleted(ctx, 'loop-1')
 * ```
 */
export function expectLoopCompleted(ctx: ExecutionContext, loopId: string): void {
  expect(ctx.completedLoops.has(loopId), `Loop "${loopId}" should be completed`).toBe(true)
}

/**
 * Asserts that a block is in the active execution path.
 *
 * @example
 * ```ts
 * expectInActivePath(ctx, 'current-block')
 * ```
 */
export function expectInActivePath(ctx: ExecutionContext, blockId: string): void {
  expect(ctx.activeExecutionPath.has(blockId), `Block "${blockId}" should be in active path`).toBe(
    true
  )
}

/**
 * Asserts that execution was cancelled.
 *
 * @example
 * ```ts
 * expectExecutionCancelled(ctx)
 * ```
 */
export function expectExecutionCancelled(ctx: ExecutionContext): void {
  expect(ctx.abortSignal?.aborted, 'Execution should be cancelled').toBe(true)
}

/**
 * Asserts that execution was NOT cancelled.
 *
 * @example
 * ```ts
 * expectExecutionNotCancelled(ctx)
 * ```
 */
export function expectExecutionNotCancelled(ctx: ExecutionContext): void {
  expect(ctx.abortSignal?.aborted ?? false, 'Execution should not be cancelled').toBe(false)
}

/**
 * Asserts that execution has specific environment variables.
 *
 * @example
 * ```ts
 * expectEnvironmentVariables(ctx, { API_KEY: 'test', MODE: 'production' })
 * ```
 */
export function expectEnvironmentVariables(
  ctx: ExecutionContext,
  expectedVars: Record<string, string>
): void {
  Object.entries(expectedVars).forEach(([key, value]) => {
    expect(
      ctx.environmentVariables[key],
      `Environment variable "${key}" should be "${value}"`
    ).toBe(value)
  })
}
