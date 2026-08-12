import { describe, expect, it } from 'vitest'
import { deploymentVersionOrActiveParamsSchema } from '@/lib/api/contracts/deployments'

describe('deployment version route params', () => {
  it('coerces numeric path params from the server boundary', () => {
    expect(deploymentVersionOrActiveParamsSchema.parse({ id: 'workflow-1', version: '1' })).toEqual(
      { id: 'workflow-1', version: 1 }
    )
  })

  it('retains the active deployment alias', () => {
    expect(
      deploymentVersionOrActiveParamsSchema.parse({ id: 'workflow-1', version: 'active' })
    ).toEqual({ id: 'workflow-1', version: 'active' })
  })

  it.each(['0', '-1', '1.5', 'not-a-version'])('rejects invalid path version %s', (version) => {
    expect(
      deploymentVersionOrActiveParamsSchema.safeParse({ id: 'workflow-1', version }).success
    ).toBe(false)
  })
})
