/**
 * `.sim/base.json` at the root of a workspace source directory: what each resource was when the
 * directory was last read or applied in one environment. It binds keys to ids (and a table's
 * column keys to column ids) and holds each resource's fingerprint, so an apply can tell a local
 * edit from a server one (`decide`). Workflows keep their own `workflows/<key>/.sim/` lock and
 * base; the root only records each workflow's id.
 *
 * Version policy as the lock's: adding an optional field does not bump `version`, and unknown
 * data goes under an `x-` key, which the parser tolerates and preserves.
 */
import { isRecordLike } from '@sim/utils/object'
import { type Json, jsonInput, type LockExtensionKey, readExtensions } from '@sim/workflow-code'
import { diagnostic, type WorkspaceDiagnostic } from './diagnostics'
import { isWorkspaceKind, type WorkspaceKind } from './kind'
import { isResourceKey } from './layout'

/** `rf1:` + lowercase hex SHA-256 of a resource's canonical declaration. */
export type ResourceFingerprint = `rf1:${string}`

/** `kind:key`, the base's resource address. */
export type ResourceAddress = `${WorkspaceKind}:${string}`

export interface BaseColumn {
  [extension: LockExtensionKey]: Json
  id: string
  /** Select option name → option id. */
  options?: Record<string, string>
}

export interface BaseBlob {
  [extension: LockExtensionKey]: Json
  id: string
  rev: number | string
  sha256: string
}

export interface BaseResource {
  [extension: LockExtensionKey]: Json
  id: string
  /** Absent for a workflow, whose freshness lives in its own `.sim/base.json`. */
  fingerprint?: ResourceFingerprint
  columns?: Record<string, BaseColumn>
  blobs?: Record<string, BaseBlob>
}

export interface WorkspaceBaseV1 {
  [extension: LockExtensionKey]: Json
  version: 1
  workspaceId: string
  resources: Record<ResourceAddress, BaseResource>
}

export type BaseDiagnostic = WorkspaceDiagnostic<
  'E_BASE_JSON' | 'E_BASE_VERSION' | 'E_BASE_SHAPE' | 'E_BASE_UNKNOWN_FIELD'
>

const BASE_FIELDS = ['version', 'workspaceId', 'resources']
const RESOURCE_FIELDS = ['id', 'fingerprint', 'columns', 'blobs']
const COLUMN_FIELDS = ['id', 'options']
const BLOB_FIELDS = ['id', 'rev', 'sha256']
const FINGERPRINT = /^rf1:[0-9a-f]{64}$/
const SHA256 = /^[0-9a-f]{64}$/

/** The address of a resource in the base. */
export function resourceAddress(kind: WorkspaceKind, key: string): ResourceAddress {
  return `${kind}:${key}`
}

/** The kind and key of an address, or `null` when it is not one. */
export function parseResourceAddress(address: string): { kind: WorkspaceKind; key: string } | null {
  const colon = address.indexOf(':')
  const kind = address.slice(0, colon)
  const key = address.slice(colon + 1)
  return colon > 0 && isWorkspaceKind(kind) && isResourceKey(key) ? { kind, key } : null
}

/** An empty base for `workspaceId`. */
export function emptyBase(workspaceId: string): WorkspaceBaseV1 {
  return { version: 1, workspaceId, resources: {} }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecordLike(value) && Object.values(value).every(isNonEmptyString)
}

/**
 * Validates a base (an object, or its JSON text). Unknown fields are refused unless they are `x-`
 * extensions, which are kept; every problem is reported, each with its JSON Pointer in `path`.
 */
export function parseWorkspaceBase(
  input: unknown
):
  | { base: WorkspaceBaseV1; diagnostics?: undefined }
  | { base?: undefined; diagnostics: BaseDiagnostic[] } {
  const parsed = jsonInput(input)
  if (!parsed) {
    return { diagnostics: [diagnostic('E_BASE_JSON', 'The base is not valid JSON.', { path: '' })] }
  }
  const diagnostics: BaseDiagnostic[] = []
  const shape = (path: string, message: string) =>
    diagnostics.push(diagnostic('E_BASE_SHAPE', message, { path }))
  const extensionsOf = (value: Record<string, unknown>, known: string[], path: string) =>
    readExtensions(value, known, (field, problem) =>
      diagnostics.push(
        problem === 'unknown'
          ? diagnostic('E_BASE_UNKNOWN_FIELD', `Unknown field "${field}".`, {
              path: `${path}/${field}`,
              hint: 'Keep data the base does not define under an `x-` key.',
            })
          : diagnostic('E_BASE_SHAPE', `Extension "${field}" is not JSON.`, {
              path: `${path}/${field}`,
            })
      )
    )

  const value = parsed.json
  if (!isRecordLike(value)) {
    shape('', 'The base must be an object.')
    return { diagnostics }
  }
  if (value.version !== 1) {
    return {
      diagnostics: [
        diagnostic('E_BASE_VERSION', 'The base version must be 1.', { path: '/version' }),
      ],
    }
  }
  if (!isNonEmptyString(value.workspaceId)) shape('/workspaceId', 'workspaceId must be a string.')
  const resources: Record<ResourceAddress, BaseResource> = {}
  if (!isRecordLike(value.resources)) shape('/resources', 'resources must be an object.')
  else {
    for (const [address, raw] of Object.entries(value.resources)) {
      const path = `/resources/${address.replace(/~/g, '~0').replace(/\//g, '~1')}`
      const target = parseResourceAddress(address)
      if (!target) {
        shape(path, `"${address}" is not a resource address (\`kind:key\`).`)
        continue
      }
      const entry = parseResource(raw, path, shape, extensionsOf)
      if (entry) resources[resourceAddress(target.kind, target.key)] = entry
    }
  }
  const extensions = extensionsOf(value, BASE_FIELDS, '')
  if (diagnostics.length > 0) return { diagnostics }
  return {
    base: {
      ...extensions,
      version: 1,
      workspaceId: value.workspaceId as string,
      resources,
    },
  }
}

function parseResource(
  raw: unknown,
  path: string,
  shape: (path: string, message: string) => void,
  extensionsOf: (
    value: Record<string, unknown>,
    known: string[],
    path: string
  ) => Record<LockExtensionKey, Json>
): BaseResource | null {
  if (!isRecordLike(raw) || !isNonEmptyString(raw.id)) {
    shape(path, 'A resource entry needs an `id`.')
    return null
  }
  const entry: BaseResource = { ...extensionsOf(raw, RESOURCE_FIELDS, path), id: raw.id }
  if (raw.fingerprint !== undefined) {
    if (typeof raw.fingerprint === 'string' && FINGERPRINT.test(raw.fingerprint)) {
      entry.fingerprint = raw.fingerprint as ResourceFingerprint
    } else shape(`${path}/fingerprint`, 'fingerprint must be `rf1:` and 64 hex digits.')
  }
  if (raw.columns !== undefined) {
    if (!isRecordLike(raw.columns)) shape(`${path}/columns`, 'columns must be an object.')
    else {
      const columns: Record<string, BaseColumn> = {}
      for (const [key, column] of Object.entries(raw.columns)) {
        const columnPath = `${path}/columns/${key}`
        if (!isRecordLike(column) || !isNonEmptyString(column.id)) {
          shape(columnPath, 'A column entry needs an `id`.')
          continue
        }
        columns[key] = { ...extensionsOf(column, COLUMN_FIELDS, columnPath), id: column.id }
        if (column.options !== undefined) {
          if (isStringRecord(column.options)) columns[key].options = { ...column.options }
          else shape(`${columnPath}/options`, 'options must map option names to ids.')
        }
      }
      entry.columns = columns
    }
  }
  if (raw.blobs !== undefined) {
    if (!isRecordLike(raw.blobs)) shape(`${path}/blobs`, 'blobs must be an object.')
    else {
      const blobs: Record<string, BaseBlob> = {}
      for (const [name, blob] of Object.entries(raw.blobs)) {
        const blobPath = `${path}/blobs/${name}`
        const rev = isRecordLike(blob) ? blob.rev : undefined
        if (
          !isRecordLike(blob) ||
          !isNonEmptyString(blob.id) ||
          !(typeof rev === 'number' || isNonEmptyString(rev)) ||
          typeof blob.sha256 !== 'string' ||
          !SHA256.test(blob.sha256)
        ) {
          shape(blobPath, 'A blob entry needs an `id`, a `rev` and a `sha256`.')
          continue
        }
        blobs[name] = {
          ...extensionsOf(blob, BLOB_FIELDS, blobPath),
          id: blob.id,
          rev,
          sha256: blob.sha256,
        }
      }
      entry.blobs = blobs
    }
  }
  return entry
}
