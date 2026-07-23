import type { TestInfo } from '@playwright/test'
import { test as personaTest } from '../../fixtures/persona-test'

interface WorkflowFixtures {
  workflowArtifactSafety: undefined
}

export const test = personaTest.extend<WorkflowFixtures>({
  workflowArtifactSafety: [
    async ({ browserName: _browserName }, use, testInfo) => {
      assertWorkflowArtifactPolicy(testInfo)
      await use(undefined)
    },
    { auto: true },
  ],
})

export { expect } from '@playwright/test'

function assertWorkflowArtifactPolicy(testInfo: TestInfo): void {
  const { trace, screenshot, video } = testInfo.project.use
  if (trace !== 'retain-on-failure' || screenshot !== 'only-on-failure' || video !== 'off') {
    throw new Error(
      'Settings workflows must retain failure traces/screenshots and keep video disabled by default'
    )
  }
}
