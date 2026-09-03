/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = vi.fn()
    checkRateLimitDirectOrThrow = vi.fn()
  },
  enforceUserRateLimit: vi.fn(),
  getRateLimit: vi.fn(),
}))
vi.mock('@/lib/execution/remote-sandbox/workspace-sandboxes', async () => {
  const { OrchestrationError } = await import('@/lib/core/orchestration/types')
  class SandboxDependencyError extends OrchestrationError {
    constructor(readonly issues: { line: number; value: string; reason: string }[]) {
      super('validation', issues[0]?.reason ?? 'Invalid dependency list')
    }
  }
  class SandboxSystemPackageError extends OrchestrationError {
    constructor(readonly issues: { line: number; value: string; reason: string }[]) {
      super('validation', issues[0]?.reason ?? 'Invalid system package list')
    }
  }
  return {
    SANDBOX_MUTATION_LIMIT: { maxTokens: 20, refillRate: 10, refillIntervalMs: 60_000 },
    SandboxDependencyError,
    SandboxSystemPackageError,
  }
})

import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  SandboxDependencyError,
  SandboxSystemPackageError,
} from '@/lib/execution/remote-sandbox/workspace-sandboxes'
import { SandboxBuildBudgetExceededError } from '@/lib/sandboxes/application/build-budget'
import {
  internalSandboxErrorPolicy,
  internalSandboxResourceErrorPolicy,
} from '@/app/api/workspaces/[id]/sandboxes/error-policy'

const ISSUE = { line: 2, value: 'not a package!', reason: 'invalid package name' }

describe('internal sandbox error policy', () => {
  /**
   * The editor marks the submitted row from `issueField` + `issues`, so the
   * body is the one the route-local authorizer used to build, field for field.
   */
  it('addresses a refused dependency line to its field and row', () => {
    const descriptor = internalSandboxErrorPolicy.project(new SandboxDependencyError([ISSUE]))

    expect(descriptor).toEqual({
      status: 400,
      body: { error: 'invalid package name', issueField: 'dependencies', issues: [ISSUE] },
      headers: undefined,
    })
  })

  it('addresses a refused system package the same way', () => {
    const descriptor = internalSandboxErrorPolicy.project(new SandboxSystemPackageError([ISSUE]))

    expect(descriptor).toMatchObject({
      status: 400,
      body: { issueField: 'systemPackages', issues: [ISSUE] },
    })
  })

  it('finds the refusal behind a wrapping query error', () => {
    const wrapped = new Error('Failed query', { cause: new SandboxDependencyError([ISSUE]) })

    expect(internalSandboxErrorPolicy.project(wrapped)).toMatchObject({ status: 400 })
  })

  it('keeps the legacy 429 body and headers for a spent build budget', () => {
    const resetAt = new Date(Date.now() + 30_000)
    const descriptor = internalSandboxErrorPolicy.project(
      new SandboxBuildBudgetExceededError(resetAt, 30_000)
    )

    expect(descriptor).toEqual({
      status: 429,
      body: { error: 'Rate limit exceeded', retryAfter: resetAt.getTime() },
      headers: { 'Retry-After': '30', 'X-RateLimit-Reset': resetAt.toISOString() },
    })
  })

  it('projects a name collision as a conflict', () => {
    const descriptor = internalSandboxErrorPolicy.project(
      new OrchestrationError('conflict', 'A sandbox named "x" already exists in this workspace')
    )

    expect(descriptor).toMatchObject({
      status: 409,
      body: { error: 'A sandbox named "x" already exists in this workspace' },
    })
  })

  it('leaves an unclassified failure to the generic 500', () => {
    expect(internalSandboxErrorPolicy.project(new Error('pg down'))).toBeNull()
  })

  /**
   * A caller with no reach into the workspace learns nothing from an item
   * route, while a member whose role is too low keeps the actionable 403.
   */
  it('conceals a cross-tenant refusal on item routes as a missing sandbox', () => {
    expect(internalSandboxResourceErrorPolicy.project(new NoWorkspaceAccessError())).toMatchObject({
      status: 404,
      body: { error: 'Sandbox not found' },
    })
    expect(
      internalSandboxResourceErrorPolicy.project(new InsufficientWorkspacePermissionsError())
    ).toMatchObject({ status: 403 })
  })

  /**
   * A missing workspace and a workspace the caller cannot reach are both a
   * missing sandbox on item routes; a distinct message would tell a probe which
   * workspace ids exist. The collection policy keeps the specific message.
   */
  it('answers a missing workspace on item routes as a missing sandbox', () => {
    const missingWorkspace = new OrchestrationError('not_found', 'Workspace not found')

    expect(internalSandboxResourceErrorPolicy.project(missingWorkspace)).toMatchObject({
      status: 404,
      body: { error: 'Sandbox not found' },
    })
    expect(internalSandboxErrorPolicy.project(missingWorkspace)).toMatchObject({
      status: 404,
      body: { error: 'Workspace not found' },
    })
  })
})
