import { recordMaterializedAccessKeys } from '@/lib/execution/payloads/access-keys'
import {
  isLargeArrayManifest,
  materializeLargeArrayManifest,
} from '@/lib/execution/payloads/large-array-manifest'
import {
  getLargeValueMaterializationError,
  isLargeValueRef,
} from '@/lib/execution/payloads/large-value-ref'
import {
  assertInlineMaterializationSize,
  type ExecutionMaterializationContext,
  MAX_INLINE_MATERIALIZATION_BYTES,
} from '@/lib/execution/payloads/materialization.server'
import { materializeLargeValueRef } from '@/lib/execution/payloads/store'

interface InlineMaterializationOptions {
  maxBytes?: number
}

type InlineMaterializationMemo = WeakMap<object, Promise<unknown>>

export function getInlineJsonByteLength(value: unknown): number | undefined {
  const json = JSON.stringify(value)
  return json === undefined ? undefined : Buffer.byteLength(json, 'utf8')
}

function getArrayItemByteLength(value: unknown): number {
  return getInlineJsonByteLength(value) ?? Buffer.byteLength('null', 'utf8')
}

function getObjectEntryByteLength(key: string, value: unknown): number | undefined {
  const valueBytes = getInlineJsonByteLength(value)
  if (valueBytes === undefined) {
    return undefined
  }
  return Buffer.byteLength(JSON.stringify(key), 'utf8') + 1 + valueBytes
}

function withLocalLargeValueExecutionIds(
  context: ExecutionMaterializationContext | undefined,
  materializedValue: unknown
): ExecutionMaterializationContext | undefined {
  if (!context) {
    return context
  }
  recordMaterializedAccessKeys(context, materializedValue)
  return {
    ...context,
    largeValueKeys: context.largeValueKeys,
    fileKeys: context.fileKeys,
  }
}

export async function materializeInlineExecutionValue(
  value: unknown,
  context: ExecutionMaterializationContext | undefined,
  options: InlineMaterializationOptions = {}
): Promise<unknown> {
  return materializeInlineExecutionValueWithinBudget(
    value,
    context,
    options.maxBytes ?? MAX_INLINE_MATERIALIZATION_BYTES,
    new WeakMap<object, Promise<unknown>>()
  )
}

async function materializeInlineExecutionValueWithinBudget(
  value: unknown,
  context: ExecutionMaterializationContext | undefined,
  maxBytes: number,
  memo: InlineMaterializationMemo
): Promise<unknown> {
  if (isLargeArrayManifest(value)) {
    assertInlineMaterializationSize(value.byteSize, maxBytes)
    const materialized = await materializeLargeArrayManifest(value, {
      ...context,
      maxBytes,
    })
    return materializeInlineExecutionValueWithinBudget(
      materialized,
      withLocalLargeValueExecutionIds(context, materialized),
      maxBytes,
      memo
    )
  }

  if (isLargeValueRef(value)) {
    assertInlineMaterializationSize(value.size, maxBytes)
    const materialized = await materializeLargeValueRef(value, {
      ...context,
      maxBytes,
    })
    if (materialized === undefined) {
      throw getLargeValueMaterializationError(value)
    }
    return materializeInlineExecutionValueWithinBudget(
      materialized,
      withLocalLargeValueExecutionIds(context, materialized),
      maxBytes,
      memo
    )
  }

  if (!value || typeof value !== 'object') {
    const valueBytes = getInlineJsonByteLength(value)
    if (valueBytes !== undefined) {
      assertInlineMaterializationSize(valueBytes, maxBytes)
    }
    return value
  }

  const cached = memo.get(value)
  if (cached) {
    return cached
  }

  if (Array.isArray(value)) {
    const result: unknown[] = []
    memo.set(value, Promise.resolve(result))
    let usedBytes = Buffer.byteLength('[]', 'utf8')
    for (const item of value) {
      const commaBytes = result.length > 0 ? 1 : 0
      const remainingBytes = maxBytes - usedBytes - commaBytes
      assertInlineMaterializationSize(0, remainingBytes)
      const materializedItem = await materializeInlineExecutionValueWithinBudget(
        item,
        context,
        remainingBytes,
        memo
      )
      const itemBytes = getArrayItemByteLength(materializedItem)
      usedBytes += commaBytes + itemBytes
      assertInlineMaterializationSize(usedBytes, maxBytes)
      result.push(materializedItem)
    }
    return result
  }

  const result: Record<string, unknown> = {}
  memo.set(value, Promise.resolve(result))
  let usedBytes = Buffer.byteLength('{}', 'utf8')
  for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
    const keyBytes = Buffer.byteLength(JSON.stringify(key), 'utf8') + 1
    const commaBytes = Object.keys(result).length > 0 ? 1 : 0
    const remainingBytes = maxBytes - usedBytes - commaBytes - keyBytes
    assertInlineMaterializationSize(0, remainingBytes)
    const materializedEntryValue = await materializeInlineExecutionValueWithinBudget(
      entryValue,
      context,
      remainingBytes,
      memo
    )
    const entryBytes = getObjectEntryByteLength(key, materializedEntryValue)
    if (entryBytes !== undefined) {
      usedBytes += commaBytes + entryBytes
      assertInlineMaterializationSize(usedBytes, maxBytes)
    }
    result[key] = materializedEntryValue
  }
  return result
}
