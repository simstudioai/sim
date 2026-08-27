import { useEffect, useRef } from 'react'
import type { BrowserPageIssue } from '@sim/browser-protocol'
import { Button } from '@sim/emcn'
import { CircleAlert, Globe, RefreshCw } from '@sim/emcn/icons'

interface BrowserPageIssueProps {
  issue: BrowserPageIssue
  onReload: () => void
  focusRecovery: boolean
}

interface BrowserPageIssueCopy {
  headline: string
  detail: string
  suggestions: string[]
  code: string
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname || 'The site'
  } catch {
    return 'The site'
  }
}

function normalizedNetworkError(description: string): string {
  return /^ERR_[A-Z0-9_]+$/.test(description) ? description : 'ERR_FAILED'
}

/** Maps Chromium and renderer failures to concise, non-bypassable recovery copy. */
export function browserPageIssueCopy(issue: BrowserPageIssue): BrowserPageIssueCopy {
  const hostname = hostnameFromUrl(issue.url)
  if (issue.kind === 'crashed') {
    return {
      headline: 'This page crashed',
      detail: `${hostname} ran into a problem and closed unexpectedly.`,
      suggestions: ['Reloading the page', 'Closing other tabs if this keeps happening'],
      code: issue.reason === 'oom' ? 'RENDERER_OUT_OF_MEMORY' : 'RENDERER_CRASHED',
    }
  }
  if (issue.kind === 'unresponsive') {
    return {
      headline: "This page isn't responding",
      detail: `${hostname} stopped responding.`,
      suggestions: ['Waiting a moment', 'Reloading the page'],
      code: 'RENDERER_UNRESPONSIVE',
    }
  }

  const code = normalizedNetworkError(issue.description)
  if (code.startsWith('ERR_CERT_') || code === 'ERR_SSL_PROTOCOL_ERROR') {
    return {
      headline: "Your connection isn't private",
      detail: `The security certificate for ${hostname} could not be verified.`,
      suggestions: ['Checking your device clock', 'Contacting the site administrator'],
      code,
    }
  }
  if (
    code === 'ERR_PROXY_CONNECTION_FAILED' ||
    code === 'ERR_TUNNEL_CONNECTION_FAILED' ||
    code === 'ERR_NO_SUPPORTED_PROXIES'
  ) {
    return {
      headline: "This site can't be reached",
      detail: 'The configured proxy server could not be reached.',
      suggestions: ['Checking the proxy settings', 'Checking the network connection'],
      code,
    }
  }
  if (
    code === 'ERR_ADDRESS_UNREACHABLE' ||
    code === 'ERR_NETWORK_UNREACHABLE' ||
    code === 'ERR_BLOCKED_BY_CLIENT' ||
    code === 'ERR_BLOCKED_BY_RESPONSE' ||
    code === 'ERR_ACCESS_DENIED'
  ) {
    return {
      headline: "This site can't be reached",
      detail: `${hostname} is unavailable from this network.`,
      suggestions: ['Checking the address', 'Checking firewall and network settings'],
      code,
    }
  }

  switch (code) {
    case 'ERR_CONNECTION_REFUSED':
      return {
        headline: "This site can't be reached",
        detail: `${hostname} refused to connect.`,
        suggestions: ['Checking the connection', 'Checking the address'],
        code,
      }
    case 'ERR_NAME_NOT_RESOLVED':
    case 'ERR_NAME_RESOLUTION_FAILED':
      return {
        headline: "This site can't be reached",
        detail: `${hostname} could not be found.`,
        suggestions: ['Checking the address', 'Checking the DNS and network connection'],
        code,
      }
    case 'ERR_INTERNET_DISCONNECTED':
      return {
        headline: "You're offline",
        detail: 'Check your internet connection and try again.',
        suggestions: ['Checking network cables and Wi-Fi', 'Reconnecting to the internet'],
        code,
      }
    case 'ERR_TIMED_OUT':
    case 'ERR_CONNECTION_TIMED_OUT':
      return {
        headline: "This site can't be reached",
        detail: `${hostname} took too long to respond.`,
        suggestions: ['Checking the connection', 'Trying again in a moment'],
        code,
      }
    default:
      return {
        headline: "This site can't be reached",
        detail: `${hostname} could not be reached.`,
        suggestions: ['Checking the address', 'Checking the connection'],
        code,
      }
  }
}

/** Replaces a hidden native page and optionally claims renderer focus for keyboard recovery. */
export function BrowserPageIssueView({ issue, onReload, focusRecovery }: BrowserPageIssueProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const copy = browserPageIssueCopy(issue)

  useEffect(() => {
    if (focusRecovery) headingRef.current?.focus()
  }, [focusRecovery, issue])

  const Icon = issue.kind === 'load-error' ? Globe : CircleAlert

  return (
    <section
      className='absolute inset-0 flex items-center justify-center bg-[var(--bg)] px-8'
      role='alert'
      aria-live='polite'
      aria-labelledby='browser-page-issue-heading'
    >
      <div className='-translate-y-8 w-full max-w-[360px]'>
        <Icon className='mb-7 size-8 text-[var(--text-icon)]' />
        <h2
          ref={headingRef}
          id='browser-page-issue-heading'
          className='rounded-[4px] font-medium text-[var(--text-primary)] text-base outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-1)]'
          tabIndex={-1}
        >
          {copy.headline}
        </h2>
        <p className='mt-2 text-[var(--text-secondary)] text-small'>{copy.detail}</p>
        <p className='mt-6 text-[var(--text-secondary)] text-small'>Try:</p>
        <ul className='mt-2 list-disc space-y-1 pl-5 text-[var(--text-secondary)] text-small'>
          {copy.suggestions.map((suggestion) => (
            <li key={suggestion}>{suggestion}</li>
          ))}
        </ul>
        <p className='mt-6 break-all font-mono text-[var(--text-muted)] text-xs'>{copy.code}</p>
        <Button type='button' variant='default' size='sm' className='mt-8 gap-1' onClick={onReload}>
          <RefreshCw className='size-[14px]' />
          Reload
        </Button>
      </div>
    </section>
  )
}
