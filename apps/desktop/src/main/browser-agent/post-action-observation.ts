import type { BrowserToolName } from '@sim/browser-protocol'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { ToolError } from '@/main/browser-agent/errors'

const OBSERVABLE_ACTIONS: ReadonlySet<BrowserToolName> = new Set([
  'browser_click',
  'browser_type',
  'browser_press_key',
  'browser_fill_form',
  'browser_scroll',
  'browser_hover',
])

/** Validate before dispatch; an observation failure must never invite replay of a completed action. */
export async function withPostActionObservation(
  tool: BrowserToolName,
  params: Record<string, unknown>,
  action: (params: Record<string, unknown>) => Promise<unknown>,
  observe: (query: string | undefined) => Promise<unknown>,
  assertCurrent: () => void
): Promise<unknown> {
  const request = params.observe
  if (request === undefined) return action(params)
  if (
    !OBSERVABLE_ACTIONS.has(tool) ||
    !isRecordLike(request) ||
    Object.keys(request).some((key) => key !== 'query') ||
    (request.query !== undefined &&
      (typeof request.query !== 'string' ||
        request.query.length === 0 ||
        request.query.length > 4096))
  ) {
    throw new ToolError(
      'observe must be {} or {query: nonempty text up to 4096 characters} on a supported action.'
    )
  }
  const query = typeof request.query === 'string' ? request.query : undefined
  const { observe: _observe, ...actionParams } = params
  const result = await action(actionParams)
  assertCurrent()
  let observation: unknown
  try {
    observation = { ok: true, result: await observe(query) }
  } catch (error) {
    assertCurrent()
    observation = {
      ok: false,
      error: getErrorMessage(error),
      note: 'The action already ran. Inspect its result; do not repeat it just because observation failed.',
    }
  }
  assertCurrent()
  return isRecordLike(result) ? { ...result, observation } : { result, observation }
}
