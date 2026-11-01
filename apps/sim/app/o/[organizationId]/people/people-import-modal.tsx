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
import type { PeopleImportResult } from '@/lib/api/contracts/people'
import { saveBlob } from '@/lib/uploads/client/download'
import {
  type PeopleSheet,
  readPeopleSheet,
} from '@/app/o/[organizationId]/people/read-people-sheet'
import { useImportPeople } from '@/hooks/queries/people'

const ACCEPTED_FILES = '.csv,.tsv,.xlsx,.xls'
const TEMPLATE_CSV =
  'email,title,department,location,start_date,manager_email\nada@example.com,Engineer,Platform,Berlin,2024-01-31,grace@example.com\n'

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
