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
  connectionError: vi.fn(),
  channels: [] as Array<{
    name: string
    onmessage: ((event: MessageEvent<unknown>) => void) | null
    close: ReturnType<typeof vi.fn>
  }>,
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

import { SEARCH_CONNECTORS } from '@/lib/sim-search/connectors'
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
    membershipQueryKeys: [],
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
  vi.clearAllMocks()
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
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useMemberEnrollment', () => {
  it('reports an OAuth mismatch once per attempt and allows the same error on a later retry', () => {
    mount(new Set(), true, mocks.connectionError)
    for (let index = 0; index < 2; index += 1) {
      act(() => enrollment().connect('kb-1', 'connector-1'))
      act(() =>
        mocks.enrollmentMutate.mock.calls[index][1].onSuccess({
          url: 'https://provider.test/authorize',
        })
      )
      act(() =>
        mocks.channels[index].onmessage?.(new MessageEvent('message', { data: 'account_mismatch' }))
      )
      act(() =>
        mocks.channels[index].onmessage?.(new MessageEvent('message', { data: 'account_mismatch' }))
      )
      expect(mocks.connectionError).toHaveBeenCalledTimes(index + 1)
      expect(enrollment().isAwaiting('connector-1')).toBe(false)
    }
    expect(mocks.connectionError).toHaveBeenLastCalledWith(
      'Choose the account matching your Sim email address.'
    )
    act(() => vi.advanceTimersByTime(10 * 60_000))
    expect(mocks.connectionError).toHaveBeenCalledTimes(2)
  })

  it('does not report a successful OAuth completion as an error', () => {
    mount(new Set(), true, mocks.connectionError)
    act(() => enrollment().connect('kb-1', 'connector-1'))
    act(() =>
      mocks.enrollmentMutate.mock.calls[0][1].onSuccess({
        url: 'https://provider.test/authorize',
      })
    )
    act(() => mocks.channels[0].onmessage?.(new MessageEvent('message', { data: 'connected' })))
    expect(mocks.connectionError).not.toHaveBeenCalled()
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
        mocks.channels[0].onmessage?.(new MessageEvent('message', { data: 'account_mismatch' }))
      )
      expect(mocks.connectionError).not.toHaveBeenCalled()
      expect(enrollment().error).toBeNull()
      expect(enrollment().isAwaiting('connector-1')).toBe(false)
      expect(mocks.channels[0].close).toHaveBeenCalledOnce()
      expect(mocks.channels[1].close).toHaveBeenCalledOnce()
    }
  )

  it('reopening one connector leaves a different connector authorization active', () => {
    mount(new Set(), true, mocks.connectionError)
    for (const connectorId of ['connector-1', 'connector-2', 'connector-1']) {
      act(() => enrollment().connect('kb-1', connectorId))
      const index = mocks.enrollmentMutate.mock.calls.length - 1
      act(() =>
        mocks.enrollmentMutate.mock.calls[index][1].onSuccess({
          url: `https://provider.test/attempt-${index}`,
        })
      )
    }
    expect(mocks.channels[0].close).toHaveBeenCalledOnce()
    expect(mocks.channels[1].close).not.toHaveBeenCalled()
    act(() => mocks.channels[2].onmessage?.(new MessageEvent('message', { data: 'connected' })))
    expect(enrollment().isAwaiting('connector-2')).toBe(true)
    act(() => mocks.channels[1].onmessage?.(new MessageEvent('message', { data: 'denied' })))
    expect(mocks.connectionError).toHaveBeenCalledExactlyOnceWith(
      'Authorization was canceled. Try connecting your account again.'
    )
  })

  it.each([
    ['existing', 'account_mismatch'],
    ['existing', 'denied'],
    ['existing', 'expired'],
    ['new', 'account_mismatch'],
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

  it('retires a first-source authorization when retrying its resolved connector', () => {
    mount(new Set(), true, mocks.connectionError)
    act(() => enrollment().connectSource('workspace-1', 'jira', { projectKey: 'ENG' }))
    act(() =>
      mocks.sourceConnectionMutate.mock.calls[0][1].onSuccess({
        url: 'https://provider.test/previous',
        connectorId: 'connector-1',
      })
    )
    act(() => enrollment().connect('kb-1', 'connector-1'))
    act(() => mocks.channels[0].onmessage?.(new MessageEvent('message', { data: 'denied' })))
    expect(mocks.channels[0].close).toHaveBeenCalledOnce()
    expect(mocks.connectionError).not.toHaveBeenCalled()
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

  it('retires a pending connector request when a newer first-source request resolves to it', () => {
    mount(new Set(), true, mocks.connectionError)
    act(() => enrollment().connect('kb-1', 'connector-1'))
    act(() => enrollment().connectSource('workspace-1', 'jira', { projectKey: 'ENG' }))
    act(() =>
      mocks.sourceConnectionMutate.mock.calls[0][1].onSuccess({
        url: 'https://provider.test/retry',
        connectorId: 'connector-1',
      })
    )
    act(() => mocks.enrollmentMutate.mock.calls[0][1].onError(new Error('Previous request failed')))
    expect(mocks.connectionError).not.toHaveBeenCalled()
    expect(enrollment().isAwaiting('connector-1')).toBe(true)
    expect(mocks.channels[0].close).toHaveBeenCalledOnce()
    expect(mocks.channels[1].close).not.toHaveBeenCalled()
  })

  it('keeps the previous authorization active when the retry popup is blocked', () => {
    mount(new Set(), true, mocks.connectionError)
    act(() => enrollment().connect('kb-1', 'connector-1'))
    act(() =>
      mocks.enrollmentMutate.mock.calls[0][1].onSuccess({ url: 'https://provider.test/previous' })
    )
    vi.mocked(window.open).mockReturnValueOnce(null)
    act(() => enrollment().connect('kb-1', 'connector-1'))
    expect(mocks.channels[0].close).not.toHaveBeenCalled()
    expect(enrollment().isAwaiting('connector-1')).toBe(true)
    expect(mocks.enrollmentMutate).toHaveBeenCalledOnce()
  })

  it('keeps pending source requests with different scopes or configurations independent', () => {
    mount(new Set(), true, mocks.connectionError)
    for (const [owner, projectKey] of [
      ['workspace-1', 'ENG'],
      ['workspace-1', 'SUPPORT'],
      ['workspace-2', 'ENG'],
    ]) {
      act(() => enrollment().connectSource(owner, 'jira', { projectKey }))
    }
    for (let index = 0; index < 3; index += 1) {
      act(() =>
        mocks.sourceConnectionMutate.mock.calls[index][1].onSuccess({
          url: `https://provider.test/attempt-${index}`,
          connectorId: `connector-${index}`,
        })
      )
      expect(enrollment().isAwaiting(`connector-${index}`)).toBe(true)
      expect(mocks.channels[index].close).not.toHaveBeenCalled()
    }
  })

  it('reports a blocked popup once without starting a connection', () => {
    mount(new Set(), true, mocks.connectionError)
    vi.mocked(window.open).mockReturnValueOnce(null)
    act(() => enrollment().connect('kb-1', 'connector-1'))
    expect(mocks.connectionError).toHaveBeenCalledExactlyOnceWith(
      'Allow pop-ups for this site to connect your account.'
    )
    expect(mocks.enrollmentMutate).not.toHaveBeenCalled()
  })

  it.each(['existing', 'new'] as const)('reports %s source startup errors once', (source) => {
    mount(new Set(), true, mocks.connectionError)
    act(() => {
      if (source === 'existing') enrollment().connect('kb-1', 'connector-1')
      else enrollment().connectSource({ kind: 'organization', organizationId: 'org-1' }, 'jira')
    })
    const mutation = source === 'existing' ? mocks.enrollmentMutate : mocks.sourceConnectionMutate
    act(() => mutation.mock.calls[0][1].onError(new Error('Connection unavailable')))
    expect(mocks.connectionError).toHaveBeenCalledExactlyOnceWith('Connection unavailable')
    act(() => vi.advanceTimersByTime(10 * 60_000))
    expect(mocks.connectionError).toHaveBeenCalledOnce()
    expect(mocks.channels[0].close).toHaveBeenCalledOnce()
  })

  it('opens provider OAuth and waits for its own completion even if the account was already connected', () => {
    mount(new Set(['connector-1']), true)
    act(() => enrollment().connect('kb-1', 'connector-1'))
    const [input, handlers] = mocks.enrollmentMutate.mock.calls[0]
    expect(input.oauthCompletionId).toMatch(/^[a-f\d-]{36}$/)
    expect(mocks.channels[0].name).toBe(`sim:credential-group-oauth:${input.oauthCompletionId}`)
    act(() => handlers.onSuccess({ url: 'https://provider.test/authorize' }))
    expect(enrollmentTab.location.href).toBe('https://provider.test/authorize')
    act(() => vi.advanceTimersByTime(4_000))
    expect(enrollment().isAwaiting('connector-1')).toBe(true)
    act(() => mocks.channels[0].onmessage?.(new MessageEvent('message', { data: 'connected' })))
    expect(enrollment().isAwaiting('connector-1')).toBe(false)
    expect(enrollment().error).toBeNull()
    expect(mocks.invalidateQueries).toHaveBeenCalled()
    expect(mocks.channels[0].close).toHaveBeenCalledOnce()
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

  it('keeps listening for OAuth completion when provider isolation reports a closed window', () => {
    mount(new Set(), true)
    act(() => enrollment().connect('kb-1', 'connector-1'))
    act(() =>
      mocks.enrollmentMutate.mock.calls[0][1].onSuccess({ url: 'https://provider.test/authorize' })
    )
    enrollmentTab.closed = true
    act(() => vi.advanceTimersByTime(4_000))
    expect(enrollment().isAwaiting('connector-1')).toBe(true)
    expect(enrollment().error).toBeNull()
    act(() => mocks.channels[0].onmessage?.(new MessageEvent('message', { data: 'connected' })))
    expect(enrollment().isAwaiting('connector-1')).toBe(false)
    expect(enrollment().error).toBeNull()
    expect(mocks.channels[0].close).toHaveBeenCalledOnce()
  })

  it('stops waiting with an actionable error when direct OAuth expires', () => {
    mount(new Set(), true)
    act(() => enrollment().connect('kb-1', 'connector-1'))
    act(() =>
      mocks.enrollmentMutate.mock.calls[0][1].onSuccess({
        url: 'https://provider.test/authorize',
      })
    )
    act(() => vi.advanceTimersByTime(10 * 60_000))
    expect(enrollment().isAwaiting('connector-1')).toBe(false)
    expect(enrollment().error).toContain('expired')
    expect(mocks.channels[0].close).toHaveBeenCalledOnce()
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

  it.each(['blocked', 'failed', 'closed', 'success'] as const)(
    'retains source setup until enrollment navigation succeeds: %s',
    (outcome) => {
      mount()
      const connector = SEARCH_CONNECTORS.find((item) => item.type === 'github')!
      act(() => enrollment().connectSearchSource('workspace-1', connector, undefined))
      expect(enrollment().setupConnector).toBe(connector)
      if (outcome === 'blocked') vi.mocked(window.open).mockReturnValueOnce(null)
      act(() => enrollment().connectSource('workspace-1', 'github', { repository: 'acme/docs' }))
      if (outcome === 'blocked') {
        expect(mocks.sourceConnectionMutate).not.toHaveBeenCalled()
        expect(enrollment().error).toContain('Allow pop-ups')
      } else {
        const [, handlers] = mocks.sourceConnectionMutate.mock.calls[0]
        if (outcome === 'closed') enrollmentTab.closed = true
        act(() => {
          if (outcome === 'failed') handlers.onError(new Error('Try again'))
          else
            handlers.onSuccess({ url: 'https://example.test/enroll', connectorId: 'connector-1' })
        })
      }
      expect(enrollment().setupConnector).toBe(outcome === 'success' ? null : connector)
    }
  )

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

  it('allows retrying and stops polling after the enrollment tab closes', () => {
    mount()
    act(() => enrollment().connect('kb-1', 'connector-1'))
    const [, handlers] = mocks.enrollmentMutate.mock.calls[0]
    act(() => handlers.onSuccess({ url: 'https://example.test/enroll' }))
    expect(enrollment().isAwaiting('connector-1')).toBe(true)

    enrollmentTab.closed = true
    act(() => vi.advanceTimersByTime(4_000))
    expect(enrollment().isAwaiting('connector-1')).toBe(false)

    mocks.invalidateQueries.mockClear()
    act(() => vi.advanceTimersByTime(12_000))
    expect(mocks.invalidateQueries).not.toHaveBeenCalled()
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
