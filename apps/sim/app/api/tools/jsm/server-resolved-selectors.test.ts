/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  resolveContext: vi.fn(),
  resolveAtlassianCredential: vi.fn(),
}))

vi.mock('@/lib/selectors/server/resolve-authorized-context', () => ({
  authenticateSelectorRequest: mocks.authenticate,
  resolveAuthorizedSelectorContext: mocks.resolveContext,
}))

vi.mock('@/lib/selectors/application/atlassian-credential', () => ({
  resolveAtlassianSelectorCredential: mocks.resolveAtlassianCredential,
}))

import { POST as listRequestTypes } from '@/app/api/tools/jsm/selector-requesttypes/route'
import { POST as listServiceDesks } from '@/app/api/tools/jsm/selector-servicedesks/route'

function request(path: string, body: unknown) {
  return createMockRequest('POST', body, {}, `http://localhost:3000${path}`)
}

describe('server-resolved JSM selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue({
      ok: true,
      principal: { type: 'session', userId: 'viewer-1' },
    })
    mocks.resolveContext.mockImplementation(
      async (_principal: unknown, input: { context: Record<string, unknown> }) => ({
        ok: true,
        context: { ...input.context, domain: 'resolved.example.com' },
        requesterUserId: 'viewer-1',
        workspaceId: 'workspace-1',
        credentialAccess: { credentialOwnerUserId: 'owner-1' },
      })
    )
    mocks.resolveAtlassianCredential.mockResolvedValue({
      accessToken: 'atlassian-token',
      cloudId: 'cloud-id-1',
    })
  })

  it('authenticates before parsing malformed requests', async () => {
    mocks.authenticate.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })

    const response = await listServiceDesks(request('/api/tools/jsm/selector-servicedesks', {}))

    expect(response.status).toBe(401)
    expect(mocks.resolveContext).not.toHaveBeenCalled()
  })

  it('short-circuits inaccessible references before credential or provider access', async () => {
    mocks.resolveContext.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'Unable to resolve selector configuration',
    })
    const providerFetch = vi.fn()
    vi.stubGlobal('fetch', providerFetch)

    const response = await listServiceDesks(
      request('/api/tools/jsm/selector-servicedesks', {
        credential: 'credential-1',
        workflowId: 'workflow-1',
        domain: '{{INACCESSIBLE_DOMAIN}}',
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Unable to resolve selector configuration',
    })
    expect(mocks.resolveAtlassianCredential).not.toHaveBeenCalled()
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it('preserves the raw domain reference and drains service-desk pagination', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            values: [{ id: '12', projectName: 'Support' }],
            isLastPage: false,
            _links: { next: 'next' },
          })
        )
        .mockResolvedValueOnce(
          Response.json({ values: [{ id: '13', projectName: 'IT' }], isLastPage: true })
        )
    )

    const response = await listServiceDesks(
      request('/api/tools/jsm/selector-servicedesks', {
        credential: 'credential-1',
        workflowId: 'workflow-1',
        domain: '{{SHARED_DOMAIN}}',
      })
    )

    expect(await response.json()).toEqual({
      serviceDesks: [
        { id: '12', name: 'Support' },
        { id: '13', name: 'IT' },
      ],
    })
    expect(mocks.resolveContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ context: { domain: '{{SHARED_DOMAIN}}' } })
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('start=1&limit=100'),
      expect.anything()
    )
  })

  it('supports workflowless credential-backed request-type selectors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ values: [{ id: '21', name: 'Incident' }], isLastPage: true })
        )
    )

    const response = await listRequestTypes(
      request('/api/tools/jsm/selector-requesttypes', {
        credential: 'credential-1',
        domain: 'tenant.atlassian.net',
        serviceDeskId: '12',
      })
    )

    expect(await response.json()).toEqual({ requestTypes: [{ id: '21', name: 'Incident' }] })
    expect(mocks.resolveContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workflowId: undefined, credentialId: 'credential-1' })
    )
    expect(mocks.resolveAtlassianCredential).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: 'jira' })
    )
  })

  it('maps provider failures without reading or returning provider bodies', async () => {
    const providerText = vi.fn().mockResolvedValue('provider-secret-marker')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 418, text: providerText })
    )

    const response = await listServiceDesks(
      request('/api/tools/jsm/selector-servicedesks', {
        credential: 'credential-1',
        workflowId: 'workflow-1',
        domain: 'tenant.atlassian.net',
      })
    )
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      error: 'Jira Service Management selector discovery failed.',
      status: 502,
    })
    expect(providerText).not.toHaveBeenCalled()
  })
})
