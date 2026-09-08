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
import { EdgeFade } from '@/app/(landing)/components/shared/edge-fade'
import { usePreviewDialogFocus } from '@/app/(landing)/hooks/use-preview-dialog-focus'
import { LeadRecordDetail } from '@/app/(landing)/tables/components/tables-records-preview/components/lead-record-detail'
import { LeadRecordList } from '@/app/(landing)/tables/components/tables-records-preview/components/lead-record-list'
import {
  type LeadRecord,
  ROWS,
} from '@/app/(landing)/tables/components/tables-records-preview/data'

/** The native ruled Tables grid and Edit Row dialog, backed only by local demo records. */
export function TablesRecordsPreview() {
  const filterButtonRef = useRef<HTMLButtonElement>(null)
  const [rows, setRows] = useState<readonly LeadRecord[]>(ROWS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [status, setStatus] = useState<LeadRecord['status'] | null>(null)
  const [showContact, setShowContact] = useState(true)
  const selected = rows.find((row) => row.id === selectedId)
  const visibleRows = rows.filter((row) => !status || row.status === status)
  const dialogOpenerRef = usePreviewDialogFocus(Boolean(selected), filterButtonRef)

  return (
    <div className='absolute inset-0 isolate overflow-hidden bg-[var(--bg)]'>
      <div className='-translate-x-1/2 absolute top-20 left-1/2 h-[440px] w-[780px] max-w-[calc(100%_-_48px)] max-sm:top-8 max-sm:h-[410px]'>
        <div className='h-full overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)] text-[var(--text-body)] text-small shadow-xs'>
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
        </div>
        <EdgeFade ground='canvas' edges={['bottom']} depth='stage' />
      </div>
      <EdgeFade ground='canvas' edges={['top', 'left', 'right']} depth='preview' />
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
