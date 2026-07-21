import type { BrowserContext, Route } from '@playwright/test'
import { E2E_ORIGIN, E2E_SOCKET_ORIGIN } from './deployment-profile'

const ALLOWED_BROWSER_ORIGINS = new Set([E2E_ORIGIN, E2E_SOCKET_ORIGIN])

export interface BrowserNetworkGuard {
  assertNoUnexpectedRequests(): void
}

/**
 * Keeps browser traffic inside the guarded E2E stack. Server-side fakes are not
 * browser destinations, so any other HTTP(S) origin is a boundary violation.
 */
export async function installBrowserNetworkGuard(
  context: BrowserContext
): Promise<BrowserNetworkGuard> {
  const unexpectedRequests = new Set<string>()

  await context.route('**/*', async (route: Route) => {
    const requestUrl = route.request().url()
    let url: URL
    try {
      url = new URL(requestUrl)
    } catch {
      await route.abort('blockedbyclient')
      unexpectedRequests.add(requestUrl)
      return
    }

    if (!['http:', 'https:'].includes(url.protocol) || ALLOWED_BROWSER_ORIGINS.has(url.origin)) {
      await route.continue()
      return
    }

    unexpectedRequests.add(`${url.origin}${url.pathname}`)
    await route.abort('blockedbyclient')
  })

  return {
    assertNoUnexpectedRequests() {
      if (unexpectedRequests.size > 0) {
        throw new Error(
          `Unexpected browser traffic escaped the E2E stack:\n${[...unexpectedRequests]
            .sort()
            .join('\n')}`
        )
      }
    },
  }
}
