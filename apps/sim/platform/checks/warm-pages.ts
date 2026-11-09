import { request } from '@playwright/test'

/** A static asset a page references, quoted in its markup or its inline flight data. */
const STATIC_ASSET = /["'](\/_next\/static\/[^"'\\\s]+)/g

/**
 * Compiles what the fixture development server would otherwise compile while a check waits. The
 * server compiles a route on its first visit and each client chunk on its first request, which on
 * a CI runner outlasts an assertion's deadline, so each page is requested as a browser requests a
 * document, then every script and stylesheet the document names. Redirects are followed, so a
 * route warms the page it lands on. `follow` names further pages to warm from a fetched page's
 * markup. Playwright's request client, unlike `fetch`, has no fixed five-minute wait for headers.
 */
export async function warmPages(
  pages: string[],
  timeout: number,
  follow: (page: URL, html: string) => string[] = () => []
) {
  const context = await request.newContext({ timeout })
  const queued = [...pages]
  const warmedAssets = new Set<string>()
  try {
    for (let next = queued.shift(); next; next = queued.shift()) {
      const response = await context.get(next, { headers: { accept: 'text/html' } })
      const html = await response.text()
      for (const [, asset] of html.matchAll(STATIC_ASSET)) {
        const assetUrl = new URL(asset, response.url()).href
        if (warmedAssets.has(assetUrl)) continue
        warmedAssets.add(assetUrl)
        await context.get(assetUrl)
      }
      queued.push(...follow(new URL(response.url()), html))
    }
  } finally {
    await context.dispose()
  }
}
