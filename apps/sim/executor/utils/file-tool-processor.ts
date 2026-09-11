import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { omit } from '@sim/utils/object'
import { isCanonicalBase64 } from '@/lib/api/contracts/primitives'
import { isUserFile, type UserFileLike } from '@/lib/core/utils/user-file'
import {
  createInternalToolFilesResult,
  type InternalToolFile,
} from '@/lib/internal/tool-operations/file-result'
import { storeInternalToolFileResult } from '@/lib/internal/tool-operations/file-result.server'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import type { UserFile } from '@/executor/types'
import type { ToolDefinition } from '@/tools/types'

const logger = createLogger('FileToolProcessor')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Strip a data URI prefix while preserving legitimate zero-byte payloads. */
function stripBase64DataUri(value: string): string {
  return /^data:[^,]*;base64,/i.test(value) ? value.slice(value.indexOf(',') + 1) : value
}

/** Normalize wrapped or unpadded base64url into canonical RFC 4648 form. */
function normalizeBase64(payload: string): string {
  const compact = payload.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')
  const remainder = compact.length % 4
  return remainder === 0 ? compact : compact + '='.repeat(4 - remainder)
}

function assertFileSize(size: number, name: string, remainingBytes: number): void {
  if (size > remainingBytes) {
    throw new Error(`File '${name}' exceeds the maximum allowed size of ${remainingBytes} bytes`)
  }
}

/** Replaces aliases by identity, preserving message-to-file associations without inline bytes. */
function replaceFileReferences(
  value: unknown,
  replacements: ReadonlyMap<object, UserFileLike>,
  visited = new WeakMap<object, unknown>()
): unknown {
  type PendingCopy =
    | { kind: 'array'; source: unknown[]; target: unknown[] }
    | { kind: 'object'; source: object; target: Record<string, unknown> }
  const pending: PendingCopy[] = []

  function copyOrReplace(item: unknown): unknown {
    if (typeof item !== 'object' || item === null) return item
    const replacement = replacements.get(item)
    if (replacement) return replacement
    if (isUserFile(item) || Buffer.isBuffer(item)) return item
    if (visited.has(item)) return visited.get(item)
    if (Array.isArray(item)) {
      const target: unknown[] = []
      visited.set(item, target)
      pending.push({ kind: 'array', source: item, target })
      return target
    }
    const prototype = Object.getPrototypeOf(item)
    if (prototype !== Object.prototype && prototype !== null) return item
    const target: Record<string, unknown> = Object.create(prototype)
    visited.set(item, target)
    pending.push({ kind: 'object', source: item, target })
    return target
  }

  const result = copyOrReplace(value)
  while (pending.length > 0) {
    const copy = pending.pop()!
    if (copy.kind === 'array') {
      for (const item of copy.source) copy.target.push(copyOrReplace(item))
    } else {
      for (const [key, item] of Object.entries(copy.source)) {
        Object.defineProperty(copy.target, key, {
          value: copyOrReplace(item),
          enumerable: true,
          writable: true,
          configurable: true,
        })
      }
    }
  }
  return result
}

/** Stores declared file outputs once, for both workflow and Copilot callers. */
export class FileToolProcessor {
  static async processToolOutputs(
    toolOutput: Record<string, unknown>,
    toolConfig: ToolDefinition,
    context: InternalToolOperationContext,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    if (!toolConfig.outputs) return toolOutput
    signal?.throwIfAborted()
    const pendingFiles = new Map<object, InternalToolFile>()
    const replacements = new Map<object, UserFileLike>()
    let remainingBytes = MAX_FILE_SIZE

    for (const [outputKey, outputDef] of Object.entries(toolConfig.outputs)) {
      if (outputDef.type !== 'file' && outputDef.type !== 'file[]') continue
      const value = toolOutput[outputKey]
      if (value === undefined || value === null) continue
      try {
        if (outputDef.type === 'file[]' && !Array.isArray(value)) {
          throw new Error(`Output '${outputKey}' is marked as file[] but is not an array`)
        }
        const files = outputDef.type === 'file[]' && Array.isArray(value) ? value : [value]
        for (const file of files) {
          signal?.throwIfAborted()
          if (!isRecord(file)) throw new Error('File output must be a file object')
          if (isUserFile(file)) {
            if (file.base64 !== undefined) replacements.set(file, omit(file, ['base64']))
            continue
          }
          if (pendingFiles.has(file)) continue
          const buffered = await FileToolProcessor.readFile(file, context, remainingBytes, signal)
          remainingBytes -= buffered.buffer.length
          pendingFiles.set(file, buffered)
        }
      } catch (error) {
        signal?.throwIfAborted()
        logger.error(`Error processing file output '${outputKey}':`, error)
        throw new Error(`Failed to process file output '${outputKey}': ${toError(error).message}`)
      }
    }

    const originals = [...pendingFiles.keys()]
    const present = (files: readonly UserFile[]) => {
      originals.forEach((original, index) => {
        replacements.set(original, files[index]!)
      })
      if (replacements.size === 0) return toolOutput
      const output = replaceFileReferences(toolOutput, replacements)
      if (!isRecord(output)) throw new Error('Tool file output must be an object')
      return output
    }
    if (pendingFiles.size === 0) return present([])
    return storeInternalToolFileResult(
      createInternalToolFilesResult([...pendingFiles.values()], present),
      context,
      (output) => {
        if (!isRecord(output)) throw new Error('Tool file output must be an object')
        return output
      },
      signal
    )
  }

  private static async readFile(
    file: Record<string, unknown>,
    context: InternalToolOperationContext,
    remainingBytes: number,
    signal?: AbortSignal
  ): Promise<InternalToolFile> {
    if (typeof file.name !== 'string' || !file.name.trim()) {
      throw new Error('File output requires a filename')
    }
    const name = file.name
    const mimeType =
      (typeof file.mimeType === 'string' && file.mimeType) ||
      (typeof file.contentType === 'string' && file.contentType) ||
      'application/octet-stream'
    let buffer: Buffer | undefined
    const data = file.data

    if (Buffer.isBuffer(data)) {
      assertFileSize(data.length, name, remainingBytes)
      buffer = data
    } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      assertFileSize(data.byteLength, name, remainingBytes)
      buffer =
        data instanceof ArrayBuffer
          ? Buffer.from(data)
          : Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    } else if (Array.isArray(data) || (isRecord(data) && data.type === 'Buffer')) {
      const bytes = Array.isArray(data) ? data : data.data
      if (!Array.isArray(bytes)) throw new Error(`Invalid serialized buffer format for ${name}`)
      assertFileSize(bytes.length, name, remainingBytes)
      if (!bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
        throw new Error(`Invalid serialized buffer format for ${name}`)
      }
      buffer = Buffer.from(bytes)
    } else if (typeof data === 'string') {
      const payload = stripBase64DataUri(data)
      const base64 = normalizeBase64(payload)
      const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
      assertFileSize(Math.floor((base64.length * 3) / 4) - padding, name, remainingBytes)
      if (!isCanonicalBase64(base64) || (payload.length > 0 && base64.length === 0)) {
        throw new Error(`File '${name}' has invalid base64 data`)
      }
      buffer = Buffer.from(base64, 'base64')
    }

    if ((!buffer || buffer.length === 0) && typeof file.url === 'string' && file.url) {
      buffer = await downloadFileFromUrl(file.url, {
        maxBytes: remainingBytes,
        userId: context.userId,
        ...(signal ? { signal } : {}),
      })
    }
    signal?.throwIfAborted()
    if (!buffer) {
      throw new Error(`File data for '${name}' must have either 'data' (Buffer/base64) or 'url'`)
    }
    assertFileSize(buffer.length, name, remainingBytes)
    return { buffer, name, mimeType }
  }

  static hasFileOutputs(toolConfig: ToolDefinition): boolean {
    return Object.values(toolConfig.outputs ?? {}).some(
      (output) => output.type === 'file' || output.type === 'file[]'
    )
  }
}
