import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'

/** Maximum inline tool response size; binary file outputs use stored descriptors. */
export const MAX_TOOL_RESPONSE_BODY_BYTES = 10 * 1024 * 1024

/**
 * Fails a streamed result as soon as its serialized rows alone exceed
 * {@link MAX_TOOL_RESPONSE_BODY_BYTES}. Bytes are counted the way the response serializes them
 * (UTF-8, plus the array's brackets and commas), and the body around the rows is larger still, so
 * this fails exactly the results the executor's response limit would reject, but before the rest
 * of the result is read into memory. The error is the same one that limit throws.
 */
export function createResponseRowsBudget(toolId: string) {
  let bytes = 1
  return {
    admit(row: unknown): void {
      const serialized = JSON.stringify(row)
      bytes += (serialized === undefined ? 4 : Buffer.byteLength(serialized, 'utf8')) + 1
      if (bytes > MAX_TOOL_RESPONSE_BODY_BYTES) {
        throw new PayloadSizeLimitError({
          label: `${toolId} response body`,
          maxBytes: MAX_TOOL_RESPONSE_BODY_BYTES,
          observedBytes: bytes,
        })
      }
    },
  }
}
