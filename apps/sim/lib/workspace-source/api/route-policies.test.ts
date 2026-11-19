/**
 * @vitest-environment node
 */
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { generateId } from '@sim/utils/id'
import { describe, expect, it } from 'vitest'
import {
  v2WorkspaceSourceErrorPolicy,
  withSourceSlot,
} from '@/lib/workspace-source/api/route-policies'
import { workspaceSourceOperations } from '@/lib/workspace-source/application/operations'

const principal = createSessionPrincipal({ userId: generateId(), sessionId: generateId() })

/** A source use case whose every run waits until `finish` is called. */
function blockingUseCase() {
  const waiting: Array<() => void> = []
  const useCase = {
    operation: workspaceSourceOperations.apply,
    authorize: async () => {},
    execute: () => new Promise<string>((resolve) => waiting.push(() => resolve('done'))),
  }
  return {
    useCase,
    finishOne() {
      waiting.shift()?.()
    },
  }
}

/** The response the source routes answer `run`'s failure with. */
async function refusalOf(run: Promise<unknown>) {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught
  )
  return v2WorkspaceSourceErrorPolicy.render(error)
}

describe('withSourceSlot', () => {
  it('refuses the request past a lane’s slots with 429 and Retry-After, and admits one once a slot frees', async () => {
    const applies = blockingUseCase()
    const apply = withSourceSlot(applies.useCase, 'apply')
    const reads = blockingUseCase()
    const read = withSourceSlot(reads.useCase, 'read')
    const running = Array.from({ length: 4 }, () => apply.execute({ principal, input: {} }))

    const refused = await refusalOf(apply.execute({ principal, input: {} }))
    expect(refused?.status).toBe(429)
    expect(refused?.headers.get('Retry-After')).toBe('5')

    // The read lane has slots of its own.
    const reading = read.execute({ principal, input: {} })
    reads.finishOne()
    await expect(reading).resolves.toBe('done')

    applies.finishOne()
    await running[0]
    const admitted = apply.execute({ principal, input: {} })
    for (let finished = 0; finished < 4; finished += 1) applies.finishOne()
    await expect(Promise.all([...running, admitted])).resolves.toHaveLength(5)
  })
})
