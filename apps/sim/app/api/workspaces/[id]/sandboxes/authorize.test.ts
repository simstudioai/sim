/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { SandboxValidationError } from '@/lib/api/contracts/sandboxes'
import {
  SandboxDependencyError,
  SandboxSystemPackageError,
} from '@/lib/execution/remote-sandbox/workspace-sandboxes'
import { sandboxMutationErrorResponse } from '@/app/api/workspaces/[id]/sandboxes/authorize'

describe('sandboxMutationErrorResponse', () => {
  it('addresses dependency issues to the dependency editor', async () => {
    const response = sandboxMutationErrorResponse(
      new SandboxDependencyError([
        { line: 1, value: 'requests; rm -rf /', reason: 'Invalid dependency' },
      ])
    )

    expect(response).not.toBeNull()
    const body = (await response!.json()) as SandboxValidationError
    expect(response!.status).toBe(400)
    expect(body.issueField).toBe('dependencies')
    expect(body.issues).toEqual([expect.objectContaining({ line: 1, value: 'requests; rm -rf /' })])
  })

  it('addresses system package issues to the system package editor', async () => {
    const response = sandboxMutationErrorResponse(
      new SandboxSystemPackageError([
        {
          line: 1,
          value: '--allow-unauthenticated',
          reason: 'Invalid system package',
        },
      ])
    )

    expect(response).not.toBeNull()
    const body = (await response!.json()) as SandboxValidationError
    expect(response!.status).toBe(400)
    expect(body.issueField).toBe('systemPackages')
    expect(body.issues).toEqual([
      expect.objectContaining({ line: 1, value: '--allow-unauthenticated' }),
    ])
  })
})
