import {
  knowledgeSecureFetchMock,
  knowledgeSecureFetchMockFns,
} from '@sim/testing/mocks/knowledge-secure-fetch.mock'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/documents/secure-fetch.server', () => knowledgeSecureFetchMock)

import { OutboundRoutingError } from '@/lib/core/network/routing'
import { EGRESS_UNAVAILABLE_MESSAGE } from '@/lib/core/orchestration/types'
import { prepareGitLabPermissionChange } from '@/connectors/gitlab/permission-config/prepare'

const fetchSource = knowledgeSecureFetchMockFns.mockSecureFetchWithRetry
const input = {
  connectorType: 'gitlab',
  accessMode: 'admin',
  sourceConfig: { host: 'gitlab.example.com', project: 'group/project' },
  apiKey: 'test-private-token',
}

describe('GitLab setup failures', () => {
  it.each([
    { operation: 'account', status: 401, action: /token.*read_api/i },
    { operation: 'account', status: 404, action: /host.*API access/i },
    { operation: 'project', status: 403, action: /read_api.*access.*IP restrictions/i },
    { operation: 'project', status: 404, action: /project ID.*token access.*IP restrictions/i },
  ])(
    'identifies a $status during the $operation check without exposing provider content',
    async ({ operation, status, action }) => {
      if (operation === 'project') {
        fetchSource.mockResolvedValueOnce(Response.json({ id: 1, state: 'active' }))
      }
      fetchSource.mockResolvedValueOnce(
        new Response('Private upstream error page', {
          status,
          headers: { 'x-request-id': '01JEXAMPLECORRELATION' },
        })
      )

      const result = prepareGitLabPermissionChange(input)
      await expect(result).rejects.toMatchObject({
        code: 'validation',
        message: expect.stringMatching(action),
      })
      await expect(result).rejects.toMatchObject({
        message: expect.not.stringMatching(
          /test-private-token|Private upstream|group\/project|gitlab\.example/
        ),
      })
      const logs = getMockLogger('GitLabPermissions').warn.mock.calls
      expect(logs).toEqual([
        [
          'GitLab permission read failed',
          {
            operation,
            status,
            providerRequestId: '01JEXAMPLECORRELATION',
          },
        ],
      ])
      expect(fetchSource).toHaveBeenCalledTimes(operation === 'project' ? 2 : 1)
    }
  )

  it.each([undefined, 'untrusted header text', 'x'.repeat(129)])(
    'omits absent or unsafe upstream correlation IDs (%s)',
    async (requestId) => {
      fetchSource.mockResolvedValueOnce(
        new Response(null, {
          status: 404,
          headers: requestId ? { 'x-request-id': requestId } : undefined,
        })
      )
      await expect(prepareGitLabPermissionChange(input)).rejects.toThrow()
      expect(getMockLogger('GitLabPermissions').warn).toHaveBeenCalledWith(
        'GitLab permission read failed',
        { operation: 'account', status: 404 }
      )
    }
  )

  it('preserves an egress outage instead of blaming the GitLab credential', async () => {
    fetchSource.mockRejectedValueOnce(new OutboundRoutingError('GATEWAY_UNAVAILABLE'))
    await expect(prepareGitLabPermissionChange(input)).rejects.toMatchObject({
      code: 'unavailable',
      message: EGRESS_UNAVAILABLE_MESSAGE,
    })
  })

  it('keeps a missing internal routing scope out of GitLab validation errors', async () => {
    const error = new OutboundRoutingError('MISSING_SCOPE')
    fetchSource.mockRejectedValueOnce(error)
    await expect(prepareGitLabPermissionChange(input)).rejects.toBe(error)
  })
})
