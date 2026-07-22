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
  if (trace !== 'off' || screenshot !== 'only-on-failure' || video !== 'off') {
    throw new Error(
      'People workflows must disable trace/video while retaining failure-only screenshots'
    )
  }
}
