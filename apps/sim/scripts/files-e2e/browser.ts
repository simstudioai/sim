import type { Page } from '@playwright/test'

/** Drops real OS paths through Chromium’s native file-entry boundary. */
export async function dropPaths(page: Page, paths: string[]) {
  const session = await page.context().newCDPSession(page)
  try {
    const data = { items: [], files: paths, dragOperationsMask: 1 }
    await session.send('Input.dispatchDragEvent', { type: 'dragEnter', x: 800, y: 700, data })
    await session.send('Input.dispatchDragEvent', { type: 'dragOver', x: 800, y: 700, data })
    await session.send('Input.dispatchDragEvent', { type: 'drop', x: 800, y: 700, data })
  } finally {
    await session.detach()
  }
}

/** Locates the upload menu by its accessible state without matching the empty-state upload action. */
export function uploadMenuTrigger(page: Page, name: string | RegExp = 'Upload') {
  return page.getByRole('button', { name, exact: true }).and(page.locator('[aria-haspopup="menu"]'))
}
