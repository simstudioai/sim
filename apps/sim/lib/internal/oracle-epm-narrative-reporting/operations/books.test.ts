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

import { getBook, listBooks } from '@/lib/internal/oracle-epm-narrative-reporting/operations/books'

describe('Narrative books', () => {
  it('projects the documented collection without inventing pagination fields', async () => {
    request.mockResolvedValue({
      status: 200,
      data: { items: [{ bookId: 'native-id', name: 'Budget', links: [{ href: 'hidden' }] }] },
    })
    const result = await listBooks({ ...auth, limit: 50, offset: 0 }, context)
    expect(result.output.books[0]).toMatchObject({
      bookId: 'native-id',
      name: 'Budget',
      description: null,
    })
    expect(result.output.books[0]).not.toHaveProperty('links')
    expect(request.mock.calls[0][1].query.fields.split(',').sort()).toEqual(
      Object.keys(result.output.books[0]).sort()
    )
    expect(result.output).not.toHaveProperty('hasMore')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('rejects malformed collection envelopes rather than reporting an empty list', async () => {
    request.mockResolvedValue({ status: 200, data: { bookId: 'native-id', name: 'Budget' } })
    await expect(listBooks({ ...auth, limit: 50, offset: 0 }, context)).rejects.toMatchObject({
      category: 'invalid_response',
    })
  })
  it('uses the product-specific ID on its own get endpoint', async () => {
    request.mockResolvedValue({ status: 200, data: { bookId: 'native-id', name: 'Budget' } })
    const result = await getBook({ ...auth, resourceId: 'native-id' }, context)
    expect(result.output.book).toMatchObject({ bookId: 'native-id', name: 'Budget' })
    expect(request.mock.calls[0][1].query.fields.split(',').sort()).toEqual(
      Object.keys(result.output.book).sort()
    )
    expect(request).toHaveBeenCalledExactlyOnceWith(
      narrativeEndpoints.getBook,
      expect.objectContaining({ pathParams: { id: 'native-id' }, signal: context.signal })
    )
  })
})
