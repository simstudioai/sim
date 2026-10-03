import { collectUserFileKeys } from '@/lib/core/utils/user-file'
import { collectLargeValueKeys } from '@/lib/execution/payloads/large-execution-value'

export interface ExactAccessKeyContext {
  largeValueKeys?: string[]
  fileKeys?: string[]
}

export function mergeUniqueKeys(target: string[], source: readonly string[]): void {
  if (source.length === 0) {
    return
  }
  const existingKeys = new Set(target)
  for (const key of source) {
    if (!existingKeys.has(key)) {
      existingKeys.add(key)
      target.push(key)
    }
  }
}

export function mergeLargeValueKeys(context: ExactAccessKeyContext, keys: readonly string[]): void {
  if (keys.length === 0) {
    return
  }
  context.largeValueKeys ??= []
  mergeUniqueKeys(context.largeValueKeys, keys)
}

export function mergeFileKeys(context: ExactAccessKeyContext, keys: readonly string[]): void {
  if (keys.length === 0) {
    return
  }
  context.fileKeys ??= []
  mergeUniqueKeys(context.fileKeys, keys)
}

export function recordMaterializedAccessKeys(context: ExactAccessKeyContext, value: unknown): void {
  mergeLargeValueKeys(context, collectLargeValueKeys(value))
  mergeFileKeys(context, collectUserFileKeys(value))
}

/** Canonical workspace/workflow/execution scope carried by an execution storage key. */
export function getExecutionKeyParts(key: string):
  | {
      workspaceId: string
      workflowId: string
      executionId: string
    }
  | undefined {
  const parts = key.split('/')
  if (parts[0] !== 'execution' || parts.length < 5) {
    return undefined
  }

  return {
    workspaceId: parts[1],
    workflowId: parts[2],
    executionId: parts[3],
  }
}
