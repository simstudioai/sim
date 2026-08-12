/**
 * @vitest-environment node
 */

import { resetEnvMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { MockInvalidBindingError, mockBindDelegation, mockGetSession } = vi.hoisted(() => {
  class MockInvalidBindingError extends Error {}
  return {
    MockInvalidBindingError,
    mockBindDelegation: vi.fn(),
    mockGetSession: vi.fn(),
  }
})

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/auth/internal-delegation', () => ({
  bindInternalExecutorDelegation: mockBindDelegation,
  InvalidInternalDelegationBindingError: MockInvalidBindingError,
}))
vi.unmock('@/lib/auth/internal')

import {
  InternalUnauthenticatedError,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { generateInternalDelegationToken, generateInternalToken } from '@/lib/auth/internal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { internalTableSessionOrExecutorAuth } from '@/lib/table/api'
import { v2TableErrorPolicies } from '@/lib/table/api/route-policies'

afterAll(resetEnvMock)

describe('internal Table route authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(null)
    mockBindDelegation.mockImplementation(async (delegation, options) => ({
      kind: 'delegated',
      serviceId: 'executor',
      subjectUserId: delegation.subjectUserId,
      workspaceId: 'canonical-workspace',
      delegationId: delegation.delegationId,
      audience: options.audience,
      issuedAt: delegation.issuedAt,
      expiresAt: delegation.expiresAt,
      resourceScope: options.resourceScope,
      delegationContext: {
        kind: 'workflow_execution',
        workflowId: delegation.workflowId,
        executionId: delegation.executionId,
      },
    }))
  })

  it('binds table scope to the current workflow without trusting route workspace input', async () => {
    const token = await generateInternalDelegationToken({
      subjectUserId: 'user-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })

    const principal = await internalTableSessionOrExecutorAuth.authenticate(
      new NextRequest('http://localhost/api/table/table-1/groups?workspaceId=forged-workspace', {
        headers: { authorization: `Bearer ${token}` },
      }),
      { tableId: 'table-1', workspaceId: 'forged-workspace' }
    )

    expect(principal).toMatchObject({
      kind: 'delegated',
      serviceId: 'executor',
      subjectUserId: 'user-1',
      workspaceId: 'canonical-workspace',
      audience: 'sim:tables',
      resourceScope: { tableId: 'table-1' },
      delegationContext: {
        kind: 'workflow_execution',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
    })
    expect(mockBindDelegation).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      }),
      { audience: 'sim:tables', resourceScope: { tableId: 'table-1' } }
    )
  })

  it('binds transfer resource routes as unscoped Table-domain principals', async () => {
    const token = await generateInternalDelegationToken({
      subjectUserId: 'user-1',
      workflowId: 'workflow-1',
    })

    await internalTableSessionOrExecutorAuth.authenticate(
      new NextRequest('http://localhost/api/table/imports/import-1', {
        headers: { authorization: `Bearer ${token}` },
      }),
      { importId: 'import-1' }
    )

    expect(mockBindDelegation).toHaveBeenCalledWith(expect.any(Object), {
      audience: 'sim:tables',
      resourceScope: undefined,
    })
  })

  it('rejects legacy actorless internal tokens before canonical binding', async () => {
    const token = await generateInternalToken()

    await expect(
      internalTableSessionOrExecutorAuth.authenticate(
        new NextRequest('http://localhost/api/table/table-1/groups', {
          headers: { authorization: `Bearer ${token}` },
        }),
        { tableId: 'table-1' }
      )
    ).rejects.toBeInstanceOf(InternalUnauthenticatedError)
    expect(mockBindDelegation).not.toHaveBeenCalled()
  })

  it('rejects a token whose current workflow binding no longer exists', async () => {
    const token = await generateInternalDelegationToken({
      subjectUserId: 'user-1',
      workflowId: 'workflow-1',
    })
    mockBindDelegation.mockRejectedValue(new MockInvalidBindingError())

    await expect(
      internalTableSessionOrExecutorAuth.authenticate(
        new NextRequest('http://localhost/api/table/table-1/groups', {
          headers: { authorization: `Bearer ${token}` },
        }),
        { tableId: 'table-1' }
      )
    ).rejects.toBeInstanceOf(InternalUnauthenticatedError)
  })

  it('propagates canonical-binding infrastructure failures', async () => {
    const token = await generateInternalDelegationToken({
      subjectUserId: 'user-1',
      workflowId: 'workflow-1',
    })
    const infrastructureError = new Error('database unavailable')
    mockBindDelegation.mockRejectedValue(infrastructureError)

    await expect(
      internalTableSessionOrExecutorAuth.authenticate(
        new NextRequest('http://localhost/api/table/table-1/groups', {
          headers: { authorization: `Bearer ${token}` },
        }),
        { tableId: 'table-1' }
      )
    ).rejects.toBe(infrastructureError)
  })

  it('preserves browser session principals when no executor token is supplied', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })

    await expect(
      internalTableSessionOrExecutorAuth.authenticate(
        new NextRequest('http://localhost/api/table/table-1/groups'),
        { tableId: 'table-1' }
      )
    ).resolves.toEqual({ kind: 'session', userId: 'user-1', sessionId: 'session-1' })
  })

  it('renders an invalid related workflow as 400 on internal and v2 surfaces', async () => {
    const error = new OrchestrationError('validation', 'Invalid workflow ID')

    expect(internalOrchestrationErrorPolicy.project(error)).toEqual({
      status: 400,
      body: { error: 'Invalid workflow ID' },
      headers: undefined,
    })
    const response = v2TableErrorPolicies.default.render(error)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'BAD_REQUEST', message: 'Invalid workflow ID' },
    })
  })
})
