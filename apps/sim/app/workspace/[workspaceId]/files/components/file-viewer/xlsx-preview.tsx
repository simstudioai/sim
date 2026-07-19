'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { Chip } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { useTranslations } from 'next-intl'
import type { WorkBook } from 'xlsx'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { DataTable } from './data-table'
import { PreviewError, PreviewLoadingFrame, resolvePreviewError } from './preview-shared'
import { useDocPreviewBinary } from './use-doc-preview-binary'

const logger = createLogger('XlsxPreview')

const XLSX_MAX_ROWS = 1_000

interface XlsxSheet {
  name: string
  headers: string[]
  rows: string[][]
  truncated: boolean
}

export const XlsxPreview = memo(function XlsxPreview({
  file,
  workspaceId,
}: {
  file: WorkspaceFileRecord
  workspaceId: string
}) {
  const t = useTranslations('auto')
  const preview = useDocPreviewBinary(workspaceId, file)
  const fileData = preview.data

  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [activeSheet, setActiveSheet] = useState(0)
  const [currentSheet, setCurrentSheet] = useState<XlsxSheet | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const workbookRef = useRef<WorkBook | null>(null)

  useEffect(() => {
    if (!fileData) return
    const data = fileData

    let cancelled = false

    async function parse() {
      try {
        setRenderError(null)
        const XLSX = await import('xlsx')
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

  const error = resolvePreviewError(preview.error, renderError)
  if (error) return <PreviewError label={t('spreadsheet')} error={error} />
  if (!fileData || currentSheet === null) {
    return <PreviewLoadingFrame className='flex flex-1 flex-col overflow-hidden' />
  }

  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      <div className='flex shrink-0 items-center border-[var(--border)] border-b bg-[var(--surface-1)] px-2 py-1'>
        <div className='flex items-center overflow-x-auto'>
          {sheetNames.map((name, i) => (
            <Chip
              key={name}
              active={i === activeSheet}
              onClick={() => setActiveSheet(i)}
              className='shrink-0'
            >
              {name}
            </Chip>
          ))}
        </div>
      </div>
      <div className='flex-1 overflow-auto p-6'>
        <DataTable headers={currentSheet.headers} rows={currentSheet.rows} />
        {currentSheet.truncated && (
          <p className='mt-3 text-center text-[12px] text-[var(--text-muted)]'>
            {t('showing_first')} {XLSX_MAX_ROWS.toLocaleString()}{' '}
            {t('rows_download_the_file_to_view')}
          </p>
        )}
      </div>
    </div>
  )
})
