import type { TableRow } from '@/lib/table'

export interface CellViewerData {
  columnName: string
  value: unknown
  type: 'json' | 'text' | 'date' | 'boolean' | 'number'
}

export interface ContextMenuState {
  isOpen: boolean
  position: { x: number; y: number }
  row: TableRow | null
}
