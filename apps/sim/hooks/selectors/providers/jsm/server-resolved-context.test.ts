/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requestJson: vi.fn() }))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.requestJson }))

import { jsmSelectors } from '@/hooks/selectors/providers/jsm/selectors'

describe('JSM server-resolved selector context', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opts both selectors into server-resolved domain handling', () => {
    expect(jsmSelectors['jsm.serviceDesks'].serverResolvedContextFields).toEqual(['domain'])
    expect(jsmSelectors['jsm.requestTypes'].serverResolvedContextFields).toEqual(['domain'])
  })

  it('keeps literal domains out of JSM base query keys', () => {
    const context = {
      oauthCredential: 'credential-1',
      domain: 'private-tenant.atlassian.net',
      serviceDeskId: '12',
    }
    const keys = [
      jsmSelectors['jsm.serviceDesks'].getQueryKey!({ key: 'jsm.serviceDesks', context }),
      jsmSelectors['jsm.requestTypes'].getQueryKey!({ key: 'jsm.requestTypes', context }),
    ]

    expect(JSON.stringify(keys)).not.toContain(context.domain)
  })

  it('forwards a raw reference and maps options', async () => {
    mocks.requestJson.mockResolvedValue({ serviceDesks: [{ id: '12', name: 'Support' }] })

    const options = await jsmSelectors['jsm.serviceDesks'].fetchList!({
      key: 'jsm.serviceDesks',
      context: {
        workflowId: 'workflow-1',
        oauthCredential: 'credential-1',
        domain: '{{SHARED_DOMAIN}}',
      },
    })

    expect(options).toEqual([{ id: '12', label: 'Support' }])
    expect(mocks.requestJson.mock.calls[0][1].body).toEqual({
      credential: 'credential-1',
      workflowId: 'workflow-1',
      domain: '{{SHARED_DOMAIN}}',
    })
  })

  it('keeps workflowless knowledge-connector selectors enabled', async () => {
    const definition = jsmSelectors['jsm.serviceDesks']
    const context = {
      workspaceId: 'workspace-1',
      oauthCredential: 'credential-1',
      domain: 'tenant.atlassian.net',
    }

    expect(definition.enabled?.({ key: 'jsm.serviceDesks', context })).toBe(true)
    mocks.requestJson.mockResolvedValue({ serviceDesks: [] })
    await definition.fetchList!({ key: 'jsm.serviceDesks', context })
    expect(mocks.requestJson.mock.calls[0][1].body).not.toHaveProperty('workflowId')
  })
})
