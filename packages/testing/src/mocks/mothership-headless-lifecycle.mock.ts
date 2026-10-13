import { vi } from 'vitest'

/** Controllable headless Copilot lifecycle for route, inbox, task, and Slack tests. */
export const mothershipHeadlessLifecycleMockFns = {
  mockRunHeadlessCopilotLifecycle: vi.fn(),
}

/** Static mock module for `@/lib/mothership/request/lifecycle/headless`. */
export const mothershipHeadlessLifecycleMock = {
  runHeadlessCopilotLifecycle: mothershipHeadlessLifecycleMockFns.mockRunHeadlessCopilotLifecycle,
}
