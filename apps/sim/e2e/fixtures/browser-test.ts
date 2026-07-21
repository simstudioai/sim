import { test as base } from '@playwright/test'
import { installBrowserNetworkGuard } from '../support/browser-network'

interface BrowserFixtures {
  browserNetworkGuard: undefined
}

export const test = base.extend<BrowserFixtures>({
  browserNetworkGuard: [
    async ({ context }, use) => {
      const guard = await installBrowserNetworkGuard(context)
      try {
        await use(undefined)
      } finally {
        guard.assertNoUnexpectedRequests()
      }
    },
    { auto: true },
  ],
})

export { expect } from '@playwright/test'
