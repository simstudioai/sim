import { QueryClient, QueryObserver, queryOptions } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { prefetchQueryOnIntent } from '@/hooks/queries/utils/prefetch-query-on-intent'

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        retryOnMount: false,
      },
    },
  })
}

describe('prefetchQueryOnIntent', () => {
  it('removes an inactive speculative failure so a later mount can recover', async () => {
    const queryClient = createQueryClient()
    const queryFn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce('recovered')
    const options = queryOptions({
      queryKey: ['intent', 'recover'] as const,
      queryFn,
      staleTime: 60_000,
    })

    prefetchQueryOnIntent(queryClient, options)
    await vi.waitFor(() => expect(queryClient.getQueryState(options.queryKey)).toBeUndefined())

    await expect(queryClient.fetchQuery(options)).resolves.toBe('recovered')
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  it('preserves a failure once a real observer is mounted', async () => {
    const queryClient = createQueryClient()
    let rejectQuery: ((error: Error) => void) | undefined
    const queryFn = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(
        () =>
          new Promise<string>((_resolve, reject) => {
            rejectQuery = reject
          })
      )
      .mockResolvedValueOnce('recovered')
    const options = queryOptions({
      queryKey: ['intent', 'observed-error'] as const,
      queryFn,
      retryOnMount: true,
      staleTime: 60_000,
    })

    prefetchQueryOnIntent(queryClient, options)
    const observer = new QueryObserver(queryClient, options)
    const unsubscribe = observer.subscribe(() => undefined)
    rejectQuery?.(new Error('visible failure'))

    await vi.waitFor(() =>
      expect(queryClient.getQueryState(options.queryKey)?.status).toBe('error')
    )
    expect(observer.getCurrentResult().error?.message).toBe('visible failure')

    unsubscribe()

    const remountedObserver = new QueryObserver(queryClient, options)
    const unsubscribeRemount = remountedObserver.subscribe(() => undefined)
    await vi.waitFor(() => expect(remountedObserver.getCurrentResult().data).toBe('recovered'))
    expect(queryFn).toHaveBeenCalledTimes(2)
    unsubscribeRemount()
  })
})
