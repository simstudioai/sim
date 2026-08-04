/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { SandboxValidationError } from '@/lib/api/contracts/sandboxes'
import { buildSpecOrResponse } from '@/app/api/workspaces/[id]/sandboxes/authorize'

describe('buildSpecOrResponse', () => {
  it('addresses dependency issues to the dependency editor', async () => {
    const result = buildSpecOrResponse('python', ['requests; rm -rf /'])

    expect(result.ok).toBe(false)
    if (!result.ok) {
      const body = (await result.response.json()) as SandboxValidationError
      expect(result.response.status).toBe(400)
      expect(body.issueField).toBe('dependencies')
      expect(body.issues).toEqual([
        expect.objectContaining({ line: 1, value: 'requests; rm -rf /' }),
      ])
    }
  })

  it('addresses system package issues to the system package editor', async () => {
    const result = buildSpecOrResponse('python', [], [], ['--allow-unauthenticated'])

    expect(result.ok).toBe(false)
    if (!result.ok) {
      const body = (await result.response.json()) as SandboxValidationError
      expect(result.response.status).toBe(400)
      expect(body.issueField).toBe('systemPackages')
      expect(body.issues).toEqual([
        expect.objectContaining({ line: 1, value: '--allow-unauthenticated' }),
      ])
    }
  })
})
