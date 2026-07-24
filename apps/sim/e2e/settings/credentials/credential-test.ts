import type { Page, TestInfo } from '@playwright/test'
import { redactCredentialDiagnostic } from '../../../lib/testing/credential-diagnostic-redaction'
import { test as personaTest } from '../../fixtures/persona-test'

export interface CredentialCleanupRegistry {
  register(label: string, cleanup: () => Promise<void>): void
  protect(page: Page): void
}

interface CredentialFixtures {
  credentialArtifactSafety: undefined
  credentialCleanup: CredentialCleanupRegistry
}

export const test = personaTest.extend<CredentialFixtures>({
  credentialArtifactSafety: [
    async ({ browserName: _browserName }, use, testInfo) => {
      assertCredentialArtifactPolicy(testInfo)
      const attachmentCount = testInfo.attachments.length
      await use(undefined)
      if (testInfo.attachments.length !== attachmentCount) {
        throw new Error('Credential E2E tests must not create report attachments')
      }
    },
    { auto: true },
  ],
  credentialCleanup: async ({ contextForPersona: _contextForPersona }, use, testInfo) => {
    const cleanups: Array<{ label: string; run: () => Promise<void> }> = []
    const protectedPages = new Set<Page>()
    await use({
      register(label, cleanup) {
        cleanups.push({ label, run: cleanup })
      },
      protect(page) {
        protectedPages.add(page)
      },
    })

    const failures: unknown[] = []
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup.run()
      } catch (error) {
        failures.push(new Error(`Credential cleanup failed: ${cleanup.label}`, { cause: error }))
      }
    }
    if (testInfo.status !== testInfo.expectedStatus || failures.length > 0) {
      redactCredentialTestErrors(testInfo)
      for (const page of protectedPages) {
        if (page.isClosed()) continue
        try {
          await page.evaluate(() => {
            document.documentElement.replaceChildren(document.createElement('head'))
          })
        } catch (error) {
          failures.push(new Error('Unable to sanitize a failed credential page', { cause: error }))
        }
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Credential E2E cleanup failed')
    }
  },
})

export { expect } from '@playwright/test'

function assertCredentialArtifactPolicy(testInfo: TestInfo): void {
  const { trace, screenshot, video } = testInfo.project.use
  if (trace !== 'off' || screenshot !== 'off' || video !== 'off') {
    throw new Error('Credential E2E project must disable trace, screenshot, and video artifacts')
  }
}

function redactCredentialTestErrors(testInfo: TestInfo): void {
  for (const testError of testInfo.errors) {
    const mutableError = testError as {
      message?: string
      stack?: string
      errorContext?: string
    }
    mutableError.message = redactCredentialDiagnostic(mutableError.message)
    mutableError.stack = redactCredentialDiagnostic(mutableError.stack)
    mutableError.errorContext = redactCredentialDiagnostic(mutableError.errorContext)
  }
}
