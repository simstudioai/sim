/**
 * @vitest-environment node
 */

import { resetEnvMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { MockInvalidBindingError, mockBindDelegationAdmission, mockGetSession } = vi.hoisted(() => {
  class MockInvalidBindingError extends Error {}
  return {
    MockInvalidBindingError,
    mockBindDelegationAdmission: vi.fn(),
    mockGetSession: vi.fn(),
  }
})

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/auth/internal-delegation', () => ({
  bindInternalExecutorDelegationAdmission: mockBindDelegationAdmission,
  InvalidInternalDelegationBindingError: MockInvalidBindingError,
}))
vi.unmock('@/lib/auth/internal')

import {
  InternalUnauthenticatedError,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { generateInternalDelegationToken, generateInternalToken } from '@/lib/auth/internal'
import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { internalTableSessionOrExecutorAuth } from '@/lib/table/api'
import { v2TableErrorPolicies } from '@/lib/table/api/route-policies'

afterAll(resetEnvMock)

describe('internal Table route authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(null)
    mockBindDelegationAdmission.mockImplementation(async (delegation) => ({
      principal: delegation.principal,
      workspaceId: 'canonical-workspace',
    }))
  })

  it('binds table scope to the current workflow without trusting route workspace input', async () => {
    const token = await generateInternalDelegationToken({
      principal: createTestRuntimePrincipal(),
    })

    const principal = await internalTableSessionOrExecutorAuth.authenticate(
      new NextRequest('http://localhost/api/table/table-1/groups?workspaceId=forged-workspace', {
        headers: { authorization: `Bearer ${token}` },
      }),
      { tableId: 'table-1', workspaceId: 'forged-workspace' }
    )

    expect(principal).toMatchObject({
      kind: 'session',
      userId: 'user-1',
      sessionId: 'session-1',
      executionMetadata: {
        executionId: 'execution-1',
        rootWorkflowId: 'workflow-1',
        currentWorkflow: { workflowId: 'workflow-1', mode: 'draft' },
      },
    })
    expect(mockBindDelegationAdmission).toHaveBeenCalledWith(
      expect.objectContaining({ principal: expect.objectContaining({ kind: 'session' }) })
    )
  })

  it('binds transfer resource routes as unscoped Table-domain principals', async () => {
    const token = await generateInternalDelegationToken({
      principal: createTestRuntimePrincipal(),
    })

    await internalTableSessionOrExecutorAuth.authenticate(
      new NextRequest('http://localhost/api/table/imports/import-1', {
        headers: { authorization: `Bearer ${token}` },
      }),
      { importId: 'import-1' }
    )

    expect(mockBindDelegationAdmission).toHaveBeenCalledOnce()
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
    expect(mockBindDelegationAdmission).not.toHaveBeenCalled()
  })

  it('rejects a token whose current workflow binding no longer exists', async () => {
    const token = await generateInternalDelegationToken({
      principal: createTestRuntimePrincipal(),
    })
    mockBindDelegationAdmission.mockRejectedValue(new MockInvalidBindingError())

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
      principal: createTestRuntimePrincipal(),
    })
    const infrastructureError = new Error('database unavailable')
    mockBindDelegationAdmission.mockRejectedValue(infrastructureError)

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
