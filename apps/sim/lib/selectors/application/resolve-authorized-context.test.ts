/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorizeCredential: vi.fn(),
  authorizeWorkspace: vi.fn(),
  getEnvironment: vi.fn(),
  loadWorkspace: vi.fn(),
  resolveWorkflow: vi.fn(),
}))

vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUseForAuth: mocks.authorizeCredential,
}))
vi.mock('@/lib/core/application', () => ({
  authorizeWorkspaceOperation: mocks.authorizeWorkspace,
  defineWorkspaceOperation: vi.fn((operation) => operation),
}))
vi.mock('@/lib/environment/utils', () => ({
  getEffectiveDecryptedEnv: mocks.getEnvironment,
}))
vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.resolveWorkflow,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))

import { resolveAuthorizedSelectorContextForPrincipal } from '@/lib/selectors/application/resolve-authorized-context'

const sessionPrincipal = {
  kind: 'session',
  userId: 'viewer-1',
  sessionId: 'session-1',
} as const
const delegatedPrincipal = {
  kind: 'delegated',
  service: 'executor',
  subjectUserId: 'viewer-1',
  delegationContext: { kind: 'workflow_execution', workflowId: 'workflow-1' },
} as never

describe('resolveAuthorizedSelectorContextForPrincipal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveWorkflow.mockResolvedValue({
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
    })
    mocks.loadWorkspace.mockResolvedValue({ workspaceId: 'workspace-1' })
    mocks.authorizeWorkspace.mockResolvedValue(undefined)
    mocks.authorizeCredential.mockResolvedValue({
      ok: true,
      workspaceId: 'workspace-1',
      credentialOwnerUserId: 'owner-1',
    })
    mocks.getEnvironment.mockResolvedValue({
      PERSONAL_DOMAIN: 'personal.example.com',
      SHARED_DOMAIN: 'shared.example.com',
      COLLISION: 'workspace-wins',
    })
  })

  it('passes literals through after workflow authorization', async () => {
    const result = await resolveAuthorizedSelectorContextForPrincipal(sessionPrincipal, {
      workflowId: 'workflow-1',
      context: { domain: 'literal.example.com' },
    })

    expect(result).toMatchObject({
      ok: true,
      requesterUserId: 'viewer-1',
      workspaceId: 'workspace-1',
      context: { domain: 'literal.example.com' },
    })
  })

  it.each([
    ['personal', '{{PERSONAL_DOMAIN}}', 'personal.example.com'],
    ['accessible workspace/shared', '{{SHARED_DOMAIN}}', 'shared.example.com'],
    ['workspace-over-personal effective value', '{{COLLISION}}', 'workspace-wins'],
  ])('resolves an exact %s reference', async (_label, reference, expected) => {
    const result = await resolveAuthorizedSelectorContextForPrincipal(sessionPrincipal, {
      workflowId: 'workflow-1',
      context: { arbitraryFutureField: reference },
    })

    expect(result).toMatchObject({ ok: true, context: { arbitraryFutureField: expected } })
  })

  it('does not interpolate embedded references', async () => {
    const result = await resolveAuthorizedSelectorContextForPrincipal(sessionPrincipal, {
      workflowId: 'workflow-1',
      context: { domain: 'https://{{SHARED_DOMAIN}}' },
    })

    expect(result).toMatchObject({
      ok: true,
      context: { domain: 'https://{{SHARED_DOMAIN}}' },
    })
  })

  it('makes missing and inaccessible references indistinguishable without plaintext leakage', async () => {
    const missing = await resolveAuthorizedSelectorContextForPrincipal(sessionPrincipal, {
      workflowId: 'workflow-1',
      context: { domain: '{{MISSING_DOMAIN}}' },
    })
    const inaccessible = await resolveAuthorizedSelectorContextForPrincipal(sessionPrincipal, {
      workflowId: 'workflow-1',
      context: { domain: '{{INACCESSIBLE_DOMAIN}}' },
    })

    expect(missing).toEqual(inaccessible)
    expect(missing).toEqual({
      ok: false,
      status: 400,
      error: 'Unable to resolve selector configuration',
    })
    expect(JSON.stringify(missing)).not.toContain('MISSING_DOMAIN')
    expect(JSON.stringify(inaccessible)).not.toContain('INACCESSIBLE_DOMAIN')
    expect(JSON.stringify(inaccessible)).not.toContain('shared.example.com')
  })

  it('rejects archived or unreadable workflows before environment access', async () => {
    mocks.resolveWorkflow.mockRejectedValue(new Error('Workflow is archived'))

    const result = await resolveAuthorizedSelectorContextForPrincipal(sessionPrincipal, {
      workflowId: 'workflow-1',
      context: { domain: '{{SHARED_DOMAIN}}' },
    })

    expect(result).toEqual({ ok: false, status: 403, error: 'Unauthorized' })
    expect(mocks.getEnvironment).not.toHaveBeenCalled()
  })

  it('requires credential use authorization in the canonical workflow workspace', async () => {
    mocks.authorizeCredential.mockResolvedValue({ ok: false, error: 'Credential not found' })

    const result = await resolveAuthorizedSelectorContextForPrincipal(sessionPrincipal, {
      workflowId: 'workflow-1',
      credentialId: 'credential-1',
      context: { domain: '{{SHARED_DOMAIN}}' },
    })

    expect(result).toEqual({ ok: false, status: 403, error: 'Credential not found' })
    expect(mocks.getEnvironment).not.toHaveBeenCalled()
  })

  it('rejects a credential authorized for a different workspace', async () => {
    mocks.authorizeCredential.mockResolvedValue({
      ok: true,
      workspaceId: 'workspace-2',
      credentialOwnerUserId: 'owner-1',
    })

    const result = await resolveAuthorizedSelectorContextForPrincipal(sessionPrincipal, {
      workflowId: 'workflow-1',
      credentialId: 'credential-1',
      context: { domain: '{{SHARED_DOMAIN}}' },
    })

    expect(result).toEqual({ ok: false, status: 403, error: 'Unauthorized' })
    expect(mocks.getEnvironment).not.toHaveBeenCalled()
  })

  it('allows a session knowledge connector to derive workspace scope from its credential', async () => {
    const result = await resolveAuthorizedSelectorContextForPrincipal(sessionPrincipal, {
      credentialId: 'credential-1',
      context: { domain: '{{SHARED_DOMAIN}}' },
    })

    expect(result).toMatchObject({
      ok: true,
      workspaceId: 'workspace-1',
      context: { domain: 'shared.example.com' },
    })
    expect(mocks.authorizeCredential).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'viewer-1' }),
      { credentialId: 'credential-1' }
    )
    expect(mocks.loadWorkspace).toHaveBeenCalledWith('workspace-1')
  })

  it('requires a workflow for workflowless direct-secret requests', async () => {
    const result = await resolveAuthorizedSelectorContextForPrincipal(sessionPrincipal, {
      context: { token: '{{SLACK_TOKEN}}' },
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Unable to resolve selector configuration',
    })
    expect(mocks.getEnvironment).not.toHaveBeenCalled()
  })

  it('does not permit delegated principals to derive workflowless credential scope', async () => {
    const result = await resolveAuthorizedSelectorContextForPrincipal(delegatedPrincipal, {
      credentialId: 'credential-1',
      context: {},
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Unable to resolve selector configuration',
    })
    expect(mocks.authorizeCredential).not.toHaveBeenCalled()
  })

  it('passes exact workflow scope to delegated authorization', async () => {
    await resolveAuthorizedSelectorContextForPrincipal(delegatedPrincipal, {
      workflowId: 'workflow-1',
      context: {},
    })

    const options = mocks.authorizeWorkspace.mock.calls[0][3]
    expect(options.delegation.audience).toBe('sim:selectors')
    expect(options.delegation.isWithinScope(delegatedPrincipal)).toBe(true)
    expect(
      options.delegation.isWithinScope({
        ...delegatedPrincipal,
        delegationContext: { kind: 'workflow_execution', workflowId: 'workflow-2' },
      })
    ).toBe(false)
  })
})
