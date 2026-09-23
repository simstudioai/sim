import { isRecordLike } from '@sim/utils/object'
import { ToolActivity } from '@/lib/mothership/generated/protocol'

/** One provider-independent activity shape for both parsed and still-streaming calls. */
export function readToolActivity(
  params?: Record<string, unknown>,
  streamingArgs?: string
): ToolActivity | undefined {
  const activity = params?.activity
  if (isRecordLike(activity)) {
    const parsed = ToolActivity.safeParse(activity)
    return parsed.success ? parsed.data : undefined
  }
  if (!streamingArgs) return undefined
  let depth = 0
  let quoted = false
  let escaped = false
  let stringStart = 0
  let offset: number | undefined
  for (let index = 0; index < streamingArgs.length; index++) {
    const char = streamingArgs[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (quoted && char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      if (!quoted) stringStart = index
      else if (depth === 1 && streamingArgs.slice(stringStart, index + 1) === '"activity"') {
        const objectStart = /^\s*:\s*\{/.exec(streamingArgs.slice(index + 1))
        if (objectStart) offset = index + objectStart[0].length
      }
      quoted = !quoted
      continue
    }
    if (quoted) continue
    if (char === '{' || char === '[') depth++
    if (char === '}' || char === ']') depth--
    if (offset === undefined || char !== '}' || depth !== 1) continue
    try {
      const parsed = ToolActivity.safeParse(JSON.parse(streamingArgs.slice(offset, index + 1)))
      return parsed.success ? parsed.data : undefined
    } catch {
      return undefined
    }
  }
  return undefined
}
