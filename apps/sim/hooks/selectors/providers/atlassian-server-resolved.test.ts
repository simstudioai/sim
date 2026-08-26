/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requestJson: vi.fn() }))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.requestJson }))

import { confluenceSelectors } from '@/hooks/selectors/providers/confluence/selectors'
import { jiraSelectors } from '@/hooks/selectors/providers/jira/selectors'

describe('server-resolved Atlassian selector providers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opts Jira and Confluence into only the domain context field', () => {
    expect(jiraSelectors['jira.projects'].serverResolvedContextFields).toEqual(['domain'])
    expect(jiraSelectors['jira.issues'].serverResolvedContextFields).toEqual(['domain'])
    expect(confluenceSelectors['confluence.spaces'].serverResolvedContextFields).toEqual(['domain'])
    expect(confluenceSelectors['confluence.pages'].serverResolvedContextFields).toEqual(['domain'])
  })

  it('keeps literal domains out of Jira and Confluence base query keys', () => {
    const context = {
      oauthCredential: 'credential-1',
      domain: 'private-tenant.atlassian.net',
    }
    const keys = [
      jiraSelectors['jira.projects'].getQueryKey!({ key: 'jira.projects', context }),
      confluenceSelectors['confluence.pages'].getQueryKey!({ key: 'confluence.pages', context }),
    ]

    expect(JSON.stringify(keys)).not.toContain(context.domain)
  })

  it('sends a raw Jira domain reference to the authorized selector route', async () => {
    mocks.requestJson.mockResolvedValue({ projects: [] })

    await jiraSelectors['jira.projects'].fetchList!({
      key: 'jira.projects',
      context: {
        workflowId: 'workflow-1',
        oauthCredential: 'credential-1',
        domain: '{{SHARED_DOMAIN}}',
      },
    })

    expect(mocks.requestJson).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        query: {
          credential: 'credential-1',
          workflowId: 'workflow-1',
          domain: '{{SHARED_DOMAIN}}',
          query: undefined,
        },
      })
    )
  })

  it('uses the dedicated Confluence page selector route without browser OAuth tokens', async () => {
    mocks.requestJson.mockResolvedValue({ files: [] })

    await confluenceSelectors['confluence.pages'].fetchList!({
      key: 'confluence.pages',
      context: {
        workflowId: 'workflow-1',
        oauthCredential: 'credential-1',
        domain: '{{PERSONAL_DOMAIN}}',
      },
    })

    const [, input] = mocks.requestJson.mock.calls[0]
    expect(input.body).toEqual({
      credential: 'credential-1',
      workflowId: 'workflow-1',
      domain: '{{PERSONAL_DOMAIN}}',
      title: undefined,
    })
    expect(input.body).not.toHaveProperty('accessToken')
  })

  it.each([
    ['Jira', jiraSelectors['jira.projects']],
    ['Confluence', confluenceSelectors['confluence.spaces']],
  ])('keeps workflowless %s credential connector selectors enabled', (_label, definition) => {
    expect(
      definition.enabled?.({
        key: definition.key,
        context: {
          workspaceId: 'workspace-1',
          oauthCredential: 'credential-1',
          domain: 'tenant.atlassian.net',
        },
      })
    ).toBe(true)
  })

  it('sends workflowless credential-backed Jira and Confluence requests', async () => {
    mocks.requestJson
      .mockResolvedValueOnce({ projects: [{ id: '10001', name: 'Sim' }] })
      .mockResolvedValueOnce({ spaces: [{ key: 'SPACE', name: 'Docs' }] })

    const context = {
      workspaceId: 'workspace-1',
      oauthCredential: 'credential-1',
      domain: 'tenant.atlassian.net',
    }
    const jira = await jiraSelectors['jira.projects'].fetchList!({ key: 'jira.projects', context })
    const confluence = await confluenceSelectors['confluence.spaces'].fetchPage!({
      key: 'confluence.spaces',
      context,
    })

    expect(jira).toEqual([{ id: '10001', label: 'Sim' }])
    expect(confluence.items).toEqual([{ id: 'SPACE', label: 'Docs (SPACE)' }])
    for (const [, input] of mocks.requestJson.mock.calls) {
      const requestValues = (input.body ?? input.query) as Record<string, unknown>
      expect(requestValues.credential).toBe('credential-1')
      expect(requestValues).not.toHaveProperty('workflowId')
    }
  })
})
