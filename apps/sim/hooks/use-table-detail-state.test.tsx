/**
 * @vitest-environment jsdom
 *
 * The panel must never write the table's sort/view keys into its host page's
 * address bar. Before this hook, `useQueryStates` was called unconditionally and
 * all eleven writers ran in both hosts — the `view` -> `table-view` wire-key
 * rename exists precisely because the mothership bound these parsers to `/home`.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { setUrlState, urlState } = vi.hoisted(() => ({
  setUrlState: vi.fn(),
  urlState: { current: { sort: null as string | null, dir: 'asc', view: null as string | null } },
}))

vi.mock('nuqs', () => ({
  useQueryStates: () => [urlState.current, setUrlState],
}))

import {
  type TableDetailState,
  type TableDetailUpdate,
  useTableDetailState,
} from '@/hooks/use-table-detail-state'
import type { ResourceHost } from '@/resources'

let container: HTMLDivElement
let root: Root
let latest: [TableDetailState, (update: TableDetailUpdate) => void] | null = null

function Probe({ host }: { host: ResourceHost }) {
  latest = useTableDetailState({ host })
  return null
}

function render(host: ResourceHost) {
  act(() => root.render(<Probe host={host} />))
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  urlState.current = { sort: null, dir: 'asc', view: null }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('a host that owns the URL', () => {
  it('reads the query params', () => {
    urlState.current = { sort: 'name', dir: 'desc', view: 'view_1' }
    render('page')

    expect(latest?.[0]).toEqual({ sort: 'name', dir: 'desc', view: 'view_1' })
  })

  it('writes through to nuqs', () => {
    render('page')

    act(() => latest?.[1]({ sort: 'name', dir: 'desc' }))

    expect(setUrlState).toHaveBeenCalledWith({ sort: 'name', dir: 'desc' })
  })
})

describe('an embedded host', () => {
  it('never writes to the address bar', () => {
    render('panel')

    act(() => latest?.[1]({ sort: 'name', dir: 'desc' }))
    act(() => latest?.[1]({ view: 'view_1' }))

    expect(setUrlState).not.toHaveBeenCalled()
  })

  it('holds the identical values locally', () => {
    render('panel')

    act(() => latest?.[1]({ sort: 'name', dir: 'desc' }))
    expect(latest?.[0]).toEqual({ sort: 'name', dir: 'desc', view: null })

    act(() => latest?.[1]({ view: 'view_1' }))
    expect(latest?.[0]).toEqual({ sort: 'name', dir: 'desc', view: 'view_1' })
  })

  /**
   * A key already sitting on the host page's URL must not steer the panel. This
   * is what the deleted `inheritedParams` guard used to defend against by hand.
   */
  it('ignores a value already on the host page URL', () => {
    urlState.current = { sort: 'stale', dir: 'desc', view: 'someone_elses_view' }
    render('panel')

    expect(latest?.[0]).toEqual({ sort: null, dir: 'asc', view: null })
  })

  /**
   * Several writers set multiple keys at once and rely on one atomic update —
   * clearing an adopted view writes `{ view, sort, dir }` together. Three
   * separate setters would tear midway through the view-resolution latch.
   */
  it('applies a multi-key write atomically', () => {
    render('panel')
    act(() => latest?.[1]({ sort: 'name', dir: 'desc', view: 'view_1' }))

    act(() => latest?.[1]({ view: 'all', sort: null, dir: null }))

    expect(latest?.[0]).toEqual({ sort: null, dir: 'asc', view: 'all' })
  })

  it('resets a key to its default when written null, as nuqs does', () => {
    render('panel')
    act(() => latest?.[1]({ dir: 'desc' }))
    expect(latest?.[0].dir).toBe('desc')

    act(() => latest?.[1]({ dir: null }))
    expect(latest?.[0].dir).toBe('asc')
  })

  it('leaves untouched keys alone', () => {
    render('panel')
    act(() => latest?.[1]({ sort: 'name', view: 'view_1' }))

    act(() => latest?.[1]({ sort: 'other' }))

    expect(latest?.[0]).toEqual({ sort: 'other', dir: 'asc', view: 'view_1' })
  })
})
