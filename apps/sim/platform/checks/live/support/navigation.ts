import { expect, type Frame, type Page } from '@playwright/test'

/** A URL's path and query, as a redirect target names it. */
export function pathOf(address: string) {
  const url = new URL(address)
  return `${url.pathname}${url.search}`
}

/**
 * Opens `from` and returns the first address the browser moved to from there: through an HTTP
 * redirect the document followed, or a move the page made after rendering it (a streamed
 * redirect). A saved link that lands in one hop answers its destination here, query included; one
 * that passes through another legacy route first answers that route instead.
 */
export async function firstHopFrom(page: Page, from: string): Promise<string> {
  const committed: string[] = []
  const onNavigated = (frame: Frame) => {
    if (frame === page.mainFrame()) committed.push(pathOf(frame.url()))
  }
  page.on('framenavigated', onNavigated)
  try {
    const response = await page.goto(from)
    const redirected: string[] = []
    for (let request = response?.request() ?? null; request; request = request.redirectedFrom())
      redirected.unshift(pathOf(request.url()))
    const moves = () => [...redirected, ...committed].filter((address) => address !== from)
    await expect.poll(() => moves().length, { message: `${from} never moved` }).toBeGreaterThan(0)
    return moves()[0]
  } finally {
    page.off('framenavigated', onNavigated)
  }
}
