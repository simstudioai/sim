/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  deploymentVersionOrActiveParamsSchema,
  deploymentVersionParamsSchema,
} from '@/lib/api/contracts/deployments'

/**
 * Next.js route params are always strings. A version schema that accepts a bare
 * `z.number()` therefore rejects every real request — `/deployments/1/revert`
 * 400s and only the `'active'` literal remains reachable, which is invisible to
 * type-checking because the client passes a genuine `number` that only becomes
 * a string during URL serialization.
 */
describe('deployment version route params', () => {
  describe('deploymentVersionOrActiveParamsSchema', () => {
    it('accepts a numeric version arriving as a path string', () => {
      const parsed = deploymentVersionOrActiveParamsSchema.parse({ id: 'wf-1', version: '3' })
      expect(parsed.version).toBe(3)
    })

    it('accepts the active literal', () => {
      const parsed = deploymentVersionOrActiveParamsSchema.parse({ id: 'wf-1', version: 'active' })
      expect(parsed.version).toBe('active')
    })

    it('still accepts a real number', () => {
      const parsed = deploymentVersionOrActiveParamsSchema.parse({ id: 'wf-1', version: 3 })
      expect(parsed.version).toBe(3)
    })

    it.each(['notanumber', '0', '-1', '1.5', ''])('rejects %o', (version) => {
      expect(() => deploymentVersionOrActiveParamsSchema.parse({ id: 'wf-1', version })).toThrow()
    })
  })

  describe('deploymentVersionParamsSchema', () => {
    it('coerces a numeric path string', () => {
      expect(deploymentVersionParamsSchema.parse({ id: 'wf-1', version: '7' }).version).toBe(7)
    })

    it('rejects the active literal, which this route does not serve', () => {
      expect(() => deploymentVersionParamsSchema.parse({ id: 'wf-1', version: 'active' })).toThrow()
    })
  })
})
