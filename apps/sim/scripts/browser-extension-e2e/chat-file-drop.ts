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
  const observed = await target.evaluateHandle((element) => {
    const events: {
      event: DragEvent
      receipt: {
        type: string
        trusted: boolean
        tag: string | null
        intendedTarget: boolean
        chatBody: boolean
        inert: boolean
        files: number
        types: string[]
        defaultPrevented: boolean
        dropEffect: string | null
        x: number
        y: number
      }
    }[] = []
    const receive = (event: DragEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const receipt = {
        type: event.type,
        trusted: event.isTrusted,
        tag: target?.tagName ?? null,
        intendedTarget: target !== null && element.contains(target),
        chatBody: Boolean(target?.closest('main')),
        inert: Boolean(target?.closest('[inert]')),
        files: event.dataTransfer?.files.length ?? 0,
        types: Array.from(event.dataTransfer?.types ?? []),
        defaultPrevented: event.defaultPrevented,
        dropEffect: event.dataTransfer?.dropEffect ?? null,
        x: event.clientX,
        y: event.clientY,
      }
      events.push({ event, receipt })
    }
    for (const type of ['dragenter', 'dragover', 'drop'] as const)
      element.ownerDocument.addEventListener(type, receive, true)
    const rect = element.getBoundingClientRect()
    const x = rect.x + rect.width / 2
    const y = rect.y + rect.height / 2
    const hit = element.ownerDocument.elementFromPoint(x, y)
    return {
      readEvents: () =>
        events.map(({ event, receipt }) => ({
          ...receipt,
          defaultPrevented: event.defaultPrevented,
          dropEffect: event.dataTransfer?.dropEffect ?? null,
        })),
      frameTarget: {
        x,
        y,
        width: window.innerWidth,
        height: window.innerHeight,
        tag: hit?.tagName ?? null,
        intendedTarget: hit !== null && element.contains(hit),
        inert: Boolean(hit?.closest('[inert]')),
      },
      connected: () => element.isConnected,
      dispose: () => {
        for (const type of ['dragenter', 'dragover', 'drop'] as const)
          element.ownerDocument.removeEventListener(type, receive, true)
      },
    }
  })
  try {
    const session = await page.context().newCDPSession(page)
    try {
      const { windowId, bounds } = await session.send('Browser.getWindowForTarget')
      for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
        await session.send('Input.dispatchDragEvent', {
          type,
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
          data,
        })
      }
      return {
        box,
        nativeWindow: { windowId, bounds },
        viewport: page.viewportSize(),
        topHitTag: await page.evaluate(
          ({ x, y }) => document.elementFromPoint(x, y)?.tagName ?? null,
          { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        ),
        ...(await observed.evaluate((state) => ({
          events: state.readEvents(),
          frameTarget: state.frameTarget,
          connected: state.connected(),
        }))),
      }
    } finally {
      await session.detach()
    }
  } finally {
    await observed.evaluate((state) => state.dispose()).catch(() => {})
    await observed.dispose()
  }
}
