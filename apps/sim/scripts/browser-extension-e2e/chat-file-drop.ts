import assert from 'node:assert/strict'
import type { Locator, Page } from '@playwright/test'

type ChatDropPayload = { files: string[] } | { text: string; html?: string; uri?: string }

/** Dispatches a trusted browser drop onto a chat target in a page or its iframe. */
export async function dropOnChat(page: Page, target: Locator, payload: ChatDropPayload) {
  await page.bringToFront()
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  assert(box, 'Drop target is not visible')
  const data =
    'files' in payload
      ? { files: payload.files, items: [], dragOperationsMask: 1 }
      : {
          items: [
            { mimeType: 'text/plain', data: payload.text },
            ...(payload.html ? [{ mimeType: 'text/html', data: payload.html }] : []),
            ...(payload.uri ? [{ mimeType: 'text/uri-list', data: payload.uri }] : []),
          ],
          dragOperationsMask: 1,
        }
  const session = await page.context().newCDPSession(page)
  try {
    for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
      await session.send('Input.dispatchDragEvent', {
        type,
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        data,
      })
    }
  } finally {
    await session.detach()
  }
}
