import { isPlainRecord } from '@sim/utils/object'
import type { Message } from '@/providers/types'

/** Stored history is admitted as a whole group, with adjacent, fully resolved call batches. */
export function parseConversationHistoryGroup(
  values: readonly unknown[]
): readonly Message[] | undefined {
  if (values.length === 0) return undefined
  const pending = new Set<string>()
  for (const value of values) {
    if (
      !isPlainRecord(value) ||
      typeof value.role !== 'string' ||
      !['system', 'user', 'assistant', 'tool', 'function'].includes(value.role)
    )
      return undefined

    const calls: string[] = []
    if (value.function_call != null) {
      const call = value.function_call
      if (
        !isPlainRecord(call) ||
        typeof call.name !== 'string' ||
        !call.name ||
        typeof call.arguments !== 'string'
      )
        return undefined
      calls.push(`function:${call.name}`)
    }
    if (value.tool_calls != null) {
      if (!Array.isArray(value.tool_calls) || (calls.length > 0 && value.tool_calls.length > 0))
        return undefined
      for (const call of value.tool_calls) {
        if (
          !isPlainRecord(call) ||
          typeof call.id !== 'string' ||
          !call.id ||
          call.type !== 'function' ||
          !isPlainRecord(call.function) ||
          typeof call.function.name !== 'string' ||
          !call.function.name ||
          typeof call.function.arguments !== 'string'
        )
          return undefined
        calls.push(`tool:${call.id}`)
      }
    }
    if (
      (calls.length > 0 && value.role !== 'assistant') ||
      (typeof value.content !== 'string' &&
        !(value.role === 'assistant' && value.content === null && calls.length > 0))
    )
      return undefined

    if (value.role === 'function' || value.role === 'tool') {
      const id = value.role === 'function' ? value.name : value.tool_call_id
      if (typeof id !== 'string' || !pending.delete(`${value.role}:${id}`)) return undefined
    } else {
      if (pending.size > 0) return undefined
      for (const call of calls) {
        if (pending.has(call)) return undefined
        pending.add(call)
      }
    }
  }
  return pending.size === 0 ? (values as readonly Message[]) : undefined
}
