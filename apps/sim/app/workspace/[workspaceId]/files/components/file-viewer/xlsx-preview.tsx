'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { Button, Skeleton } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import {
  useUpdateWorkspaceFileContent,
  useWorkspaceFileBinary,
} from '@/hooks/queries/workspace-files'
import type { DataTableHandle } from './data-table'
import { DataTable } from './data-table'
import { PreviewError, resolvePreviewError } from './preview-shared'

const logger = createLogger('XlsxPreview')

const XLSX_MAX_ROWS = 1_000

interface XlsxSheet {
  name: string
  headers: string[]
  rows: string[][]
  truncated: boolean
}

const XLSX_SKELETON = (
  <div className='flex flex-1 flex-col overflow-hidden'>
    <div className='flex shrink-0 items-center gap-2 border-[var(--border)] border-b bg-[var(--surface-1)] px-3 py-2'>
      <Skeleton className='h-[22px] w-[60px] rounded' />
      <Skeleton className='h-[22px] w-[48px] rounded' />
    </div>
    <div className='flex-1 overflow-auto p-6'>
      <div className='overflow-hidden rounded-md border border-[var(--border)]'>
        <div className='flex gap-4 bg-[var(--surface-2)] px-3 py-2'>
          {[1, 1, 1, 1].map((_, i) => (
            <Skeleton key={i} className='h-[12px] flex-1' />
          ))}
        </div>
        {[...Array(7)].map((_, i) => (
          <div key={i} className='flex gap-4 border-[var(--border)] border-t px-3 py-2'>
            {[1, 1, 1, 1].map((_, j) => (
              <Skeleton key={j} className='h-[12px] flex-1' />
            ))}
          </div>
        ))}
      </div>
    </div>
  </div>
)

export const XlsxPreview = memo(function XlsxPreview({
  file,
  workspaceId,
  canEdit,
  onSaveStatusChange,
  saveRef,
}: {
  file: WorkspaceFileRecord
  workspaceId: string
  canEdit: boolean
  onSaveStatusChange?: (status: 'idle' | 'saving' | 'saved' | 'error') => void
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>
}) {
  const {
    data: fileData,
    isLoading,
    error: fetchError,
  } = useWorkspaceFileBinary(workspaceId, file.id, file.key)

  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [activeSheet, setActiveSheet] = useState(0)
  const [currentSheet, setCurrentSheet] = useState<XlsxSheet | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const isSavingRef = useRef(false)
  const workbookRef = useRef<import('xlsx').WorkBook | null>(null)
  const xlsxModuleRef = useRef<typeof import('xlsx') | null>(null)
  const dataTableRef = useRef<DataTableHandle>(null)
  const updateContent = useUpdateWorkspaceFileContent()
  const updateContentRef = useRef(updateContent)
  updateContentRef.current = updateContent
  const onSaveStatusChangeRef = useRef(onSaveStatusChange)
  onSaveStatusChangeRef.current = onSaveStatusChange

  useEffect(() => {
    if (!fileData) return
    const data = fileData

    let cancelled = false

    async function parse() {
      try {
        setRenderError(null)
        setIsDirty(false)
        const XLSX = await import('xlsx')
        xlsxModuleRef.current = XLSX
        const workbook = XLSX.read(new Uint8Array(data), { type: 'array' })
        if (!cancelled) {
          workbookRef.current = workbook
          setSheetNames(workbook.SheetNames)
          setActiveSheet(0)
        }
      } catch (err) {
        if (!cancelled) {
          const msg = toError(err).message || 'Failed to parse spreadsheet'
          logger.error('XLSX parse failed', { error: msg })
          setRenderError(msg)
        }
      }
    }

    parse()
    return () => {
      cancelled = true
    }
  }, [fileData])

  useEffect(() => {
    if (sheetNames.length === 0 || !workbookRef.current) return

    let cancelled = false

    async function parseSheet() {
      try {
        const XLSX = await import('xlsx')
        const workbook = workbookRef.current!
        const name = sheetNames[activeSheet]
        const sheet = workbook.Sheets[name]
        const allRows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })
        const headers = (allRows[0] ?? []) as string[]
        const dataRows = allRows.slice(1) as string[][]
        const truncated = dataRows.length > XLSX_MAX_ROWS
        if (!cancelled) {
          setCurrentSheet({
            name,
            headers,
            rows: truncated ? dataRows.slice(0, XLSX_MAX_ROWS) : dataRows,
            truncated,
          })
        }
      } catch (err) {
        if (!cancelled) {
          const msg = toError(err).message || 'Failed to parse sheet'
          logger.error('XLSX sheet parse failed', { error: msg })
          setRenderError(msg)
        }
      }
    }

    parseSheet()
    return () => {
      cancelled = true
    }
  }, [sheetNames, activeSheet])

  const handleCellChange = useCallback(
    (row: number, col: number, value: string) => {
      const wb = workbookRef.current
      const XLSX = xlsxModuleRef.current
      if (wb && XLSX) {
        const sheetName = sheetNames[activeSheet]
        const ws = wb.Sheets[sheetName]
        if (ws) {
          const cellAddr = XLSX.utils.encode_cell({ r: row + 1, c: col })
          const numValue = Number(value)
          ws[cellAddr] =
            value !== '' && !Number.isNaN(numValue) ? { t: 'n', v: numValue } : { t: 's', v: value }
        }
      }
      setCurrentSheet((prev) => {
        if (!prev) return prev
        const newRows = prev.rows.map((r, ri) =>
          ri === row ? r.map((v, ci) => (ci === col ? value : v)) : r
        )
        return { ...prev, rows: newRows }
      })
      setIsDirty(true)
    },
    [activeSheet, sheetNames]
  )

  const handleHeaderChange = useCallback(
    (col: number, value: string) => {
      const wb = workbookRef.current
      const XLSX = xlsxModuleRef.current
      if (wb && XLSX) {
        const sheetName = sheetNames[activeSheet]
        const ws = wb.Sheets[sheetName]
        if (ws) {
          const cellAddr = XLSX.utils.encode_cell({ r: 0, c: col })
          ws[cellAddr] = { t: 's', v: value }
        }
      }
      setCurrentSheet((prev) => {
        if (!prev) return prev
        const newHeaders = prev.headers.map((h, i) => (i === col ? value : h))
        return { ...prev, headers: newHeaders }
      })
      setIsDirty(true)
    },
    [activeSheet, sheetNames]
  )

  const handleSave = useCallback(async () => {
    dataTableRef.current?.commitEdit()
    const wb = workbookRef.current
    if (!wb || isSavingRef.current) return

    try {
      isSavingRef.current = true
      setIsSaving(true)
      onSaveStatusChangeRef.current?.('saving')

      const XLSX = await import('xlsx')
      const binary: number[] = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
      const bytes = new Uint8Array(binary)

      const chunkSize = 8192
      const parts: string[] = []
      for (let i = 0; i < bytes.length; i += chunkSize) {
        parts.push(String.fromCharCode(...bytes.slice(i, i + chunkSize)))
      }
      const base64 = btoa(parts.join(''))

      await updateContentRef.current.mutateAsync({
        workspaceId,
        fileId: file.id,
        content: base64,
        encoding: 'base64',
      })

      setIsDirty(false)
      onSaveStatusChangeRef.current?.('saved')
    } catch (err) {
      logger.error('XLSX save failed', { error: toError(err).message })
      onSaveStatusChangeRef.current?.('error')
    } finally {
      isSavingRef.current = false
      setIsSaving(false)
    }
  }, [workspaceId, file.id])

  useEffect(() => {
    if (!saveRef) return
    saveRef.current = handleSave
    return () => {
      if (saveRef.current === handleSave) saveRef.current = null
    }
  }, [handleSave, saveRef])

  useEffect(() => {
    if (!canEdit) return
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canEdit, handleSave])

  const editConfig = useMemo(
    () =>
      canEdit ? { onCellChange: handleCellChange, onHeaderChange: handleHeaderChange } : undefined,
    [canEdit, handleCellChange, handleHeaderChange]
  )

  const error = resolvePreviewError(fetchError, renderError)
  if (error) return <PreviewError label='spreadsheet' error={error} />
  if (isLoading || currentSheet === null) return XLSX_SKELETON

  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      <div className='flex shrink-0 items-center justify-between border-[var(--border)] border-b bg-[var(--surface-1)]'>
        <div className='flex gap-0'>
          {sheetNames.map((name, i) => (
            <Button
              key={name}
              variant='ghost'
              size='sm'
              onClick={() => setActiveSheet(i)}
              className={cn(
                'rounded-none px-3 py-1.5 text-[12px]',
                i === activeSheet
                  ? 'border-[var(--brand-secondary)] border-b-2 font-medium text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              )}
            >
              {name}
            </Button>
          ))}
        </div>
        {canEdit && isDirty && (
          <Button
            variant='primary'
            size='sm'
            onClick={handleSave}
            disabled={isSaving}
            className='mr-3'
          >
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
        )}
      </div>
      <div className='flex-1 overflow-auto p-6'>
        <DataTable
          ref={dataTableRef}
          headers={currentSheet.headers}
          rows={currentSheet.rows}
          editConfig={editConfig}
        />
        {currentSheet.truncated && (
          <p className='mt-3 text-center text-[12px] text-[var(--text-muted)]'>
            Showing first {XLSX_MAX_ROWS.toLocaleString()} rows. Download the file to view all data.
          </p>
        )}
      </div>
    </div>
  )
})
