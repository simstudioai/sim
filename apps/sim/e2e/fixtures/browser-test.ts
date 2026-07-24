import { test as base } from '@playwright/test'
import { installBrowserNetworkGuard } from '../support/browser-network'

interface BrowserFixtures {
  browserNetworkGuard: undefined
}

export const test = base.extend<BrowserFixtures>({
  browserNetworkGuard: [
    async ({ context }, use) => {
      const guard = await installBrowserNetworkGuard(context)
      const failures: unknown[] = []
      try {
        await use(undefined)
      } catch (error) {
        failures.push(error)
      }
      try {
        guard.assertNoUnexpectedRequests()
      } catch (error) {
        failures.push(error)
      }
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) {
        throw new AggregateError(failures, 'Browser test and network isolation both failed')
      }
    },
    { auto: true },
  ],
})

export { expect } from '@playwright/test'
