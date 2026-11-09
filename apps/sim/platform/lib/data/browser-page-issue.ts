import type { BrowserPageIssue } from '@sim/browser-protocol'

/** What the panel says in place of a page the desktop browser could not show. */
export interface BrowserPageIssueCopy {
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

const HOST_LIKE_INPUT =
  /^([a-z0-9-]+(\.[a-z0-9-]+)+|localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?([/?#].*)?$/i

/**
 * Omnibox-style resolution for the URL bar: explicit schemes pass through,
 * host-looking input becomes a URL (http:// for localhost/IPs since local dev
 * servers rarely speak TLS, https:// otherwise), and everything else runs as
 * a Google search, like any browser's address bar.
 */
export function resolveUrlBarInput(raw: string): string {
  const input = raw.trim()
  if (/^https?:\/\//i.test(input)) return input
  if (input.includes(' ') || !HOST_LIKE_INPUT.test(input))
    return `https://www.google.com/search?q=${encodeURIComponent(input)}`
  const isLocal =
    /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|0\.0\.0\.0|\[::1?\])(:\d+)?([/?#]|$)/i.test(input)
  return `${isLocal ? 'http' : 'https'}://${input}`
}
