'use client'

import { useEffect, useRef, useState } from 'react'
import { ContentTabs } from '@sim/emcn/tabs/content-tabs'
import { toError } from '@sim/utils/errors'
import type { WorkBook } from 'xlsx'
import { DataTable } from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/data-table'
import {
  PreviewError,
  resolvePreviewError,
} from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/preview-shared'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/table-frame.module.css'
import { useHorizontalWheelScroll } from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/use-horizontal-wheel-scroll'
import { useDocPreviewBinary, type WorkspaceFileRecord } from '@/platform/lib/data/files'
import { assertOoxmlPreviewWithinLimits } from '@/platform/lib/data/files/office'
import {
  readXlsxPreviewData,
  readXlsxWorkbook,
  XLSX_MAX_COLUMNS,
  XLSX_MAX_ROWS,
} from '@/platform/lib/data/files/xlsx'

interface XlsxSheet {
  name: string
  headers: string[]
  rows: string[][]
  rowTruncated: boolean
  columnTruncated: boolean
}

interface XlsxPreviewProps {
  file: WorkspaceFileRecord
  workspaceId: string
}

function truncationNote(sheet: XlsxSheet): string | null {
  const rows = `${XLSX_MAX_ROWS.toLocaleString()} rows`
  const columns = `${XLSX_MAX_COLUMNS.toLocaleString()} columns`
  const shown =
    sheet.rowTruncated && sheet.columnTruncated
      ? `${rows} and ${columns}`
      : sheet.rowTruncated
        ? rows
        : sheet.columnTruncated
          ? columns
          : null
  return shown && `Showing the first ${shown}. Download the file to view all data.`
}

/** A workbook with a tab per sheet, each its first 1,000 rows and 200 columns, read on demand. */
export function XlsxPreview({ file, workspaceId }: XlsxPreviewProps) {
  const scrollRef = useHorizontalWheelScroll()
  const preview = useDocPreviewBinary(workspaceId, file)
  const fileData = preview.data
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [activeSheet, setActiveSheet] = useState('')
  const [sheet, setSheet] = useState<XlsxSheet | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const workbookRef = useRef<WorkBook | null>(null)

  useEffect(() => {
    if (!fileData) return
    let cancelled = false
    const parse = async () => {
      try {
        setRenderError(null)
        await assertOoxmlPreviewWithinLimits(fileData)
        const XLSX = await import('xlsx')
        const workbook = readXlsxWorkbook(XLSX, fileData)
        if (cancelled) return
        workbookRef.current = workbook
        setSheetNames(workbook.SheetNames)
        setActiveSheet(workbook.SheetNames[0] ?? '')
      } catch (error) {
        if (!cancelled) setRenderError(toError(error).message || 'Failed to parse spreadsheet')
      }
    }
    void parse()
    return () => {
      cancelled = true
    }
  }, [fileData])

  useEffect(() => {
    const workbook = workbookRef.current
    if (!workbook || !activeSheet) return
    let cancelled = false
    const parseSheet = async () => {
      try {
        const XLSX = await import('xlsx')
        const data = readXlsxPreviewData(XLSX, workbook.Sheets[activeSheet])
        if (!cancelled) setSheet({ name: activeSheet, ...data })
      } catch (error) {
        if (!cancelled) setRenderError(toError(error).message || 'Failed to parse sheet')
      }
    }
    void parseSheet()
    return () => {
      cancelled = true
    }
  }, [activeSheet])

  const failure = resolvePreviewError(preview.error, renderError)
  if (failure) return <PreviewError label='spreadsheet' error={failure} />
  if (!fileData || !sheet) return null
  const note = truncationNote(sheet)
  const table = (
    <div ref={scrollRef} className={styles.frame}>
      <DataTable headers={sheet.headers} rows={sheet.rows} />
      {note && (
        <p className={styles.note} data-type='T052'>
          {note}
        </p>
      )}
    </div>
  )
  return (
    <div className={styles.sheets}>
      <ContentTabs
        label='Sheets'
        current={activeSheet}
        onSelect={setActiveSheet}
        items={sheetNames.map((name) => ({
          id: name,
          label: name,
          content: name === sheet.name ? table : null,
        }))}
      />
    </div>
  )
}
