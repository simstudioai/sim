/**
 * @vitest-environment node
 */

import { serializePrincipal } from '@sim/auth/principal'
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
  it('round-trips a subject-bearing workflow execution delegation', async () => {
    const token = await generateInternalDelegationToken({
      subjectUserId: 'user-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      principal: {
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'user-1',
        workspaceId: 'workspace-1',
        delegationId: 'copilot-1',
        audience: 'sim:workflows',
        issuedAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: new Date('2026-01-01T00:05:00.000Z'),
      },
    })

    const delegation = await verifyInternalDelegationToken(token)

    expect(delegation).toMatchObject({
      serviceId: 'executor',
      subjectUserId: 'user-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      principal: expect.objectContaining({
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'user-1',
      }),
    })
    expect(delegation.delegationId).toBeTruthy()
    expect(delegation.issuedAt).toBeInstanceOf(Date)
    expect(delegation.expiresAt.getTime()).toBeGreaterThan(delegation.issuedAt.getTime())
  })

  it('round-trips an actorless workspace-key delegation without inventing a user', async () => {
    const token = await generateInternalDelegationToken({
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      principal: {
        kind: 'workspace_api_key',
        workspaceId: 'workspace-1',
        keyId: 'key-1',
      },
    })

    await expect(verifyInternalDelegationToken(token)).resolves.toMatchObject({
      serviceId: 'executor',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      principal: {
        kind: 'workspace_api_key',
        workspaceId: 'workspace-1',
        keyId: 'key-1',
      },
    })
    expect(decodeJwt(token).sub).toBeUndefined()
  })

  it('round-trips an external webhook subject without inventing a Sim user', async () => {
    const token = await generateInternalDelegationToken({
      workflowId: 'workflow-1',
      principal: {
        kind: 'system',
        serviceId: 'webhook',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        webhookId: 'webhook-1',
        provider: 'slack',
        subject: {
          kind: 'external_user',
          provider: 'slack',
          tenantId: 'T123',
          subjectId: 'U123',
        },
      },
    })

    const delegation = await verifyInternalDelegationToken(token)
    expect(delegation.subjectUserId).toBeUndefined()
    expect(delegation.principal).toMatchObject({
      kind: 'system',
      serviceId: 'webhook',
      subject: { kind: 'external_user', tenantId: 'T123', subjectId: 'U123' },
    })
  })

  it('round-trips the currently executing deployed workflow authority', async () => {
    const token = await generateInternalDelegationToken({
      subjectUserId: 'user-1',
      workflowId: 'root-workflow',
      executionId: 'execution-1',
      currentWorkflow: {
        workflowId: 'child-workflow',
        mode: 'deployment',
        deploymentVersionId: 'deployment-version-1',
      },
    })

    await expect(verifyInternalDelegationToken(token)).resolves.toMatchObject({
      workflowId: 'root-workflow',
      currentWorkflow: {
        workflowId: 'child-workflow',
        mode: 'deployment',
        deploymentVersionId: 'deployment-version-1',
      },
    })
  })

  it('refuses to issue current workflow authority without an execution binding', async () => {
    await expect(
      generateInternalDelegationToken({
        subjectUserId: 'user-1',
        workflowId: 'root-workflow',
        currentWorkflow: { workflowId: 'root-workflow', mode: 'draft' },
      })
    ).rejects.toThrow('Internal delegation currentWorkflow requires executionId')
  })

  it('rejects malformed workflow authority instead of dropping its fields', async () => {
    await expect(
      generateInternalDelegationToken({
        subjectUserId: 'user-1',
        workflowId: 'root-workflow',
        currentWorkflow: {
          workflowId: 'child-workflow',
          mode: 'draft',
          unexpected: true,
        } as never,
      })
    ).rejects.toBeInstanceOf(InvalidInternalDelegationTokenError)
  })

  it('round-trips an authenticated chat subject without inventing a Sim user', async () => {
    const token = await generateInternalDelegationToken({
      workflowId: 'workflow-1',
      principal: {
        kind: 'system',
        serviceId: 'chat',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        subject: { kind: 'authenticated_email', email: 'person@example.com' },
      },
    })

    await expect(verifyInternalDelegationToken(token)).resolves.toMatchObject({
      workflowId: 'workflow-1',
      principal: {
        kind: 'system',
        serviceId: 'chat',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        subject: { kind: 'authenticated_email', email: 'person@example.com' },
      },
    })
    expect(decodeJwt(token).sub).toBeUndefined()
  })

  it('rejects laundering actorless or non-Sim principals into a Sim user subject', async () => {
    await expect(
      generateInternalDelegationToken({
        subjectUserId: 'billing-owner',
        workflowId: 'workflow-1',
        principal: {
          kind: 'workspace_api_key',
          workspaceId: 'workspace-1',
          keyId: 'key-1',
        },
      })
    ).rejects.toThrow('Actorless workflow principals cannot be represented as Sim users')

    await expect(
      generateInternalDelegationToken({
        subjectUserId: 'billing-owner',
        workflowId: 'workflow-1',
        principal: {
          kind: 'system',
          serviceId: 'webhook',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          webhookId: 'webhook-1',
          provider: 'slack',
          subject: {
            kind: 'external_user',
            provider: 'slack',
            tenantId: 'T123',
            subjectId: 'U123',
          },
        },
      })
    ).rejects.toThrow('Non-Sim workflow subjects cannot be represented as Sim users')

    await expect(
      generateInternalDelegationToken({
        subjectUserId: 'unrelated-user',
        workflowId: 'workflow-1',
        principal: {
          kind: 'system',
          serviceId: 'chat',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          subject: { kind: 'authenticated_email', email: 'person@example.com' },
        },
      })
    ).rejects.toThrow('Non-Sim workflow subjects cannot be represented as Sim users')
  })

  it('rejects a signed delegation that pairs a non-Sim principal with a Sim user subject', async () => {
    const issuedAt = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({
      type: 'internal_delegation',
      serviceId: 'executor',
      workflowId: 'workflow-1',
      principal: serializePrincipal({
        kind: 'system',
        serviceId: 'chat',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        subject: { kind: 'authenticated_email', email: 'person@example.com' },
      }),
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
      subjectUserId: 'user-1',
      workflowId: 'workflow-1',
    })
    const payload = decodeJwt(token)

    if (typeof payload.exp !== 'number' || typeof payload.iat !== 'number') {
      throw new Error('Generated delegation token is missing numeric lifetime claims')
    }
    expect(payload.exp - payload.iat).toBe(5 * 60)
  })

  it('rejects missing delegation scope at issuance', async () => {
    await expect(
      generateInternalDelegationToken({
        subjectUserId: 'user-1',
        workflowId: ' ',
      })
    ).rejects.toThrow('Internal delegation workflowId must not be empty')
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
