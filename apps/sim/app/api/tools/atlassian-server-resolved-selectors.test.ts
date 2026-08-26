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

import { POST as confluencePages } from '@/app/api/tools/confluence/selector-pages/route'
import { POST as jiraProject } from '@/app/api/tools/jira/projects/route'

const principal = {
  kind: 'session',
  userId: 'viewer-1',
  sessionId: 'session-1',
} as const

function request(path: string, body: unknown) {
  return createMockRequest(
    'POST',
    body,
    { 'content-type': 'application/json' },
    `http://localhost:3000${path}`
  )
}

describe('server-resolved Atlassian selector routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    mocks.authenticate.mockResolvedValue({ ok: true, principal })
    mocks.resolveContext.mockImplementation(
      async (_principal: unknown, input: { context: Record<string, unknown> }) => ({
        ok: true,
        context: { ...input.context, domain: 'resolved-secret.example.com' },
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

  it('authenticates before parsing a malformed request', async () => {
    mocks.authenticate.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })

    const response = await jiraProject(
      request('/api/tools/jira/projects', { definitely: 'not a Jira selector request' })
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mocks.resolveContext).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'Jira Project',
      route: jiraProject,
      path: '/api/tools/jira/projects',
      body: {
        credential: 'credential-1',
        workflowId: 'workflow-1',
        domain: '{{INACCESSIBLE_SECRET}}',
        projectId: 'SIM',
      },
    },
    {
      name: 'Confluence Page',
      route: confluencePages,
      path: '/api/tools/confluence/selector-pages',
      body: {
        credential: 'credential-1',
        workflowId: 'workflow-1',
        domain: '{{INACCESSIBLE_SECRET}}',
      },
    },
  ])('$name stops inaccessible references before provider access', async (testCase) => {
    mocks.resolveContext.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'Unable to resolve selector configuration',
    })
    const providerFetch = vi.fn()
    vi.stubGlobal('fetch', providerFetch)

    const response = await testCase.route(request(testCase.path, testCase.body))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Unable to resolve selector configuration' })
    expect(mocks.resolveAtlassianCredential).not.toHaveBeenCalled()
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it('maps Jira projects without exposing resolved provider data', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ id: '10001', name: 'Sim', self: 'https://resolved-secret.example.com' })
        )
    )

    const response = await jiraProject(
      request('/api/tools/jira/projects', {
        credential: 'credential-1',
        workflowId: 'workflow-1',
        domain: '{{DOMAIN}}',
        projectId: 'SIM',
      })
    )

    expect(await response.json()).toEqual({ project: { id: '10001', name: 'Sim' } })
  })

  it('maps Confluence pages without exposing resolved provider data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          results: [
            {
              id: '20001',
              title: 'Runbook',
              _links: { webui: 'https://resolved-secret.example.com/wiki/runbook' },
            },
          ],
        })
      )
    )

    const response = await confluencePages(
      request('/api/tools/confluence/selector-pages', {
        credential: 'credential-1',
        workflowId: 'workflow-1',
        domain: '{{DOMAIN}}',
      })
    )

    expect(await response.json()).toEqual({ files: [{ id: '20001', name: 'Runbook' }] })
  })

  it('maps provider failures to a stable public response without reading their body', async () => {
    const providerText = vi.fn().mockResolvedValue('provider-body-secret-marker')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 418, text: providerText })
    )

    const response = await jiraProject(
      request('/api/tools/jira/projects', {
        credential: 'credential-1',
        workflowId: 'workflow-1',
        domain: '{{DOMAIN}}',
        projectId: 'SIM',
      })
    )

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      error: 'Jira selector discovery failed.',
      status: 502,
    })
    expect(providerText).not.toHaveBeenCalled()
  })
})
