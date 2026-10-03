import { vi } from 'vitest'

/** Mirrors `AGENT.CUSTOM_TOOL_PREFIX` in `@/executor/constants`. */
const CUSTOM_TOOL_PREFIX = 'custom_'

/**
 * Faithful copy of `postProcessToolOutput` in `@/tools`: custom tools keep their output as-is,
 * every other tool drops its `__`-prefixed internal fields.
 */
function postProcessToolOutput(
  toolId: string,
  output: Record<string, unknown>
): Record<string, unknown> {
  if (toolId.startsWith(CUSTOM_TOOL_PREFIX)) return output
  if (typeof output !== 'object' || output === null || Array.isArray(output)) return output
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(output)) {
    if (!key.startsWith('__')) result[key] = value
  }
  return result
}

/**
 * Controllable mock functions for `@/tools`. Mocking `@/tools` keeps the tool registry (and its
 * ~6k-module graph) out of the test.
 *
 * @example
 * ```ts
 * import { toolsMockFns } from '@sim/testing/mocks/tools.mock'
 *
 * toolsMockFns.mockExecuteTool.mockResolvedValue({ success: true, output: { ok: true } })
 * ```
 */
export const toolsMockFns = {
  /** Bare `vi.fn()`: resolves `undefined` until a test sets a `ToolResponse`. */
  mockExecuteTool: vi.fn(),
  /** Defaults to the real `__`-field stripping semantics. */
  mockPostProcessToolOutput: vi.fn(postProcessToolOutput),
}

/**
 * Static mock module for `@/tools`.
 *
 * @example
 * ```ts
 * vi.mock('@/tools', () => toolsMock)
 * ```
 */
export const toolsMock = {
  executeTool: toolsMockFns.mockExecuteTool,
  postProcessToolOutput: toolsMockFns.mockPostProcessToolOutput,
}
