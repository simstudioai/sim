import { test as base, type Page } from '@playwright/test'
import { fixtureOrigin } from '@/platform/checks/routes'

/** How long a loaded page may take to hydrate on a busy runner before a check gives up on it. */
const HYDRATION_TIMEOUT_MS = 60_000

/** The parts of a React fiber the hydration check reads. */
interface Fiber {
  child: Fiber | null
  sibling: Fiber | null
  memoizedState: unknown
}

/**
 * Runs in the page. True once React has committed the document and no part of it is still
 * server-rendered markup awaiting hydration. The root commits first and each Suspense or Activity
 * boundary hydrates in a later pass, so the whole tree is walked for a boundary whose state still
 * holds its dehydrated markup. A press or pointer move on markup React has not hydrated reaches
 * no handler and is lost.
 */
function isHydrated() {
  const key = Object.keys(document).find((name) => name.startsWith('__reactContainer$'))
  if (!key) return false
  const container: { stateNode: { current: Fiber } } | undefined = Reflect.get(document, key)
  const root = container?.stateNode.current
  if (!root?.child) return false
  const pending = [root]
  for (let fiber = pending.pop(); fiber; fiber = pending.pop()) {
    const state = fiber.memoizedState
    if (
      state !== null &&
      typeof state === 'object' &&
      (('isDehydrated' in state && state.isDehydrated === true) ||
        ('dehydrated' in state && state.dehydrated !== null))
    ) {
      return false
    }
    if (fiber.child) pending.push(fiber.child)
    if (fiber.sibling) pending.push(fiber.sibling)
  }
  return true
}

/**
 * Waits until the loaded document has hydrated, for a page this suite's `test` does not wrap,
 * such as an Electron window's.
 */
export async function waitUntilHydrated(page: Page) {
  await page.waitForFunction(isHydrated, undefined, {
    polling: 100,
    timeout: HYDRATION_TIMEOUT_MS,
  })
}

async function waitForHydration(page: Page, appOrigin: string) {
  if (new URL(page.url()).origin !== appOrigin) return
  await waitUntilHydrated(page)
}

/**
 * The Platform checks' `test`, for the fixture and the live suites alike. Its page waits, after every document load it is asked for
 * (`goto`, `reload`, and a history step that loads a document), until the page has hydrated, so
 * a check's first click, key press or hover reaches React. A history step within the document
 * renders on the client and passes at once. Pages without JavaScript never hydrate and are not
 * waited on.
 */
export const test = base.extend({
  page: async ({ page, javaScriptEnabled, baseURL }, use) => {
    // A page on the app under test: the suite's base URL, or the fixture server it starts.
    const appOrigin = new URL(baseURL ?? fixtureOrigin).origin
    if (javaScriptEnabled) {
      const goto = page.goto.bind(page)
      const reload = page.reload.bind(page)
      const goBack = page.goBack.bind(page)
      const goForward = page.goForward.bind(page)
      page.goto = async (url, options) => {
        const response = await goto(url, options)
        await waitForHydration(page, appOrigin)
        return response
      }
      page.reload = async (options) => {
        const response = await reload(options)
        await waitForHydration(page, appOrigin)
        return response
      }
      page.goBack = async (options) => {
        const response = await goBack(options)
        await waitForHydration(page, appOrigin)
        return response
      }
      page.goForward = async (options) => {
        const response = await goForward(options)
        await waitForHydration(page, appOrigin)
        return response
      }
    }
    await use(page)
  },
})
