/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enrollmentMutate: vi.fn(),
  sourceConnectionMutate: vi.fn(),
  invalidateQueries: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))
vi.mock('@/hooks/queries/kb/connectors', () => ({
  memberConnectorKeys: { lists: () => ['member-connectors', 'list'] },
  useStartConnectorMemberEnrollment: () => ({
    mutate: mocks.enrollmentMutate,
    submittedAt: 0,
    isPending: false,
    error: null,
  }),
  useConnectSimSearchConnector: () => ({
    mutate: mocks.sourceConnectionMutate,
    submittedAt: 0,
    isPending: false,
    error: null,
  }),
}))

import { useMemberEnrollment } from '@/hooks/use-member-enrollment'

type Enrollment = ReturnType<typeof useMemberEnrollment>

let latest: Enrollment | null = null
let root: Root | null = null
let container: HTMLDivElement | null = null

function Harness({ connected }: { connected: ReadonlySet<string> }) {
  latest = useMemberEnrollment({ membershipQueryKeys: [], connectedConnectorIds: connected })
  return null
}

function mount(connected: ReadonlySet<string> = new Set()) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<Harness connected={connected} />))
}

function enrollment(): Enrollment {
  if (!latest) throw new Error('Hook did not render')
  return latest
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window, 'open').mockReturnValue({
    location: { href: '' },
    close: vi.fn(),
  } as unknown as Window)
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  latest = null
  vi.restoreAllMocks()
})

describe('useMemberEnrollment', () => {
  /**
   * The connect that creates a Sim Search source's connector returns its id,
   * but the membership list has no row for it until it refetches, so the
   * source is awaited by type until then and by id once the row exists.
   */
  it('awaits a first-connected source by type until its membership row appears', () => {
    mount()
    act(() => enrollment().connectSource('workspace-1', 'google_drive'))

    const [, handlers] = mocks.sourceConnectionMutate.mock.calls[0]
    act(() =>
      handlers.onSuccess({ url: 'https://example.test/enroll', connectorId: 'connector-1' })
    )

    expect(enrollment().isAwaitingSource('google_drive')).toBe(true)
    expect(enrollment().isAwaitingSource('slack')).toBe(false)
    expect(enrollment().isAwaiting('connector-1')).toBe(true)
  })

  it('stops awaiting a source once the viewer is connected to its connector', () => {
    mount()
    act(() => enrollment().connectSource('workspace-1', 'google_drive'))
    const [, handlers] = mocks.sourceConnectionMutate.mock.calls[0]
    act(() =>
      handlers.onSuccess({ url: 'https://example.test/enroll', connectorId: 'connector-1' })
    )

    act(() => root?.render(<Harness connected={new Set(['connector-1'])} />))

    expect(enrollment().isAwaitingSource('google_drive')).toBe(false)
    expect(enrollment().isAwaiting('connector-1')).toBe(false)
  })

  it('does not report an enrollment in an existing connector as an awaited source', () => {
    mount()
    act(() => enrollment().connect('kb-1', 'connector-1'))
    const [, handlers] = mocks.enrollmentMutate.mock.calls[0]
    act(() => handlers.onSuccess({ url: 'https://example.test/enroll' }))

    expect(enrollment().isAwaiting('connector-1')).toBe(true)
    expect(enrollment().isAwaitingSource('google_drive')).toBe(false)
  })
})
