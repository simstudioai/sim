'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Checkbox } from '@/components/emcn'
import {
  ChevronDown,
  Columns3,
  Rows3,
  Table,
  TypeBoolean,
  TypeNumber,
  TypeText,
} from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import type {
  PreviewColumn,
  PreviewRow,
} from '@/app/(landing)/components/landing-preview/components/landing-preview-resource/landing-preview-resource'
import {
  LandingPreviewResource,
  ownerCell,
} from '@/app/(landing)/components/landing-preview/components/landing-preview-resource/landing-preview-resource'

const CELL = 'border-[var(--border)] border-r border-b px-2 py-[7px] align-middle select-none'
const CELL_CHECKBOX =
  'border-[var(--border)] border-r border-b px-1 py-[7px] align-middle select-none'
const CELL_HEADER =
  'border-[var(--border)] border-r border-b bg-[var(--bg)] p-0 text-left align-middle'
const CELL_HEADER_CHECKBOX =
  'border-[var(--border)] border-r border-b bg-[var(--bg)] px-1 py-[7px] text-center align-middle'
const CELL_CONTENT =
  'relative min-h-[20px] min-w-0 overflow-clip text-ellipsis whitespace-nowrap text-small'
const SELECTION_OVERLAY =
  'pointer-events-none absolute -top-px -right-px -bottom-px -left-px z-[5] border-[2px] border-[var(--selection)]'

const LIST_COLUMNS: PreviewColumn[] = [
  { id: 'name', header: 'Name' },
  { id: 'columns', header: 'Columns' },
  { id: 'rows', header: 'Rows' },
  { id: 'created', header: 'Created' },
  { id: 'owner', header: 'Owner' },
]

const TABLE_METAS: Record<string, string> = {
  '1': 'Customer Leads',
  '2': 'Product Catalog',
  '3': 'Campaign Analytics',
  '4': 'User Profiles',
  '5': 'Invoice Records',
}

const TABLE_ICON = <Table className='h-[14px] w-[14px]' />
const COLUMNS_ICON = <Columns3 className='h-[14px] w-[14px]' />
const ROWS_ICON = <Rows3 className='h-[14px] w-[14px]' />

const LIST_ROWS: PreviewRow[] = [
  {
    id: '1',
    cells: {
      name: { icon: TABLE_ICON, label: 'Customer Leads' },
      columns: { icon: COLUMNS_ICON, label: '8' },
      rows: { icon: ROWS_ICON, label: '2,847' },
      created: { label: '2 days ago' },
      owner: ownerCell('S', 'Sarah K.'),
    },
  },
  {
    id: '2',
    cells: {
      name: { icon: TABLE_ICON, label: 'Product Catalog' },
      columns: { icon: COLUMNS_ICON, label: '12' },
      rows: { icon: ROWS_ICON, label: '1,203' },
      created: { label: '5 days ago' },
      owner: ownerCell('A', 'Alex M.'),
    },
  },
  {
    id: '3',
    cells: {
      name: { icon: TABLE_ICON, label: 'Campaign Analytics' },
      columns: { icon: COLUMNS_ICON, label: '6' },
      rows: { icon: ROWS_ICON, label: '534' },
      created: { label: '1 week ago' },
      owner: ownerCell('W', 'Emaan K.'),
    },
  },
  {
    id: '4',
    cells: {
      name: { icon: TABLE_ICON, label: 'User Profiles' },
      columns: { icon: COLUMNS_ICON, label: '15' },
      rows: { icon: ROWS_ICON, label: '18,492' },
      created: { label: '2 weeks ago' },
      owner: ownerCell('J', 'Jordan P.'),
    },
  },
  {
    id: '5',
    cells: {
      name: { icon: TABLE_ICON, label: 'Invoice Records' },
      columns: { icon: COLUMNS_ICON, label: '9' },
      rows: { icon: ROWS_ICON, label: '742' },
      created: { label: 'March 15th, 2026' },
      owner: ownerCell('S', 'Sarah K.'),
    },
  },
]

interface SpreadsheetColumn {
  id: string
  label: string
  type: 'text' | 'number' | 'boolean'
  width: number
}

interface SpreadsheetRow {
  id: string
  cells: Record<string, string>
}

const COLUMN_TYPE_ICONS = {
  text: TypeText,
  number: TypeNumber,
  boolean: TypeBoolean,
} as const

const SPREADSHEET_DATA: Record<string, { columns: SpreadsheetColumn[]; rows: SpreadsheetRow[] }> = {
  '1': {
    columns: [
      { id: 'name', label: 'Name', type: 'text', width: 160 },
      { id: 'email', label: 'Email', type: 'text', width: 200 },
      { id: 'company', label: 'Company', type: 'text', width: 160 },
      { id: 'score', label: 'Score', type: 'number', width: 100 },
      { id: 'qualified', label: 'Qualified', type: 'boolean', width: 120 },
    ],
    rows: [
      {
        id: '1',
        cells: {
          name: 'Alice Johnson',
          email: 'alice@acme.com',
          company: 'Acme Corp',
          score: '87',
          qualified: 'true',
        },
      },
      {
        id: '2',
        cells: {
          name: 'Bob Williams',
          email: 'bob@techco.io',
          company: 'TechCo',
          score: '62',
          qualified: 'false',
        },
      },
      {
        id: '3',
        cells: {
          name: 'Carol Davis',
          email: 'carol@startup.co',
          company: 'StartupCo',
          score: '94',
          qualified: 'true',
        },
      },
      {
        id: '4',
        cells: {
          name: 'Dan Miller',
          email: 'dan@bigcorp.com',
          company: 'BigCorp',
          score: '71',
          qualified: 'true',
        },
      },
      {
        id: '5',
        cells: {
          name: 'Eva Chen',
          email: 'eva@design.io',
          company: 'Design IO',
          score: '45',
          qualified: 'false',
        },
      },
      {
        id: '6',
        cells: {
          name: 'Frank Lee',
          email: 'frank@ventures.co',
          company: 'Ventures',
          score: '88',
          qualified: 'true',
        },
      },
    ],
  },
  '2': {
    columns: [
      { id: 'sku', label: 'SKU', type: 'text', width: 120 },
      { id: 'name', label: 'Product Name', type: 'text', width: 200 },
      { id: 'price', label: 'Price', type: 'number', width: 100 },
      { id: 'stock', label: 'In Stock', type: 'number', width: 120 },
      { id: 'active', label: 'Active', type: 'boolean', width: 90 },
    ],
    rows: [
      {
        id: '1',
        cells: {
          sku: 'PRD-001',
          name: 'Wireless Headphones',
          price: '79.99',
          stock: '234',
          active: 'true',
        },
      },
      {
        id: '2',
        cells: { sku: 'PRD-002', name: 'USB-C Hub', price: '49.99', stock: '89', active: 'true' },
      },
      {
        id: '3',
        cells: {
          sku: 'PRD-003',
          name: 'Laptop Stand',
          price: '39.99',
          stock: '0',
          active: 'false',
        },
      },
      {
        id: '4',
        cells: {
          sku: 'PRD-004',
          name: 'Mechanical Keyboard',
          price: '129.99',
          stock: '52',
          active: 'true',
        },
      },
      {
        id: '5',
        cells: { sku: 'PRD-005', name: 'Webcam HD', price: '89.99', stock: '17', active: 'true' },
      },
      {
        id: '6',
        cells: {
          sku: 'PRD-006',
          name: 'Mouse Pad XL',
          price: '24.99',
          stock: '0',
          active: 'false',
        },
      },
    ],
  },
  '3': {
    columns: [
      { id: 'campaign', label: 'Campaign', type: 'text', width: 180 },
      { id: 'clicks', label: 'Clicks', type: 'number', width: 100 },
      { id: 'conversions', label: 'Conversions', type: 'number', width: 140 },
      { id: 'spend', label: 'Spend ($)', type: 'number', width: 130 },
      { id: 'active', label: 'Active', type: 'boolean', width: 90 },
    ],
    rows: [
      {
        id: '1',
        cells: {
          campaign: 'Spring Sale 2026',
          clicks: '12,847',
          conversions: '384',
          spend: '2,400',
          active: 'true',
        },
      },
      {
        id: '2',
        cells: {
          campaign: 'Email Reactivation',
          clicks: '3,201',
          conversions: '97',
          spend: '450',
          active: 'false',
        },
      },
      {
        id: '3',
        cells: {
          campaign: 'Referral Program',
          clicks: '8,923',
          conversions: '210',
          spend: '1,100',
          active: 'true',
        },
      },
      {
        id: '4',
        cells: {
          campaign: 'Product Launch',
          clicks: '24,503',
          conversions: '891',
          spend: '5,800',
          active: 'true',
        },
      },
      {
        id: '5',
        cells: {
          campaign: 'Retargeting Q1',
          clicks: '6,712',
          conversions: '143',
          spend: '980',
          active: 'false',
        },
      },
    ],
  },
  '4': {
    columns: [
      { id: 'username', label: 'Username', type: 'text', width: 140 },
      { id: 'email', label: 'Email', type: 'text', width: 200 },
      { id: 'plan', label: 'Plan', type: 'text', width: 120 },
      { id: 'seats', label: 'Seats', type: 'number', width: 100 },
      { id: 'active', label: 'Active', type: 'boolean', width: 100 },
    ],
    rows: [
      {
        id: '1',
        cells: {
          username: 'alice_j',
          email: 'alice@acme.com',
          plan: 'Pro',
          seats: '5',
          active: 'true',
        },
      },
      {
        id: '2',
        cells: {
          username: 'bobw',
          email: 'bob@techco.io',
          plan: 'Starter',
          seats: '1',
          active: 'true',
        },
      },
      {
        id: '3',
        cells: {
          username: 'carol_d',
          email: 'carol@startup.co',
          plan: 'Enterprise',
          seats: '25',
          active: 'true',
        },
      },
      {
        id: '4',
        cells: {
          username: 'dan.m',
          email: 'dan@bigcorp.com',
          plan: 'Pro',
          seats: '10',
          active: 'false',
        },
      },
      {
        id: '5',
        cells: {
          username: 'eva_chen',
          email: 'eva@design.io',
          plan: 'Starter',
          seats: '1',
          active: 'true',
        },
      },
      {
        id: '6',
        cells: {
          username: 'frank_lee',
          email: 'frank@ventures.co',
          plan: 'Enterprise',
          seats: '50',
          active: 'true',
        },
      },
    ],
  },
  '5': {
    columns: [
      { id: 'invoice', label: 'Invoice #', type: 'text', width: 140 },
      { id: 'client', label: 'Client', type: 'text', width: 160 },
      { id: 'amount', label: 'Amount ($)', type: 'number', width: 130 },
      { id: 'paid', label: 'Paid', type: 'boolean', width: 80 },
    ],
    rows: [
      {
        id: '1',
        cells: { invoice: 'INV-2026-001', client: 'Acme Corp', amount: '4,800.00', paid: 'true' },
      },
      {
        id: '2',
        cells: { invoice: 'INV-2026-002', client: 'TechCo', amount: '1,200.00', paid: 'true' },
      },
      {
        id: '3',
        cells: { invoice: 'INV-2026-003', client: 'StartupCo', amount: '750.00', paid: 'false' },
      },
      {
        id: '4',
        cells: { invoice: 'INV-2026-004', client: 'BigCorp', amount: '12,500.00', paid: 'true' },
      },
      {
        id: '5',
        cells: { invoice: 'INV-2026-005', client: 'Design IO', amount: '3,300.00', paid: 'false' },
      },
    ],
  },
}

interface SpreadsheetViewProps {
  tableId: string
  tableName: string
  onBack: () => void
}

function SpreadsheetView({ tableId, tableName, onBack }: SpreadsheetViewProps) {
  const data = SPREADSHEET_DATA[tableId] ?? SPREADSHEET_DATA['1']
  const [selectedCell, setSelectedCell] = useState<{ row: string; col: string } | null>(null)

  return (
    <div className='flex h-full flex-1 flex-col overflow-hidden bg-[var(--bg)]'>
      {/* Breadcrumb header — matches real ResourceHeader breadcrumb layout */}
      <div className='border-[var(--border)] border-b px-4 py-[8.5px]'>
        <div className='flex items-center gap-3'>
          <button
            type='button'
            onClick={onBack}
            className='inline-flex items-center px-2 py-1 font-medium text-[var(--text-secondary)] text-sm transition-colors hover-hover:text-[var(--text-body)]'
          >
            <Table className='mr-3 h-[14px] w-[14px] text-[var(--text-icon)]' />
            Tables
          </button>
          <span className='select-none text-[var(--text-icon)] text-sm'>/</span>
          <span className='inline-flex items-center px-2 py-1 font-medium text-[var(--text-body)] text-sm'>
            {tableName}
            <ChevronDown className='ml-2 h-[7px] w-[9px] shrink-0 text-[var(--text-muted)]' />
          </span>
        </div>
      </div>

      {/* Spreadsheet — matches exact real table editor structure */}
      <div className='min-h-0 flex-1 overflow-auto overscroll-none'>
        <table className='table-fixed border-separate border-spacing-0 text-small'>
          <colgroup>
            <col style={{ width: 40 }} />
            {data.columns.map((col) => (
              <col key={col.id} style={{ width: col.width }} />
            ))}
          </colgroup>
          <thead className='sticky top-0 z-10'>
            <tr>
              <th className={CELL_HEADER_CHECKBOX} />
              {data.columns.map((col) => {
                const Icon = COLUMN_TYPE_ICONS[col.type] ?? TypeText
                return (
                  <th key={col.id} className={CELL_HEADER}>
                    <div className='flex h-full w-full min-w-0 items-center px-2 py-[7px]'>
                      <Icon className='h-3 w-3 shrink-0 text-[var(--text-icon)]' />
                      <span className='ml-1.5 min-w-0 overflow-clip text-ellipsis whitespace-nowrap font-medium text-[var(--text-primary)] text-small'>
                        {col.label}
                      </span>
                      <ChevronDown className='ml-auto h-[7px] w-[9px] shrink-0 text-[var(--text-muted)]' />
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, rowIdx) => (
              <tr key={row.id}>
                <td className={cn(CELL_CHECKBOX, 'text-center')}>
                  <span className='text-[var(--text-tertiary)] text-xs tabular-nums'>
                    {rowIdx + 1}
                  </span>
                </td>
                {data.columns.map((col) => {
                  const isSelected = selectedCell?.row === row.id && selectedCell?.col === col.id
                  const cellValue = row.cells[col.id] ?? ''
                  return (
                    <td
                      key={col.id}
                      onClick={() => setSelectedCell({ row: row.id, col: col.id })}
                      className={cn(
                        CELL,
                        'relative cursor-default text-[var(--text-body)]',
                        isSelected && 'bg-[rgba(37,99,235,0.06)]'
                      )}
                    >
                      {isSelected && <div className={SELECTION_OVERLAY} />}
                      <div className={CELL_CONTENT}>
                        {col.type === 'boolean' ? (
                          <div className='flex min-h-[20px] items-center justify-center'>
                            <Checkbox
                              size='sm'
                              checked={cellValue === 'true'}
                              className='pointer-events-none'
                            />
                          </div>
                        ) : (
                          cellValue
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface LandingPreviewTablesProps {
  autoOpenTableId?: string | null
}

const tableViewTransition = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
  transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] as const },
} as const

export function LandingPreviewTables({ autoOpenTableId }: LandingPreviewTablesProps = {}) {
  const [openTableId, setOpenTableId] = useState<string | null>(null)

  useEffect(() => {
    if (!autoOpenTableId) return
    const timer = setTimeout(() => {
      setOpenTableId(autoOpenTableId)
    }, 800)
    return () => clearTimeout(timer)
  }, [autoOpenTableId])

  return (
    <AnimatePresence mode='wait'>
      {openTableId !== null ? (
        <motion.div
          key={`spreadsheet-${openTableId}`}
          className='flex h-full flex-1 flex-col'
          {...tableViewTransition}
        >
          <SpreadsheetView
            tableId={openTableId}
            tableName={TABLE_METAS[openTableId] ?? 'Table'}
            onBack={() => setOpenTableId(null)}
          />
        </motion.div>
      ) : (
        <motion.div
          key='table-list'
          className='flex h-full flex-1 flex-col'
          {...tableViewTransition}
        >
          <LandingPreviewResource
            icon={Table}
            title='Tables'
            createLabel='New table'
            searchPlaceholder='Search tables...'
            columns={LIST_COLUMNS}
            rows={LIST_ROWS}
            onRowClick={(id) => setOpenTableId(id)}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
