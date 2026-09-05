/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NarrativeOperationContext } from '@/lib/internal/oracle-epm-narrative-reporting/operations'
import { narrativeEndpoints } from '@/lib/internal/oracle-epm-narrative-reporting/routes'

const auth = {
  oauthCredential: 'credential',
  accessToken: 'dXNlcjpwYXNz',
  instanceUrl: 'https://epm.example.com',
}
const request = vi.fn()
const context = {
  client: { request, validateReturnedLink: vi.fn(), requestValidatedLink: vi.fn() },
  execution: { workflowId: 'workflow' },
  signal: new AbortController().signal,
} satisfies NarrativeOperationContext
beforeEach(() => vi.clearAllMocks())

import {
  getReport,
  listReports,
} from '@/lib/internal/oracle-epm-narrative-reporting/operations/reports'

describe('Narrative reports', () => {
  it('projects the documented collection without inventing pagination fields', async () => {
    request.mockResolvedValue({
      status: 200,
      data: { items: [{ reportId: 'native-id', name: 'Budget', links: [{ href: 'hidden' }] }] },
    })
    const result = await listReports({ ...auth, limit: 50, offset: 0 }, context)
    expect(result.output.reports[0]).toMatchObject({
      reportId: 'native-id',
      name: 'Budget',
      description: null,
    })
    expect(result.output.reports[0]).not.toHaveProperty('links')
    expect(result.output).not.toHaveProperty('hasMore')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('rejects malformed collection envelopes rather than reporting an empty list', async () => {
    request.mockResolvedValue({ status: 200, data: { reportId: 'native-id', name: 'Budget' } })
    await expect(listReports({ ...auth, limit: 50, offset: 0 }, context)).rejects.toMatchObject({
      category: 'invalid_response',
    })
  })
  it('uses the product-specific ID on its own get endpoint', async () => {
    request.mockResolvedValue({ status: 200, data: { reportId: 'native-id', name: 'Budget' } })
    const result = await getReport({ ...auth, resourceId: 'native-id' }, context)
    expect(result.output.report).toMatchObject({ reportId: 'native-id', name: 'Budget' })
    expect(request).toHaveBeenCalledExactlyOnceWith(
      narrativeEndpoints.getReport,
      expect.objectContaining({ pathParams: { id: 'native-id' }, signal: context.signal })
    )
  })
})

import {
  getReportGlobalPov,
  getReportPrompts,
} from '@/lib/internal/oracle-epm-narrative-reporting/operations/reports'

it('parses POV and prompt bare arrays, not collection envelopes', async () => {
  request.mockResolvedValueOnce({
    status: 200,
    data: [
      {
        dimensionId: 'dimension',
        name: 'Scenario',
        suggestedMembers: [{ memberId: 'm', name: 'Actual' }],
      },
    ],
  })
  const pov = await getReportGlobalPov({ ...auth, resourceId: 'r' }, context)
  expect(pov.output.dimensions[0]).toMatchObject({
    dimensionId: 'dimension',
    suggestedMembers: [{ memberId: 'm' }],
  })
  request.mockResolvedValueOnce({
    status: 200,
    data: [{ promptId: 'p', label: 'Year', allowMultipleSelections: false }],
  })
  expect(
    (await getReportPrompts({ ...auth, resourceId: 'r' }, context)).output.prompts[0]
  ).toMatchObject({ promptId: 'p', allowMultipleSelections: false })
  request.mockResolvedValueOnce({ status: 200, data: { items: [] } })
  await expect(getReportPrompts({ ...auth, resourceId: 'r' }, context)).rejects.toMatchObject({
    category: 'invalid_response',
  })
})
