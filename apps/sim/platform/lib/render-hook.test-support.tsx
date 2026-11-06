import { act, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot } from 'react-dom/client'

interface RenderedHook<T> {
  result: { current: T }
  queryClient: QueryClient
  /** Every URL the hook wrote, oldest first, as a query string. */
  urls: string[]
  rerender: () => Promise<void>
  unmount: () => Promise<void>
  container: HTMLElement
}

interface RenderHookOptions {
  /** The URL's query string at mount. */
  search?: string
  /** Rendered beside the probe, inside the same providers. */
  children?: ReactNode
}

const mounted = new Set<() => Promise<void>>()

/** Unmounts every hook still mounted, since hooks on one URL key hear each other across tests. */
export async function unmountDataHooks() {
  await Promise.all([...mounted].map((unmount) => unmount()))
}

/** Test support: mounts a hook under the query client and URL adapter the app's data hooks read. */
export async function renderDataHook<T>(
  useHook: () => T,
  { search = '', children }: RenderHookOptions = {}
): Promise<RenderedHook<T>> {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const result = { current: undefined as T }
  const urls: string[] = []

  function Probe() {
    result.current = useHook()
    return null
  }

  const render = () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <NuqsTestingAdapter
          searchParams={search}
          hasMemory
          onUrlUpdate={(event) => urls.push(event.queryString)}
        >
          <Probe />
          {children}
        </NuqsTestingAdapter>
      </QueryClientProvider>
    )

  const unmount = async () => {
    mounted.delete(unmount)
    await act(async () => root.unmount())
    container.remove()
  }
  mounted.add(unmount)
  await act(async () => render())
  return {
    result,
    queryClient,
    urls,
    container,
    rerender: () => act(async () => render()),
    unmount,
  }
}
