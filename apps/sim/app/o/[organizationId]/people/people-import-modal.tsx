'use client'

import { useRef, useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  cn,
  scrollFadeAttributes,
  scrollFadeClass,
  useScrollEdges,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { PEOPLE_IMPORT_MAX_ROWS, type PeopleImportResult } from '@/lib/api/contracts/people'
import { assertOoxmlPreviewWithinLimits } from '@/lib/file-parsers/ooxml-preview-guard'
import { saveBlob } from '@/lib/uploads/client/download'
import { useImportPeople } from '@/hooks/queries/people'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const ACCEPTED_FILES = '.csv,.tsv,.xlsx,.xls'
const TEMPLATE_CSV =
  'email,title,department,location,start_date,manager_email\nada@example.com,Engineer,Platform,Berlin,2024-01-31,grace@example.com\n'

interface PeopleSheet {
  fileName: string
  headers: string[]
  /** Each row's cells, in `headers` order. */
  rows: string[][]
}

/**
 * The first sheet's named columns and its rows of cells, one per sheet row (blank ones included) so the
 * row numbers in the preview match the spreadsheet. Delimited text is read verbatim so the server
 * interprets dates the same way for every file. A spreadsheet date cell is read from its stored
 * value, not the text its locale displays, so `31/01/2024` and `1/31/24` both arrive as
 * `2024-01-31`.
 */
async function readPeopleSheet(file: File): Promise<PeopleSheet> {
  if (file.size > MAX_FILE_BYTES) throw new Error('Choose a file under 5 MB')
  const data = new Uint8Array(await file.arrayBuffer())
  if (/\.xlsx$/i.test(file.name)) await assertOoxmlPreviewWithinLimits(data)
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(data, {
    type: 'array',
    raw: /\.(csv|tsv)$/i.test(file.name),
    dense: true,
  })
  const sheet = workbook.Sheets[workbook.SheetNames[0] ?? '']
  if (!sheet?.['!ref']) throw new Error('The file has no rows')
  const range = XLSX.utils.decode_range(sheet['!ref'])
  const grid = sheet['!data'] ?? []
  const text = (row: number, column: number): string => {
    const cell = grid[row]?.[column]
    if (!cell || cell.v === undefined || cell.v === null) return ''
    if (cell.t === 'n' && XLSX.SSF.is_date(cell.z ?? '')) {
      const date = XLSX.SSF.parse_date_code(Number(cell.v))
      return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
    }
    return String(cell.w ?? cell.v).trim()
  }
  const columns: { header: string; index: number }[] = []
  for (let index = range.s.c; index <= range.e.c; index++) {
    const header = text(range.s.r, index)
    if (!header) continue
    if (columns.some((column) => column.header === header)) {
      throw new Error(`The ${header} column appears more than once`)
    }
    columns.push({ header, index })
  }
  if (!columns.length) throw new Error('The first row should name the columns')
  const rowCount = range.e.r - range.s.r
  if (rowCount > PEOPLE_IMPORT_MAX_ROWS) {
    throw new Error(`Import at most ${PEOPLE_IMPORT_MAX_ROWS} rows at a time`)
  }
  return {
    fileName: file.name,
    headers: columns.map(({ header }) => header),
    rows: Array.from({ length: rowCount }, (_, offset) =>
      columns.map(({ index }) => text(range.s.r + 1 + offset, index))
    ),
  }
}

function downloadTemplate() {
  saveBlob(new Blob([TEMPLATE_CSV], { type: 'text/csv' }), 'people-template.csv')
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** The preview's issues in file order, with a count of any past the ones listed. */
interface ImportIssueListProps {
  result: PeopleImportResult
}

function ImportIssueList({ result }: ImportIssueListProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const edges = useScrollEdges(listRef)
  const unlisted = result.skipped + result.warnings - result.issues.length
  return (
    <ul
      ref={listRef}
      {...scrollFadeAttributes(edges)}
      className={cn(
        'max-h-[200px] overflow-y-auto rounded-sm border border-[var(--border)] p-2',
        scrollFadeClass
      )}
    >
      {result.issues.map((issue) => (
        <li key={`${issue.row}-${issue.message}`} className='py-0.5'>
          <span className='text-[var(--text-muted)]'>Row {issue.row}</span>{' '}
          <span
            className={cn(
              issue.severity === 'skipped' ? 'text-[var(--text-error)]' : 'text-[var(--text-body)]'
            )}
          >
            {issue.email ? `${issue.email}: ` : ''}
            {issue.message}
          </span>
        </li>
      ))}
      {unlisted > 0 && (
        <li className='py-0.5 text-[var(--text-muted)]'>and {plural(unlisted, 'more issue')}</li>
      )}
    </ul>
  )
}

interface PeopleImportModalProps {
  organizationId: string
  onClose: () => void
}

/**
 * Imports people data from an HR export: choosing a file previews what would change, and
 * nothing is written until the preview is confirmed.
 */
export function PeopleImportModal({ organizationId, onClose }: PeopleImportModalProps) {
  const importPeople = useImportPeople(organizationId)
  const [sheet, setSheet] = useState<PeopleSheet | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [preview, setPreview] = useState<PeopleImportResult | null>(null)
  const pending = reading || importPeople.isPending

  const choose = async ([file]: File[]) => {
    if (!file) return
    setReadError(null)
    setSheet(null)
    setPreview(null)
    importPeople.reset()
    setReading(true)
    try {
      const next = await readPeopleSheet(file)
      setSheet(next)
      importPeople.mutate(
        { headers: next.headers, rows: next.rows, apply: false },
        { onSuccess: setPreview }
      )
    } catch (error) {
      setReadError(getErrorMessage(error, 'Could not read the file'))
    } finally {
      setReading(false)
    }
  }

  const apply = () => {
    if (!sheet) return
    importPeople.mutate(
      { headers: sheet.headers, rows: sheet.rows, apply: true },
      { onSuccess: onClose }
    )
  }

  return (
    <ChipModal
      open
      onOpenChange={(open) => !open && onClose()}
      dismissDisabled={importPeople.isPending}
      srTitle='Import people data'
    >
      <ChipModalHeader onClose={onClose}>Import people data</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='file'
          title='File'
          accept={ACCEPTED_FILES}
          loading={pending}
          label={
            sheet
              ? `${sheet.fileName}: click or drop to replace`
              : 'Drop a file here or click to browse'
          }
          description='CSV or Excel with an email column, plus any of title, department, location, start date, and manager email.'
          error={readError ?? undefined}
          onChange={(files) => void choose(files)}
        />
        {preview && (
          <ChipModalField type='custom' title='Preview'>
            {() => (
              <div className='flex flex-col gap-2 text-small'>
                <p className='text-[var(--text-body)]'>
                  {preview.updated
                    ? `${plural(preview.updated, 'profile')} will be updated.`
                    : 'Nothing to update.'}{' '}
                  <span className='text-[var(--text-muted)]'>
                    {[
                      preview.unchanged && `${preview.unchanged} unchanged`,
                      preview.skipped && `${preview.skipped} skipped`,
                      preview.warnings && plural(preview.warnings, 'warning'),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </p>
                {preview.issues.length > 0 && <ImportIssueList result={preview} />}
              </div>
            )}
          </ChipModalField>
        )}
        <ChipModalError>{importPeople.error?.message}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        secondaryActions={[{ label: 'Download template', onClick: downloadTemplate }]}
        primaryAction={{
          label: importPeople.isPending && preview ? 'Importing' : 'Import',
          disabled: pending || !preview?.updated,
          onClick: apply,
        }}
      />
    </ChipModal>
  )
}
