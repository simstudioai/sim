import type { PrivateSecretProvenanceSelection } from '@/lib/execution/model-input-provenance'
import type { RowData } from '@/lib/table/types'

/** Stable keyed selections shared by table tool descriptors and authenticated routes. */
export function selectTableRowSecretProvenance(
  rows: readonly Partial<RowData>[],
  inputRoot: 'data' | 'rows' = 'data'
): PrivateSecretProvenanceSelection[] {
  return rows.flatMap((row, rowIndex) =>
    Object.entries(row)
      .filter(([, value]) => value !== undefined)
      .map(([columnKey, value]) => ({
        key: tableRowSecretProvenanceSelectionKey(rowIndex, columnKey),
        inputPaths: [
          inputRoot === 'rows' ? ['rows', String(rowIndex), columnKey] : ['data', columnKey],
        ],
      }))
  )
}

export function tableRowSecretProvenanceSelectionKey(rowIndex: number, columnKey: string): string {
  return JSON.stringify([rowIndex, columnKey])
}
