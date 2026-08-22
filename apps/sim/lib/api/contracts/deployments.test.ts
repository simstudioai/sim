import { describe, expect, it } from 'vitest'
import {
  DEPLOYMENT_VERSION_MAX,
  deploymentVersionOrActiveParamsSchema,
  deploymentVersionParamsSchema,
} from '@/lib/api/contracts/deployments'

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

  /**
   * `workflow_deployment_version.version` is a Postgres `integer`. A larger
   * value has no row to miss — it overflows the comparison, which surfaces as
   * an unclassifiable 500 on a request the caller could have been told was bad.
   */
  it.each([deploymentVersionParamsSchema, deploymentVersionOrActiveParamsSchema])(
    'bounds the path version to the integer column range',
    (schema) => {
      expect(
        schema.safeParse({ id: 'workflow-1', version: String(DEPLOYMENT_VERSION_MAX) }).success
      ).toBe(true)
      expect(
        schema.safeParse({ id: 'workflow-1', version: String(DEPLOYMENT_VERSION_MAX + 1) }).success
      ).toBe(false)
    }
  )
})
