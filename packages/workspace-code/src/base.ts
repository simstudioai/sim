/**
 * `.sim/base.json` at the root of a workspace source directory: what each resource was when the
 * directory was last read or applied in one environment. It binds keys to ids (and a table's
 * column keys to column ids) and holds each resource's fingerprint, so an apply can tell a local
 * edit from a server one. Workflows keep their own `workflows/<key>/.sim/` lock and
 * base; the root only records each workflow's id.
 *
 * Version policy as the lock's: adding an optional field does not bump `version`, and unknown
 * data goes under an `x-` key, which the parser tolerates and preserves. A format change adds its
 * step to {@link upgradeWorkspaceBase}, which every read goes through.
 */
import { isRecordLike } from '@sim/utils/object'
import {
  fieldNames,
  isNonEmptyString,
  type Json,
  jsonInput,
  type LockExtensionKey,
  pointerSegment,
  readExtensions,
} from '@sim/workflow-code'
import { diagnostic, type WorkspaceDiagnostic } from './diagnostics'
import { isWorkspaceKind, SHA256_HEX, type WorkspaceKind } from './kind'
import { isFileKey, isResourceKey, isSecretName } from './layout'
import { type KeyShape, WORKSPACE_KIND_SPECS } from './specs'

/** `rf1:` + lowercase hex SHA-256 of a resource's canonical declaration. */
export type ResourceFingerprint = `rf1:${string}`

/** `kind:key`, the base's resource address. */
type ResourceAddress = `${WorkspaceKind}:${string}`

/** A table column's ids in the base. */
export type BaseColumn = {
  [extension: LockExtensionKey]: Json
  id: string
  /** Select option name → option id. */
  options?: Record<string, string>
}

type BaseBlob = {
  [extension: LockExtensionKey]: Json
  id: string
  /** The content revision the hash was read at, as text (a numeric revision keeps its digits). */
  rev: string
  sha256: string
}

/** One resource's id, fingerprint, and column and blob ids, as the last get or apply saw them. */
export type BaseResource = {
  [extension: LockExtensionKey]: Json
  id: string
  /**
   * A workflow's hashes its stored source fingerprint, which a delete checks; an edit checks the
   * folder's own `.sim/base.json`.
   */
  fingerprint?: ResourceFingerprint
  columns?: Record<string, BaseColumn>
  blobs?: Record<string, BaseBlob>
  /** A table's managed rows, as the last get or apply saw them. */
  rows?: BaseRows
}

/**
 * A table's managed rows in the base: their fingerprint (`tableRowsFingerprint`) and the table's
 * `rows_version` when it was read, which moves on every row write, so an apply tells rows the
 * server changed since without reading them.
 */
export type BaseRows = {
  [extension: LockExtensionKey]: Json
  fingerprint: ResourceFingerprint
  version: number
}

/** `.sim/base.json`: what the server held for each resource at the last get or apply. */
export type WorkspaceBaseV1 = {
  [extension: LockExtensionKey]: Json
  version: 1
  workspaceId: string
  resources: Record<ResourceAddress, BaseResource>
}

type BaseDiagnostic = WorkspaceDiagnostic<
  'E_BASE_JSON' | 'E_BASE_VERSION' | 'E_BASE_SHAPE' | 'E_BASE_UNKNOWN_FIELD'
>

const BASE_FIELDS = fieldNames<WorkspaceBaseV1>({
  version: true,
  workspaceId: true,
  resources: true,
})
const RESOURCE_FIELDS = fieldNames<BaseResource>({
  id: true,
  fingerprint: true,
  columns: true,
  blobs: true,
  rows: true,
})
const ROWS_FIELDS = fieldNames<BaseRows>({ fingerprint: true, version: true })
const COLUMN_FIELDS = fieldNames<BaseColumn>({ id: true, options: true })
const BLOB_FIELDS = fieldNames<BaseBlob>({ id: true, rev: true, sha256: true })
const FINGERPRINT = /^rf1:[0-9a-f]{64}$/

function isResourceFingerprint(value: unknown): value is ResourceFingerprint {
  return typeof value === 'string' && FINGERPRINT.test(value)
}

const IS_KEY_OF_SHAPE: Record<KeyShape, (key: string) => boolean> = {
  resource: isResourceKey,
  path: isFileKey,
  'secret-name': isSecretName,
}

/** The address of a resource in the base. */
export function resourceAddress(kind: WorkspaceKind, key: string): ResourceAddress {
  return `${kind}:${key}`
}

/** The kind and key of an address, or `null` when it is not one. */
export function parseResourceAddress(address: string): { kind: WorkspaceKind; key: string } | null {
  const colon = address.indexOf(':')
  const kind = address.slice(0, colon)
  const key = address.slice(colon + 1)
  if (colon <= 0 || !isWorkspaceKind(kind)) return null
  return IS_KEY_OF_SHAPE[WORKSPACE_KIND_SPECS[kind].keyShape](key) ? { kind, key } : null
}

/** An empty base for `workspaceId`. */
export function emptyBase(workspaceId: string): WorkspaceBaseV1 {
  return { version: 1, workspaceId, resources: {} }
}

/**
 * An empty record without a prototype: a key read from the file (`__proto__`, `constructor`, all
 * valid column names) is an own entry, never the prototype or an inherited member.
 */
function plainRecord<T>(): Record<string, T> {
  return Object.create(null)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecordLike(value) && Object.values(value).every(isNonEmptyString)
}

/**
 * A base object of any version this build reads, as the current version (1) holds it, or `null`
 * for a version it cannot read. v1 is current, so it passes through unchanged.
 */
function upgradeWorkspaceBase(
  json: Record<string, unknown>
): (Record<string, unknown> & { version: 1 }) | null {
  return json.version === 1 ? { ...json, version: 1 } : null
}

/**
 * Validates a base (an object, or its JSON text), through {@link upgradeWorkspaceBase}. Unknown fields are refused unless they are `x-`
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
  const extensionsOf = (value: Record<string, unknown>, known: readonly string[], path: string) =>
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

  if (!isRecordLike(parsed.json)) {
    shape('', 'The base must be an object.')
    return { diagnostics }
  }
  const value = upgradeWorkspaceBase(parsed.json)
  if (!value) {
    return {
      diagnostics: [
        diagnostic('E_BASE_VERSION', 'The base version must be 1.', { path: '/version' }),
      ],
    }
  }
  const workspaceId = isNonEmptyString(value.workspaceId) ? value.workspaceId : null
  if (workspaceId === null) shape('/workspaceId', 'workspaceId must be a string.')
  const resources: Record<ResourceAddress, BaseResource> = {}
  if (!isRecordLike(value.resources)) shape('/resources', 'resources must be an object.')
  else {
    for (const [address, raw] of Object.entries(value.resources)) {
      const path = `/resources/${pointerSegment(address)}`
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
  if (diagnostics.length > 0 || workspaceId === null) return { diagnostics }
  return {
    base: {
      ...extensions,
      version: 1,
      workspaceId,
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
    known: readonly string[],
    path: string
  ) => Record<LockExtensionKey, Json>
): BaseResource | null {
  if (!isRecordLike(raw) || !isNonEmptyString(raw.id)) {
    shape(path, 'A resource entry needs an `id`.')
    return null
  }
  const entry: BaseResource = { ...extensionsOf(raw, RESOURCE_FIELDS, path), id: raw.id }
  if (raw.fingerprint !== undefined) {
    if (isResourceFingerprint(raw.fingerprint)) {
      entry.fingerprint = raw.fingerprint
    } else shape(`${path}/fingerprint`, 'fingerprint must be `rf1:` and 64 hex digits.')
  }
  if (raw.columns !== undefined) {
    if (!isRecordLike(raw.columns)) shape(`${path}/columns`, 'columns must be an object.')
    else {
      const columns = plainRecord<BaseColumn>()
      for (const [key, column] of Object.entries(raw.columns)) {
        const columnPath = `${path}/columns/${pointerSegment(key)}`
        if (!isRecordLike(column) || !isNonEmptyString(column.id)) {
          shape(columnPath, 'A column entry needs an `id`.')
          continue
        }
        columns[key] = { ...extensionsOf(column, COLUMN_FIELDS, columnPath), id: column.id }
        if (column.options !== undefined) {
          if (isStringRecord(column.options)) {
            columns[key].options = Object.assign(plainRecord<string>(), column.options)
          } else shape(`${columnPath}/options`, 'options must map option names to ids.')
        }
      }
      entry.columns = columns
    }
  }
  if (raw.blobs !== undefined) {
    if (!isRecordLike(raw.blobs)) shape(`${path}/blobs`, 'blobs must be an object.')
    else {
      const blobs = plainRecord<BaseBlob>()
      for (const [name, blob] of Object.entries(raw.blobs)) {
        const blobPath = `${path}/blobs/${pointerSegment(name)}`
        const rev = isRecordLike(blob) ? blob.rev : undefined
        if (
          !isRecordLike(blob) ||
          !isNonEmptyString(blob.id) ||
          !(typeof rev === 'number' || isNonEmptyString(rev)) ||
          typeof blob.sha256 !== 'string' ||
          !SHA256_HEX.test(blob.sha256)
        ) {
          shape(blobPath, 'A blob entry needs an `id`, a `rev` and a `sha256`.')
          continue
        }
        blobs[name] = {
          ...extensionsOf(blob, BLOB_FIELDS, blobPath),
          id: blob.id,
          rev: String(rev),
          sha256: blob.sha256,
        }
      }
      entry.blobs = blobs
    }
  }
  if (raw.rows !== undefined) {
    const rows = raw.rows
    if (
      !isRecordLike(rows) ||
      !isResourceFingerprint(rows.fingerprint) ||
      typeof rows.version !== 'number' ||
      !Number.isSafeInteger(rows.version) ||
      rows.version < 0
    ) {
      shape(`${path}/rows`, 'rows needs a `fingerprint` and a whole-number `version`.')
    } else {
      entry.rows = {
        ...extensionsOf(rows, ROWS_FIELDS, `${path}/rows`),
        fingerprint: rows.fingerprint,
        version: rows.version,
      }
    }
  }
  return entry
}
