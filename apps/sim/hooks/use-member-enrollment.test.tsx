/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import {
  kbConnectorsQueriesMock,
  kbConnectorsQueriesMockFns,
} from '@sim/testing/mocks/kb-connectors-queries.mock'
import { reactQueryMock } from '@sim/testing/mocks/react-query.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enrollmentMutate: vi.fn(),
  sourceConnectionMutate: vi.fn(),
  connectionError: vi.fn(),
  channels: [] as Array<{
    name: string
    onmessage: ((event: MessageEvent<unknown>) => void) | null
    close: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('@tanstack/react-query', () => reactQueryMock)
vi.mock('@/hooks/queries/kb/connectors', () => kbConnectorsQueriesMock)

import { useMemberEnrollment } from '@/hooks/use-member-enrollment'

type Enrollment = ReturnType<typeof useMemberEnrollment>

let latest: Enrollment | null = null
let root: Root | null = null
let container: HTMLDivElement | null = null
let enrollmentTab: { location: { href: string }; closed: boolean; close: () => void }

function Harness({
  connected,
  directOAuth,
  onConnectionError,
}: {
  connected: ReadonlySet<string>
  directOAuth?: boolean
  onConnectionError?: (message: string) => void
}) {
  latest = useMemberEnrollment({
    membershipQueryKeys: [['test-memberships']],
    connectedConnectorIds: connected,
    directOAuth,
    onConnectionError,
  })
  return null
}

function mount(
  connected: ReadonlySet<string> = new Set(),
  directOAuth = false,
  onConnectionError?: (message: string) => void
) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <Harness
        connected={connected}
        directOAuth={directOAuth}
        onConnectionError={onConnectionError}
      />
    )
  )
}

function enrollment(): Enrollment {
  if (!latest) throw new Error('Hook did not render')
  return latest
}

beforeEach(() => {
  kbConnectorsQueriesMockFns.mockUseStartConnectorMemberEnrollment.mockReturnValue({
    mutate: mocks.enrollmentMutate,
    submittedAt: 0,
    isPending: false,
    error: null,
  })
  kbConnectorsQueriesMockFns.mockUseConnectSimSearchConnector.mockReturnValue({
    mutate: mocks.sourceConnectionMutate,
    submittedAt: 0,
    isPending: false,
    error: null,
  })
  vi.useFakeTimers()
  mocks.channels.length = 0
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null
      close = vi.fn()
      constructor(public name: string) {
        mocks.channels.push(this)
      }
    }
  )
  enrollmentTab = {
    location: { href: '' },
    closed: false,
    close: vi.fn(),
  }
  vi.spyOn(window, 'open').mockReturnValue(enrollmentTab as unknown as Window)
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  latest = null
  vi.useRealTimers()
})

describe('useMemberEnrollment', () => {
  it('reports an OAuth failure once per attempt and allows the same error on a later retry', () => {
    mount(new Set(), true, mocks.connectionError)
    for (let index = 0; index < 2; index += 1) {
      act(() => enrollment().connect('kb-1', 'connector-1'))
      act(() =>
        mocks.enrollmentMutate.mock.calls[index][1].onSuccess({
          url: 'https://provider.test/authorize',
        })
      )
      act(() =>
        mocks.channels[index].onmessage?.(
          new MessageEvent('message', { data: 'permissions_required' })
        )
      )
      act(() =>
        mocks.channels[index].onmessage?.(
          new MessageEvent('message', { data: 'permissions_required' })
        )
      )
      expect(mocks.connectionError).toHaveBeenCalledTimes(index + 1)
      expect(enrollment().isAwaiting('connector-1')).toBe(false)
    }
    expect(mocks.connectionError).toHaveBeenLastCalledWith(
      'All requested permissions are required to connect this account.'
    )
    act(() => vi.advanceTimersByTime(10 * 60_000))
    expect(mocks.connectionError).toHaveBeenCalledTimes(2)
  })

  it.each(['existing', 'new'] as const)(
    'does not expire a superseded %s source authorization after its retry connects',
    (source) => {
      mount(new Set(), true, mocks.connectionError)
      const mutation = source === 'existing' ? mocks.enrollmentMutate : mocks.sourceConnectionMutate
      for (let index = 0; index < 2; index += 1) {
        act(() => {
          if (source === 'existing') enrollment().connect('kb-1', 'connector-1')
          else enrollment().connectSource('workspace-1', 'jira')
        })
        act(() =>
          mutation.mock.calls[index][1].onSuccess({
            url: `https://provider.test/attempt-${index}`,
            connectorId: 'connector-1',
          })
        )
      }
      act(() => mocks.channels[1].onmessage?.(new MessageEvent('message', { data: 'connected' })))
      act(() => vi.advanceTimersByTime(10 * 60_000))
      act(() =>
        mocks.channels[0].onmessage?.(new MessageEvent('message', { data: 'permissions_required' }))
      )
      expect(mocks.connectionError).not.toHaveBeenCalled()
      expect(enrollment().error).toBeNull()
      expect(enrollment().isAwaiting('connector-1')).toBe(false)
      expect(mocks.channels[0].close).toHaveBeenCalledOnce()
      expect(mocks.channels[1].close).toHaveBeenCalledOnce()
    }
  )

  it.each([
    ['existing', 'permissions_required'],
    ['existing', 'denied'],
    ['existing', 'expired'],
    ['new', 'permissions_required'],
    ['new', 'denied'],
    ['new', 'expired'],
  ] as const)(
    'ignores the previous %s source’s %s while its retry request is pending',
    (source, failure) => {
      mount(new Set(), true, mocks.connectionError)
      const mutation = source === 'existing' ? mocks.enrollmentMutate : mocks.sourceConnectionMutate
      const connect = () => {
        if (source === 'existing') enrollment().connect('kb-1', 'connector-1')
        else enrollment().connectSource('workspace-1', 'jira', { projectKey: 'ENG' })
      }
      act(connect)
      act(() =>
        mutation.mock.calls[0][1].onSuccess({
          url: 'https://provider.test/previous',
          connectorId: 'connector-1',
        })
      )
      act(() => vi.advanceTimersByTime(9 * 60_000))
      act(connect)
      if (failure !== 'expired') {
        act(() => mocks.channels[0].onmessage?.(new MessageEvent('message', { data: failure })))
      }
      act(() => vi.advanceTimersByTime(60_000))
      expect(mocks.connectionError).not.toHaveBeenCalled()
      expect(enrollment().error).toBeNull()
      act(() =>
        mutation.mock.calls[1][1].onSuccess({
          url: 'https://provider.test/retry',
          connectorId: 'connector-1',
        })
      )
      expect(enrollment().isAwaiting('connector-1')).toBe(true)
      expect(mocks.channels[1].close).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['existing', 'success'],
    ['existing', 'failure'],
    ['new', 'success'],
    ['new', 'failure'],
  ] as const)('ignores a superseded %s source request’s late %s', (source, outcome) => {
    mount(new Set(), true, mocks.connectionError)
    const mutation = source === 'existing' ? mocks.enrollmentMutate : mocks.sourceConnectionMutate
    const retryTab = { location: { href: '' }, closed: false, close: vi.fn() }
    vi.mocked(window.open)
      .mockReturnValueOnce(enrollmentTab as unknown as Window)
      .mockReturnValueOnce(retryTab as unknown as Window)
    for (let index = 0; index < 2; index += 1) {
      act(() => {
        if (source === 'existing') enrollment().connect('kb-1', 'connector-1')
        else enrollment().connectSource('workspace-1', 'jira', { projectKey: 'ENG' })
      })
    }
    act(() =>
      mutation.mock.calls[1][1].onSuccess({
        url: 'https://provider.test/retry',
        connectorId: 'connector-1',
      })
    )
    act(() => {
      if (outcome === 'failure') {
        mutation.mock.calls[0][1].onError(new Error('Previous request failed'))
      } else {
        mutation.mock.calls[0][1].onSuccess({
          url: 'https://provider.test/previous',
          connectorId: 'connector-1',
        })
      }
    })
    expect(enrollmentTab.location.href).toBe('')
    expect(retryTab.location.href).toBe('https://provider.test/retry')
    expect(retryTab.close).not.toHaveBeenCalled()
    expect(enrollment().isAwaiting('connector-1')).toBe(true)
    expect(mocks.channels[1].close).not.toHaveBeenCalled()
    expect(mocks.connectionError).not.toHaveBeenCalled()
    expect(enrollment().error).toBeNull()
  })

  it('does not let a delayed first-source response replace its newer connector authorization', () => {
    mount(new Set(), true, mocks.connectionError)
    act(() => enrollment().connectSource('workspace-1', 'jira', { projectKey: 'ENG' }))
    act(() => enrollment().connect('kb-1', 'connector-1'))
    act(() =>
      mocks.enrollmentMutate.mock.calls[0][1].onSuccess({ url: 'https://provider.test/retry' })
    )
    act(() =>
      mocks.sourceConnectionMutate.mock.calls[0][1].onSuccess({
        url: 'https://provider.test/previous',
        connectorId: 'connector-1',
      })
    )
    expect(enrollmentTab.location.href).toBe('https://provider.test/retry')
    expect(mocks.channels[1].close).not.toHaveBeenCalled()
    expect(enrollment().isAwaiting('connector-1')).toBe(true)
  })

  it('ignores first-source success while a newer request for its connector is still pending', () => {
    mount(new Set(), true, mocks.connectionError)
    const retryTab = { location: { href: '' }, closed: false, close: vi.fn() }
    vi.mocked(window.open)
      .mockReturnValueOnce(enrollmentTab as unknown as Window)
      .mockReturnValueOnce(retryTab as unknown as Window)
    act(() => enrollment().connectSource('workspace-1', 'jira', { projectKey: 'ENG' }))
    act(() => enrollment().connect('kb-1', 'connector-1'))
    act(() =>
      mocks.sourceConnectionMutate.mock.calls[0][1].onSuccess({
        url: 'https://provider.test/previous',
        connectorId: 'connector-1',
      })
    )
    expect(enrollmentTab.location.href).toBe('')
    expect(enrollment().isAwaiting('connector-1')).toBe(false)
    act(() => mocks.channels[0].onmessage?.(new MessageEvent('message', { data: 'denied' })))
    expect(mocks.connectionError).not.toHaveBeenCalled()
    act(() =>
      mocks.enrollmentMutate.mock.calls[0][1].onSuccess({ url: 'https://provider.test/retry' })
    )
    expect(retryTab.location.href).toBe('https://provider.test/retry')
    expect(enrollment().isAwaiting('connector-1')).toBe(true)
    expect(mocks.channels[1].close).not.toHaveBeenCalled()
  })

  it('keeps overlapping provider authorizations separate and reports a rejected one on the original page', () => {
    mount(new Set(), true)
    act(() => enrollment().connect('kb-1', 'connector-1'))
    act(() =>
      mocks.enrollmentMutate.mock.calls[0][1].onSuccess({ url: 'https://provider.test/one' })
    )
    act(() => enrollment().connect('kb-1', 'connector-2'))
    act(() =>
      mocks.enrollmentMutate.mock.calls[1][1].onSuccess({ url: 'https://provider.test/two' })
    )
    expect(mocks.channels[0].name).not.toBe(mocks.channels[1].name)
    act(() => mocks.channels[0].onmessage?.(new MessageEvent('message', { data: 'denied' })))
    expect(enrollment().isAwaiting('connector-1')).toBe(false)
    expect(enrollment().isAwaiting('connector-2')).toBe(true)
    expect(enrollment().error).toContain('Authorization was canceled')
    act(() => mocks.channels[1].onmessage?.(new MessageEvent('message', { data: 'unrecognized' })))
    expect(enrollment().isAwaiting('connector-2')).toBe(true)
  })

  it('passes direct authorization correlation through first-source setup and cleans it up on failure', () => {
    mount(new Set(), true)
    act(() =>
      enrollment().connectSource({ kind: 'organization', organizationId: 'org-1' }, 'gmail')
    )
    const [input, handlers] = mocks.sourceConnectionMutate.mock.calls[0]
    expect(input).toMatchObject({
      organizationId: 'org-1',
      connectorType: 'gmail',
      oauthCompletionId: expect.any(String),
    })
    act(() => handlers.onError(new Error('Unavailable')))
    expect(mocks.channels[0].close).toHaveBeenCalledOnce()
    expect(enrollmentTab.close).toHaveBeenCalledOnce()
  })

  it('does not navigate or await a tab closed before the enrollment request completes', () => {
    mount()
    act(() => enrollment().connectSource('workspace-1', 'google_drive'))
    enrollmentTab.closed = true
    const [, handlers] = mocks.sourceConnectionMutate.mock.calls[0]
    act(() =>
      handlers.onSuccess({ url: 'https://example.test/enroll', connectorId: 'connector-1' })
    )

    expect(enrollmentTab.location.href).toBe('')
    expect(enrollment().isAwaiting('connector-1')).toBe(false)
    expect(enrollment().isAwaitingSource('google_drive')).toBe(false)
  })
})
