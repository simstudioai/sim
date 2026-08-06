import type { PrivateSecretProvenanceSelection } from '@/lib/execution/model-input-provenance'
import type { RowData } from '@/lib/table/types'

/** Stable keyed selections shared by table tool descriptors and authenticated routes. */
export function selectTableRowSecretProvenance(
  rows: readonly RowData[]
): PrivateSecretProvenanceSelection[] {
  return rows.flatMap((row, rowIndex) =>
    Object.entries(row).map(([columnKey, value]) => ({
      key: tableRowSecretProvenanceSelectionKey(rowIndex, columnKey),
      value,
    }))
  )
}

export function tableRowSecretProvenanceSelectionKey(rowIndex: number, columnKey: string): string {
  return JSON.stringify([rowIndex, columnKey])
}
