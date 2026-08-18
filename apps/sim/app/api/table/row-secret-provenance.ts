import { type NextRequest, NextResponse } from 'next/server'
import { AuthType, type AuthTypeValue } from '@/lib/auth/hybrid'
import { isPrivateSecretProvenanceScopeCompatible } from '@/lib/execution/durable-secret-provenance'
import {
  inspectPrivateSecretProvenanceRequest,
  isPrivateSecretProvenanceBundleV1,
} from '@/lib/execution/model-input-provenance'
import {
  negotiatePrivateToolMetadataResponse,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
  serializePrivateToolMetadataResponseEnvelope,
} from '@/lib/execution/private-tool-metadata'
import {
  type TableRowProvenanceEnvelope,
  TableRowProvenanceError,
} from '@/lib/table/application/row-secret-provenance'
import { loadTableRowSecretProvenance } from '@/lib/table/rows/secret-provenance'
import { tableRowSecretProvenanceSelectionKey } from '@/lib/table/secret-provenance-selection'
import type { RowData, TableRowSecretProvenanceWrite } from '@/lib/table/types'

interface TableRowCrossing {
  id: string
  updatedAt: Date | string
  data?: RowData
}

type TableWriteProvenanceResult =
  | {
      success: true
      provenanceByRowKey: Record<string, TableRowSecretProvenanceWrite> | undefined
    }
  | { success: false; response: NextResponse }

interface TableWriteProvenanceTarget {
  selectionKey: string
  rowKey: string
  /** Storage column id, or `null` when the wire translator drops this column. */
  columnId: string | null
}

/**
 * Maps tool-facing column names to the stable storage ids used by the sidecar.
 *
 * The wire translator drops keys that name no column in the table schema, and the
 * write path drops them identically, so such a column is simply never persisted.
 * It still gets a target — callers key one provenance selection per column they
 * sent, and the completeness check pairs the two — but with a `null` column id so
 * no provenance is recorded for a value that was never stored.
 */
export function createTableWriteProvenanceTargets(
  rows: readonly RowData[],
  translate: (data: RowData) => RowData
): TableWriteProvenanceTarget[] {
  return rows.flatMap((row, rowIndex) =>
    Object.entries(row).map(([columnKey, value]) => {
      const translatedKeys = Object.keys(translate({ [columnKey]: value }))
      return {
        selectionKey: tableRowSecretProvenanceSelectionKey(rowIndex, columnKey),
        rowKey: String(rowIndex),
        columnId: translatedKeys.length === 1 ? translatedKeys[0] : null,
      }
    })
  )
}

function invalidProvenanceResponse(): NextResponse {
  return NextResponse.json({ error: 'Invalid table row secret provenance' }, { status: 400 })
}

/**
 * Authenticates the private provenance envelope on a table mutation. Interactive
 * writes receive an exact-empty report, internal legacy callers remain untracked,
 * and only an internal JWT may submit encrypted provenance.
 */
export function resolveTableWriteSecretProvenance(options: {
  request: NextRequest
  payload: unknown
  authType: AuthTypeValue | undefined
  userId: string
  workspaceId: string
  targets: TableWriteProvenanceTarget[]
  rowKeys: string[]
}): TableWriteProvenanceResult {
  const { request } = options
  const inspection = inspectPrivateSecretProvenanceRequest(request.headers, options.payload)
  if (inspection.status === 'unsupported') {
    if (options.authType === AuthType.INTERNAL_JWT) {
      return { success: true, provenanceByRowKey: undefined }
    }
    const provenanceByRowKey: Record<string, TableRowSecretProvenanceWrite> = {}
    for (const rowKey of options.rowKeys) {
      provenanceByRowKey[rowKey] = { complete: true, columns: {} }
    }
    for (const target of options.targets) {
      if (target.columnId === null) continue
      const row = provenanceByRowKey[target.rowKey] ?? { complete: true, columns: {} }
      row.columns[target.columnId] = {
        version: 1,
        complete: true,
        entries: [],
        scope: { userId: options.userId, workspaceId: options.workspaceId },
      }
      provenanceByRowKey[target.rowKey] = row
    }
    return {
      success: true,
      provenanceByRowKey,
    }
  }
  if (
    inspection.status !== 'verified' ||
    options.authType !== AuthType.INTERNAL_JWT ||
    !isPrivateSecretProvenanceBundleV1(inspection.value)
  ) {
    return { success: false, response: invalidProvenanceResponse() }
  }

  const bundle = inspection.value
  const targetBySelectionKey = new Map(
    options.targets.map((target) => [target.selectionKey, target])
  )
  if (
    bundle.complete &&
    (bundle.selections.length !== options.targets.length ||
      bundle.selections.some((selection) => !targetBySelectionKey.has(selection.key)))
  ) {
    return { success: false, response: invalidProvenanceResponse() }
  }
  const rowKeys = [...new Set(options.rowKeys)]
  if (!bundle.complete) {
    return {
      success: true,
      provenanceByRowKey: Object.fromEntries(
        rowKeys.map((rowKey) => [rowKey, { complete: false, columns: {} }])
      ),
    }
  }

  const provenanceByRowKey: Record<string, TableRowSecretProvenanceWrite> = Object.fromEntries(
    rowKeys.map((rowKey) => [rowKey, { complete: true, columns: {} }])
  )
  for (const selection of bundle.selections) {
    const target = targetBySelectionKey.get(selection.key)
    if (
      !target ||
      !isPrivateSecretProvenanceScopeCompatible(selection.provenance.scope, {
        userId: options.userId,
        workspaceId: options.workspaceId,
      })
    ) {
      return { success: false, response: invalidProvenanceResponse() }
    }
    if (target.columnId === null) continue
    if (Object.hasOwn(provenanceByRowKey[target.rowKey].columns, target.columnId)) {
      return { success: false, response: invalidProvenanceResponse() }
    }
    provenanceByRowKey[target.rowKey].columns[target.columnId] = selection.provenance
  }
  return { success: true, provenanceByRowKey }
}

/**
 * Adds row provenance only for an authenticated internal caller that explicitly
 * requested the supported private capability. All ordinary API/UI responses keep
 * their existing wire shape.
 */
export async function createTableRowsResponse(options: {
  request: NextRequest
  authType: AuthTypeValue | undefined
  userId: string
  workspaceId: string
  body: Record<string, unknown>
  rows: TableRowCrossing[]
}): Promise<NextResponse> {
  const { request } = options
  const negotiation = negotiatePrivateToolMetadataResponse(
    request.headers,
    RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    options.authType === AuthType.INTERNAL_JWT
  )
  if (negotiation.status === 'not-requested') return NextResponse.json(options.body)
  if (negotiation.status === 'rejected') return invalidProvenanceResponse()

  const provenance = await loadTableRowSecretProvenance(
    options.rows.map((row) => ({
      id: row.id,
      updatedAt: row.updatedAt,
      ...(row.data ? { selectedValues: row.data } : {}),
    })),
    {
      userId: options.userId,
      workspaceId: options.workspaceId,
    }
  )
  const envelope = serializePrivateToolMetadataResponseEnvelope(
    options.body,
    RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    provenance
  )
  return NextResponse.json(envelope.body, { headers: envelope.headers })
}

/**
 * Reads the private provenance envelope off the request. Transport only — the
 * selections are interpreted against the canonical schema inside the use case,
 * by {@link resolveRowWriteProvenance}.
 */
export function readTableRowProvenanceEnvelope(
  request: NextRequest,
  payload: unknown
): TableRowProvenanceEnvelope {
  const inspection = inspectPrivateSecretProvenanceRequest(request.headers, payload)
  if (inspection.status === 'unsupported') return { kind: 'none' }
  if (inspection.status !== 'verified') throw new TableRowProvenanceError()
  return { kind: 'bundle', value: inspection.value }
}

/**
 * Whether this caller asked for persisted row provenance on the response.
 *
 * Only an authenticated internal caller that explicitly requested the capability
 * gets it; every ordinary UI and API response keeps its existing wire shape. The
 * answer feeds the use case's `includePersistedSecretProvenance`, so the load
 * itself happens inside the authorized operation rather than in the adapter.
 */
export function negotiateTableRowsProvenance(
  request: NextRequest,
  isInternalCaller: boolean
): boolean {
  const negotiation = negotiatePrivateToolMetadataResponse(
    request.headers,
    RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    isInternalCaller
  )
  if (negotiation.status === 'rejected') throw new TableRowProvenanceError()
  return negotiation.status !== 'not-requested'
}

/**
 * The response half of the envelope, shaped for a declarative route's
 * `finalizeResponse`: one sibling body field and one capability header, added
 * only when the use case actually loaded provenance.
 */
export function finalizeTableRowsProvenance(provenance: unknown): {
  bodyFields?: Record<string, unknown>
  headers?: HeadersInit
} {
  if (provenance === undefined) return {}
  const envelope = serializePrivateToolMetadataResponseEnvelope(
    {},
    RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    provenance
  )
  return { bodyFields: envelope.body, headers: envelope.headers }
}
