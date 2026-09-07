/**
 * @vitest-environment node
 */

import {
  bindPrincipalExecutionMetadata,
  enterPrincipalWorkflowExecution,
  serializePrincipal,
  type WorkflowExecutionPrincipal,
} from '@sim/auth/principal'
import { resetEnvMock } from '@sim/testing'
import { decodeJwt, SignJWT } from 'jose'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { env } from '@/lib/core/config/env'

vi.unmock('@/lib/auth/internal')

import {
  generateInternalDelegationToken,
  generateInternalToken,
  InvalidInternalDelegationTokenError,
  verifyInternalDelegationToken,
  verifyInternalToken,
} from '@/lib/auth/internal'

afterAll(resetEnvMock)

describe('internal JWT claims', () => {
  it('round-trips the trusted Mothership sandbox profile', async () => {
    const token = await generateInternalToken('user-1', { sandboxProfile: 'mothership' })

    await expect(verifyInternalToken(token)).resolves.toMatchObject({
      valid: true,
      userId: 'user-1',
      sandboxProfile: 'mothership',
    })
  })

  it('keeps ordinary internal tokens profile-free', async () => {
    const token = await generateInternalToken('user-1')

    await expect(verifyInternalToken(token)).resolves.toEqual({
      valid: true,
      userId: 'user-1',
    })
  })

  it('rejects unknown sandbox profiles instead of falling back to another image', async () => {
    const token = await generateInternalToken('user-1', {
      sandboxProfile: 'unknown-profile' as never,
    })

    await expect(verifyInternalToken(token)).resolves.toEqual({ valid: false })
  })
})

describe('internal executor delegation claims', () => {
  const cases: Array<{
    name: string
    principal: WorkflowExecutionPrincipal
    expectedSubject?: string
  }> = [
    {
      name: 'manual session',
      principal: { kind: 'session', userId: 'manual-user', sessionId: 'session-1' },
      expectedSubject: 'manual-user',
    },
    {
      name: 'personal API key',
      principal: { kind: 'personal_api_key', userId: 'key-user', keyId: 'personal-key-1' },
      expectedSubject: 'key-user',
    },
    {
      name: 'workspace API key',
      principal: { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-1' },
    },
    ...(['copilot', 'realtime'] as const).map((serviceId) => ({
      name: `${serviceId} delegation`,
      principal: {
        kind: 'delegated' as const,
        serviceId,
        subjectUserId: 'delegated-user',
        workspaceId: 'workspace-1',
        delegationId: 'delegation-1',
        audience: 'workflow-execution',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
      expectedSubject: 'delegated-user',
    })),
    {
      name: 'schedule',
      principal: {
        kind: 'system',
        serviceId: 'schedule',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
      },
    },
    {
      name: 'generic webhook',
      principal: {
        kind: 'system',
        serviceId: 'webhook',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        webhookId: 'webhook-generic',
        provider: 'generic',
      },
    },
    {
      name: 'Slack webhook',
      principal: {
        kind: 'system',
        serviceId: 'webhook',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        webhookId: 'webhook-slack',
        provider: 'slack',
        subject: {
          kind: 'external_user',
          provider: 'slack',
          tenantId: 'T123',
          subjectId: 'U123',
        },
      },
    },
    {
      name: 'deployed API',
      principal: {
        kind: 'system',
        serviceId: 'public_api',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
      },
    },
    {
      name: 'deployed chat',
      principal: {
        kind: 'system',
        serviceId: 'chat',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
      },
    },
  ]

  it.each(cases)('round-trips the $name runtime principal unchanged', async (testCase) => {
    const principal = bindPrincipalExecutionMetadata(testCase.principal, {
      executionId: 'execution-1',
      rootWorkflowId: 'workflow-1',
      currentWorkflow: { workflowId: 'workflow-1', mode: 'draft' },
    })
    const token = await generateInternalDelegationToken({ principal })
    const delegation = await verifyInternalDelegationToken(token)

    expect(delegation.principal).toEqual(principal)
    expect(decodeJwt(token).sub).toBe(testCase.expectedSubject)
    expect(delegation.delegationId).toBeTruthy()
    expect(delegation.issuedAt).toBeInstanceOf(Date)
    expect(delegation.expiresAt.getTime()).toBeGreaterThan(delegation.issuedAt.getTime())
  })

  it('keeps the original actor and root execution while entering a deployed child', async () => {
    const root = bindPrincipalExecutionMetadata(
      { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      {
        executionId: 'execution-1',
        rootWorkflowId: 'root-workflow',
        currentWorkflow: {
          workflowId: 'root-workflow',
          mode: 'deployment',
          deploymentVersionId: 'root-version-1',
        },
      }
    )
    const child = enterPrincipalWorkflowExecution(root, {
      workflowId: 'child-workflow',
      mode: 'deployment',
      deploymentVersionId: 'child-version-1',
    })
    const token = await generateInternalDelegationToken({ principal: child })

    await expect(verifyInternalDelegationToken(token)).resolves.toMatchObject({
      principal: {
        kind: 'session',
        userId: 'user-1',
        sessionId: 'session-1',
        executionMetadata: {
          executionId: 'execution-1',
          rootWorkflowId: 'root-workflow',
          currentWorkflow: {
            workflowId: 'child-workflow',
            mode: 'deployment',
            deploymentVersionId: 'child-version-1',
          },
        },
      },
    })
  })

  it('refuses to issue a delegation without execution metadata', async () => {
    await expect(
      generateInternalDelegationToken({
        principal: {
          kind: 'session',
          userId: 'user-1',
          sessionId: 'session-1',
        } as never,
      })
    ).rejects.toThrow('missing execution metadata')
  })

  it('rejects malformed workflow authority instead of dropping its fields', async () => {
    await expect(
      generateInternalDelegationToken({
        principal: {
          kind: 'session',
          userId: 'user-1',
          sessionId: 'session-1',
          executionMetadata: {
            executionId: 'execution-1',
            rootWorkflowId: 'workflow-1',
            currentWorkflow: {
              workflowId: 'workflow-1',
              mode: 'draft',
              unexpected: true,
            },
          },
        } as never,
      })
    ).rejects.toThrow('unsupported field unexpected')
  })

  it('round-trips an authenticated chat subject without inventing a Sim user', async () => {
    const principal = bindPrincipalExecutionMetadata(
      {
        kind: 'system',
        serviceId: 'chat',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        subject: { kind: 'authenticated_email', email: 'person@example.com' },
      },
      {
        executionId: 'execution-1',
        rootWorkflowId: 'workflow-1',
        currentWorkflow: { workflowId: 'workflow-1', mode: 'draft' },
      }
    )
    const token = await generateInternalDelegationToken({
      principal,
    })

    await expect(verifyInternalDelegationToken(token)).resolves.toMatchObject({
      principal,
    })
    expect(decodeJwt(token).sub).toBeUndefined()
  })

  it('rejects a signed delegation that pairs a non-Sim principal with a Sim user subject', async () => {
    const issuedAt = Math.floor(Date.now() / 1000)
    const principal = bindPrincipalExecutionMetadata(
      {
        kind: 'system',
        serviceId: 'chat',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        subject: { kind: 'authenticated_email', email: 'person@example.com' },
      },
      {
        executionId: 'execution-1',
        rootWorkflowId: 'workflow-1',
        currentWorkflow: { workflowId: 'workflow-1', mode: 'draft' },
      }
    )
    const token = await new SignJWT({
      type: 'internal_delegation',
      serviceId: 'executor',
      principal: serializePrincipal(principal, 2),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setJti('delegation-1')
      .setSubject('unrelated-user')
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 5 * 60)
      .setIssuer('sim-internal')
      .setAudience('sim-api')
      .sign(new TextEncoder().encode(env.INTERNAL_API_SECRET))

    await expect(verifyInternalDelegationToken(token)).rejects.toBeInstanceOf(
      InvalidInternalDelegationTokenError
    )
  })

  it('derives issued-at and expiry from one timestamp', async () => {
    const token = await generateInternalDelegationToken({
      principal: bindPrincipalExecutionMetadata(
        { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        {
          executionId: 'execution-1',
          rootWorkflowId: 'workflow-1',
          currentWorkflow: { workflowId: 'workflow-1', mode: 'draft' },
        }
      ),
    })
    const payload = decodeJwt(token)

    if (typeof payload.exp !== 'number' || typeof payload.iat !== 'number') {
      throw new Error('Generated delegation token is missing numeric lifetime claims')
    }
    expect(payload.exp - payload.iat).toBe(5 * 60)
  })

  it('does not accept legacy subject or actorless tokens as executor delegations', async () => {
    const legacySubjectToken = await generateInternalToken('user-1')
    const actorlessToken = await generateInternalToken()

    await expect(verifyInternalDelegationToken(legacySubjectToken)).rejects.toBeInstanceOf(
      InvalidInternalDelegationTokenError
    )
    await expect(verifyInternalDelegationToken(actorlessToken)).rejects.toBeInstanceOf(
      InvalidInternalDelegationTokenError
    )
  })
})
