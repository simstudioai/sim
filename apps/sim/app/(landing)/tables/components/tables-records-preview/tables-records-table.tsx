'use client'

import { useRef, useState } from 'react'
import {
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { Check, ChevronDown, Columns3, ListFilter, Table } from '@sim/emcn/icons'
import {
  MenuPreviewHeader,
  MenuPreviewToolbar,
} from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-header/menu-preview-header'
import { usePreviewDialogFocus } from '@/app/(landing)/hooks/use-preview-dialog-focus'
import { LeadRecordDetail } from '@/app/(landing)/tables/components/tables-records-preview/components/lead-record-detail'
import { LeadRecordList } from '@/app/(landing)/tables/components/tables-records-preview/components/lead-record-list'
import {
  type LeadRecord,
  ROWS,
} from '@/app/(landing)/tables/components/tables-records-preview/data'

interface TablesRecordsTableProps {
  initialRows?: readonly LeadRecord[]
}

/** The native ruled Tables grid and Edit Row dialog, backed only by local demo records. */
export function TablesRecordsTable({ initialRows = ROWS }: TablesRecordsTableProps) {
  const filterButtonRef = useRef<HTMLButtonElement>(null)
  const [rows, setRows] = useState<readonly LeadRecord[]>(initialRows)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [status, setStatus] = useState<LeadRecord['status'] | null>(null)
  const [showContact, setShowContact] = useState(true)
  const selected = rows.find((row) => row.id === selectedId)
  const visibleRows = rows.filter((row) => !status || row.status === status)
  const dialogOpenerRef = usePreviewDialogFocus(Boolean(selected), filterButtonRef)

  return (
    <div className='relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg)] text-[var(--text-body)] text-small'>
      <MenuPreviewHeader
        icon={Table}
        title='Qualified leads'
        actions={`${visibleRows.length} rows`}
      />
      <MenuPreviewToolbar>
        <span aria-hidden='true' inert>
          <Chip rightIcon={ChevronDown}>All records</Chip>
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Chip ref={filterButtonRef} leftIcon={ListFilter} active={status !== null}>
              Filter
            </Chip>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start'>
            <DropdownMenuItem onSelect={() => setStatus(null)} active={status === null}>
              All statuses
            </DropdownMenuItem>
            {(['Qualified', 'Review'] as const).map((value) => (
              <DropdownMenuItem
                key={value}
                onSelect={() => setStatus(value)}
                active={status === value}
              >
                {value}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className='ml-auto'>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Chip leftIcon={Columns3}>Columns</Chip>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onSelect={() => setShowContact((value) => !value)}>
                {showContact && <Check />}Contact
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </MenuPreviewToolbar>
      <LeadRecordList
        rows={visibleRows}
        selectedId={selectedId}
        onSelect={(id, opener) => {
          dialogOpenerRef.current = opener
          setSelectedId(id)
        }}
        showContact={showContact}
      />
      {selected && (
        <LeadRecordDetail
          key={selected.id}
          record={selected}
          onClose={() => setSelectedId(null)}
          onSave={(record) => {
            setRows((current) => current.map((row) => (row.id === record.id ? record : row)))
            setSelectedId(null)
          }}
        />
      )}
    </div>
  )
}
