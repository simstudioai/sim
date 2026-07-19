/**
 * @vitest-environment jsdom
 *
 * Both share modals (files, interfaces) render from this state machine, so the
 * pre-reserved token, the null-until-touched drafts, the org-policy gates, and
 * the save payload are pinned here once instead of twice.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShareRecord } from '@/lib/api/contracts/public-shares'

const { mockGetEnv } = vi.hoisted(() => ({ mockGetEnv: vi.fn() }))

vi.mock('@/lib/core/config/env', () => ({
  getEnv: mockGetEnv,
  isTruthy: (value: unknown) => value === true || value === 'true' || value === '1',
}))

vi.mock('@/lib/messaging/email/validation', () => ({
  quickValidateEmail: (value: string) => ({ isValid: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) }),
}))

vi.mock('@/lib/public-shares/urls', () => ({
  buildShareUrl: (resourceType: string, token: string) =>
    `https://sim.ai/${resourceType === 'interface' ? 'i' : 'f'}/${token}`,
}))

import {
  type UseShareModalStateArgs,
  type UseShareModalStateResult,
  useShareModalState,
} from '@/hooks/use-share-modal-state'

const ALLOW_ALL = { disablePublicSharing: false, allowedAuthTypes: null }

const BASE_ARGS: UseShareModalStateArgs = {
  resourceType: 'interface',
  saved: null,
  isFetched: true,
  policy: ALLOW_ALL,
}

function buildShare(overrides: Partial<ShareRecord> = {}): ShareRecord {
  return {
    id: 'sh_1',
    token: 'tok_saved',
    url: 'https://sim.ai/i/tok_saved',
    isActive: true,
    resourceType: 'interface',
    resourceId: 'int-1',
    authType: 'public',
    hasPassword: false,
    allowedEmails: [],
    ...overrides,
  }
}

interface Harness {
  current: UseShareModalStateResult
  rerender: (patch: Partial<UseShareModalStateArgs>) => void
  /** Runs a state update inside `act` and returns whatever the callback produced. */
  run: <T>(fn: (state: UseShareModalStateResult) => T) => T
}

function render(overrides: Partial<UseShareModalStateArgs> = {}): Harness {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  let result: UseShareModalStateResult | undefined
  let args: UseShareModalStateArgs = { ...BASE_ARGS, ...overrides }

  function Probe({ hookArgs }: { hookArgs: UseShareModalStateArgs }) {
    result = useShareModalState(hookArgs)
    return null
  }

  const paint = () => act(() => root.render(<Probe hookArgs={args} />))
  paint()

  return {
    get current(): UseShareModalStateResult {
      if (!result) throw new Error('Hook result is not ready')
      return result
    },
    rerender(patch) {
      args = { ...args, ...patch }
      paint()
    },
    run(fn) {
      let out: ReturnType<typeof fn>
      act(() => {
        if (!result) throw new Error('Hook result is not ready')
        out = fn(result)
      })
      return out as ReturnType<typeof fn>
    },
  }
}

describe('useShareModalState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetEnv.mockReturnValue(undefined)
  })

  describe('mode derivation', () => {
    it('starts private when nothing is shared', () => {
      const hook = render()
      expect(hook.current.mode).toBe('private')
      expect(hook.current.isDirty).toBe(false)
    })

    it('reflects the saved auth mode', () => {
      const hook = render({ saved: buildShare({ authType: 'password', hasPassword: true }) })
      expect(hook.current.mode).toBe('password')
    })

    it('reads an inactive share as private even when an auth type is stored', () => {
      const hook = render({
        saved: buildShare({ isActive: false, authType: 'password', hasPassword: true }),
      })
      expect(hook.current.mode).toBe('private')
    })

    /**
     * Drafts stay `null` until touched so each control keeps reflecting the
     * authoritative saved state even when the share query resolves after mount.
     */
    it('adopts a share that arrives after mount', () => {
      const hook = render()
      expect(hook.current.mode).toBe('private')
      hook.rerender({ saved: buildShare({ authType: 'email', allowedEmails: ['a@b.com'] }) })
      expect(hook.current.mode).toBe('email')
      expect(hook.current.emails).toEqual(['a@b.com'])
    })

    it('keeps a touched draft when a later fetch resolves', () => {
      const hook = render()
      hook.run((state) => state.setMode('password'))
      hook.rerender({ saved: buildShare({ authType: 'public' }) })
      expect(hook.current.mode).toBe('password')
    })
  })

  describe('share link', () => {
    it('withholds the link until the share query settles', () => {
      const hook = render({ isFetched: false })
      expect(hook.current.shareUrl).toBeNull()
    })

    it('shows a pre-reserved interface link before the first save', () => {
      const hook = render()
      expect(hook.current.shareUrl).toMatch(/^https:\/\/sim\.ai\/i\/.+/)
    })

    it('builds a file link for a file resource', () => {
      const hook = render({ resourceType: 'file' })
      expect(hook.current.shareUrl).toMatch(/^https:\/\/sim\.ai\/f\/.+/)
    })

    it('prefers the saved url once a share exists', () => {
      const hook = render({ saved: buildShare() })
      expect(hook.current.shareUrl).toBe('https://sim.ai/i/tok_saved')
    })

    it('keeps the reserved token stable across re-renders', () => {
      const hook = render()
      const first = hook.current.shareUrl
      hook.rerender({})
      expect(hook.current.shareUrl).toBe(first)
    })
  })

  describe('validation gates', () => {
    it('blocks saving a password share with no password', () => {
      const hook = render()
      hook.run((state) => state.setMode('password'))
      expect(hook.current.passwordMissing).toBe(true)
      expect(hook.current.canSave).toBe(false)
      hook.run((state) => state.setPassword('hunter22'))
      expect(hook.current.passwordMissing).toBe(false)
      expect(hook.current.canSave).toBe(true)
    })

    it('accepts switching to password when a secret is already stored', () => {
      const hook = render({
        saved: buildShare({ isActive: false, authType: 'password', hasPassword: true }),
      })
      hook.run((state) => state.setMode('password'))
      expect(hook.current.passwordMissing).toBe(false)
      expect(hook.current.canSave).toBe(true)
    })

    it.each(['email', 'sso'] as const)('blocks saving a %s share with no allow-list', (mode) => {
      mockGetEnv.mockReturnValue('true')
      const hook = render()
      hook.run((state) => state.setMode(mode))
      expect(hook.current.emailsMissing).toBe(true)
      expect(hook.current.canSave).toBe(false)
      hook.run((state) => state.addEmail('a@b.com'))
      expect(hook.current.emailsMissing).toBe(false)
      expect(hook.current.canSave).toBe(true)
    })

    it('rejects malformed and duplicate allow-list entries', () => {
      const hook = render()
      hook.run((state) => state.setMode('email'))
      expect(hook.run((state) => state.addEmail('not-an-email'))).toBe(false)
      expect(hook.run((state) => state.addEmail('a@b.com'))).toBe(true)
      expect(hook.run((state) => state.addEmail('A@B.com'))).toBe(false)
      expect(hook.current.emails).toEqual(['a@b.com'])
    })

    it('accepts an @domain pattern', () => {
      const hook = render()
      hook.run((state) => state.setMode('email'))
      hook.run((state) => state.addEmail('@acme.com'))
      expect(hook.current.emails).toEqual(['@acme.com'])
    })

    it('removes an allow-list entry by index', () => {
      const hook = render({
        saved: buildShare({ authType: 'email', allowedEmails: ['a@b.com', 'c@d.com'] }),
      })
      hook.run((state) => state.removeEmail('a@b.com', 0))
      expect(hook.current.emails).toEqual(['c@d.com'])
      expect(hook.current.isDirty).toBe(true)
    })
  })

  describe('org policy', () => {
    it('blocks enabling a new share when public sharing is disabled', () => {
      const hook = render({ policy: { disablePublicSharing: true, allowedAuthTypes: null } })
      hook.run((state) => state.setMode('public'))
      expect(hook.current.enableBlockedByPolicy).toBe(true)
      expect(hook.current.canSave).toBe(false)
    })

    it('still allows going private when public sharing is disabled', () => {
      const hook = render({
        saved: buildShare(),
        policy: { disablePublicSharing: true, allowedAuthTypes: null },
      })
      hook.run((state) => state.setMode('private'))
      expect(hook.current.canSave).toBe(true)
      expect(hook.current.buildSavePayload().isActive).toBe(false)
    })

    it('hides auth modes the org disallows', () => {
      const hook = render({
        policy: { disablePublicSharing: false, allowedAuthTypes: ['password'] },
      })
      expect(hook.current.availableModes).toEqual(['private', 'password'])
    })

    it('keeps a saved-but-now-disallowed mode visible', () => {
      const hook = render({
        saved: buildShare({ authType: 'public' }),
        policy: { disablePublicSharing: false, allowedAuthTypes: ['password'] },
      })
      expect(hook.current.availableModes).toContain('public')
      expect(hook.current.modeDisallowed).toBe(true)
    })

    it('omits sso unless the deployment enables it', () => {
      expect(render().current.availableModes).not.toContain('sso')
      mockGetEnv.mockReturnValue('true')
      expect(render().current.availableModes).toContain('sso')
    })
  })

  describe('save payload', () => {
    it('sends the reserved token only when creating the row', () => {
      const hook = render()
      hook.run((state) => state.setMode('public'))
      expect(hook.current.buildSavePayload()).toEqual({
        isActive: true,
        authType: 'public',
        token: expect.any(String),
      })
    })

    it('omits the token for an existing share', () => {
      const hook = render({ saved: buildShare({ authType: 'public' }) })
      hook.run((state) => state.setMode('password'))
      hook.run((state) => state.setPassword('hunter22'))
      expect(hook.current.buildSavePayload()).toEqual({
        isActive: true,
        authType: 'password',
        password: 'hunter22',
        token: undefined,
      })
    })

    it('sends the allow-list for email and sso', () => {
      const hook = render({ saved: buildShare({ authType: 'public' }) })
      hook.run((state) => state.setMode('email'))
      hook.run((state) => state.addEmail('a@b.com'))
      expect(hook.current.buildSavePayload()).toEqual({
        isActive: true,
        authType: 'email',
        allowedEmails: ['a@b.com'],
        token: undefined,
      })
    })

    it('sends isActive false with no auth config when going private', () => {
      const hook = render({ saved: buildShare({ authType: 'password', hasPassword: true }) })
      hook.run((state) => state.setMode('private'))
      const payload = hook.current.buildSavePayload()
      expect(payload.isActive).toBe(false)
      expect(payload.authType).toBeUndefined()
      expect(payload.password).toBeUndefined()
    })

    it('never sends a whitespace-only password', () => {
      const hook = render()
      hook.run((state) => state.setMode('password'))
      hook.run((state) => state.setPassword('   '))
      expect(hook.current.passwordMissing).toBe(true)
      expect(hook.current.buildSavePayload().password).toBeUndefined()
    })
  })

  it('reset returns every draft to the saved state', () => {
    const hook = render({ saved: buildShare({ authType: 'public' }) })
    hook.run((state) => state.setMode('email'))
    hook.run((state) => state.addEmail('a@b.com'))
    hook.run((state) => state.setPassword('hunter22'))
    expect(hook.current.isDirty).toBe(true)
    hook.run((state) => state.reset())
    expect(hook.current.mode).toBe('public')
    expect(hook.current.emails).toEqual([])
    expect(hook.current.password).toBe('')
    expect(hook.current.isDirty).toBe(false)
  })
})
