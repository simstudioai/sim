/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import {
  BrowserPageIssueView,
  browserPageIssueCopy,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-page-issue'

describe('browserPageIssueCopy', () => {
  it('names the failed host for a refused connection', () => {
    expect(
      browserPageIssueCopy({
        kind: 'load-error',
        code: -102,
        description: 'ERR_CONNECTION_REFUSED',
        url: 'http://localhost:3004/login',
      })
    ).toMatchObject({
      headline: "This site can't be reached",
      detail: 'localhost refused to connect.',
      code: 'ERR_CONNECTION_REFUSED',
    })
  })

  it.each([
    ['ERR_NAME_NOT_RESOLVED', 'example.invalid could not be found.'],
    ['ERR_INTERNET_DISCONNECTED', 'Check your internet connection and try again.'],
    ['ERR_TIMED_OUT', 'example.invalid took too long to respond.'],
    ['ERR_PROXY_CONNECTION_FAILED', 'The configured proxy server could not be reached.'],
    ['ERR_ADDRESS_UNREACHABLE', 'example.invalid is unavailable from this network.'],
  ])('uses specific recovery copy for %s', (description, detail) => {
    expect(
      browserPageIssueCopy({
        kind: 'load-error',
        code: -2,
        description,
        url: 'https://example.invalid/path',
      }).detail
    ).toBe(detail)
  })

  it('does not offer a certificate bypass', () => {
    const copy = browserPageIssueCopy({
      kind: 'load-error',
      code: -202,
      description: 'ERR_CERT_AUTHORITY_INVALID',
      url: 'https://example.invalid',
    })

    expect(copy.headline).toBe("Your connection isn't private")
    expect(copy.suggestions.join(' ')).not.toMatch(/continue|proceed|bypass/i)
  })

  it('bounds untrusted Chromium descriptions to a safe code', () => {
    expect(
      browserPageIssueCopy({
        kind: 'load-error',
        code: -2,
        description: '<script>alert(1)</script>',
        url: 'not a valid URL',
      })
    ).toMatchObject({ detail: 'The site could not be reached.', code: 'ERR_FAILED' })
  })

  it('distinguishes renderer crashes and hangs', () => {
    expect(
      browserPageIssueCopy({ kind: 'crashed', reason: 'oom', url: 'https://example.com' })
    ).toMatchObject({ headline: 'This page crashed', code: 'RENDERER_OUT_OF_MEMORY' })
    expect(
      browserPageIssueCopy({ kind: 'unresponsive', url: 'https://example.com' })
    ).toMatchObject({ headline: "This page isn't responding", code: 'RENDERER_UNRESPONSIVE' })
  })

  it('moves focus into the recovery page and exposes a keyboard-reachable Reload button', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onReload = vi.fn()

    act(() => {
      root.render(
        createElement(BrowserPageIssueView, {
          issue: {
            kind: 'load-error',
            code: -102,
            description: 'ERR_CONNECTION_REFUSED',
            url: 'http://localhost:3004',
          },
          onReload,
          focusRecovery: true,
        })
      )
    })

    expect(document.activeElement?.id).toBe('browser-page-issue-heading')
    const reload = container.querySelector<HTMLButtonElement>('button[type="button"]')
    expect(reload?.textContent).toContain('Reload')
    reload?.focus()
    expect(document.activeElement).toBe(reload)
    act(() => reload?.click())
    expect(onReload).toHaveBeenCalledTimes(1)

    act(() => root.unmount())
    container.remove()
  })

  it('does not move focus when its browser resource is hidden', () => {
    const container = document.createElement('div')
    const sentinel = document.createElement('button')
    document.body.append(container, sentinel)
    sentinel.focus()
    const root = createRoot(container)

    act(() => {
      root.render(
        createElement(BrowserPageIssueView, {
          issue: { kind: 'unresponsive', url: 'https://example.com' },
          onReload: vi.fn(),
          focusRecovery: false,
        })
      )
    })

    expect(document.activeElement).toBe(sentinel)

    act(() => root.unmount())
    container.remove()
    sentinel.remove()
  })
})
