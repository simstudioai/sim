import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installDocumentationHelpSearch,
  uninstallDocumentationHelpSearch,
} from '@/main/help-search'

describe('documentation Help search', () => {
  afterEach(() => {
    uninstallDocumentationHelpSearch()
  })

  it('registers the native provider with the canonical docs endpoint', () => {
    const bridge = {
      install: vi.fn(() => true),
      uninstall: vi.fn(),
    }

    expect(
      installDocumentationHelpSearch({
        isElectron: true,
        isMacOS: true,
        loadBridge: () => bridge,
      })
    ).toBe(true)
    expect(bridge.install).toHaveBeenCalledWith('https://docs.sim.ai/api/search')

    uninstallDocumentationHelpSearch()
    expect(bridge.uninstall).toHaveBeenCalledOnce()
  })

  it('does not load the bridge outside Electron on macOS', () => {
    const loadBridge = vi.fn()

    expect(
      installDocumentationHelpSearch({
        isElectron: false,
        isMacOS: true,
        loadBridge,
      })
    ).toBe(false)
    expect(loadBridge).not.toHaveBeenCalled()
  })

  it('fails closed for an invalid or refusing bridge', () => {
    expect(
      installDocumentationHelpSearch({
        isElectron: true,
        isMacOS: true,
        loadBridge: () => ({ install: () => true }),
      })
    ).toBe(false)
    expect(
      installDocumentationHelpSearch({
        isElectron: true,
        isMacOS: true,
        loadBridge: () => ({ install: () => false, uninstall: vi.fn() }),
      })
    ).toBe(false)
  })
})
