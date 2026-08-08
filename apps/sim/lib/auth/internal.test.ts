/**
 * @vitest-environment node
 */

import { resetEnvMock } from '@sim/testing'
import { decodeJwt } from 'jose'
import { afterAll, describe, expect, it, vi } from 'vitest'

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
    })

    const delegation = await verifyInternalDelegationToken(token)

    expect(delegation).toMatchObject({
      serviceId: 'executor',
      subjectUserId: 'user-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })
    expect(delegation.delegationId).toBeTruthy()
    expect(delegation.issuedAt).toBeInstanceOf(Date)
    expect(delegation.expiresAt.getTime()).toBeGreaterThan(delegation.issuedAt.getTime())
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
