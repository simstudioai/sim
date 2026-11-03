'use client'

import { useRef, useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalDescription,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  cn,
  scrollFadeAttributes,
  scrollFadeClass,
  toast,
  useScrollEdges,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { isOrganizationSettingsSectionAvailable } from '@/components/settings/navigation'
import { isApiClientError } from '@/lib/api/client/errors'
import type { PeopleImportBody, PeopleImportResult } from '@/lib/api/contracts/people'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { saveBlob } from '@/lib/uploads/client/download'
import {
  IMPORT_SOURCES,
  type ImportSource,
  ImportSourcePicker,
  ProviderFields,
  ProvisioningSource,
} from '@/app/o/[organizationId]/people/import-source'
import {
  type PeopleSheet,
  readPeopleSheet,
} from '@/app/o/[organizationId]/people/read-people-sheet'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { useScimConnection } from '@/ee/scim/hooks/scim'
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
  spreadsheet: boolean
}

function ImportIssueList({ result, spreadsheet }: ImportIssueListProps) {
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
          {spreadsheet && <span className='text-[var(--text-muted)]'>Row {issue.row}</span>}{' '}
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

export function PeopleImportModal({ organizationId, onClose }: PeopleImportModalProps) {
  const [source, setSource] = useState<ImportSource | null>(null)
  const { settingsFeatures } = useOrganizationContext()
  const { features, hosted } = useDeploymentShape()
  const canProvision = features.scim && (!hosted || settingsFeatures.hasEnterprisePlan)

  if (source && (source !== 'directory' || canProvision)) {
    return (
      <SourceImportModal
        key={source}
        source={source}
        organizationId={organizationId}
        onClose={onClose}
        onBack={() => setSource(null)}
        canOpenSettings={isOrganizationSettingsSectionAvailable('sso', settingsFeatures)}
      />
    )
  }

  return (
    <ChipModal open onOpenChange={(open) => !open && onClose()} srTitle='Import people data'>
      <ChipModalHeader onClose={onClose}>Import people data</ChipModalHeader>
      <ChipModalBody>
        <ImportSourcePicker canProvision={canProvision} onChoose={setSource} />
      </ChipModalBody>
      <ChipModalFooter onCancel={onClose} defaultAction='none' />
    </ChipModal>
  )
}

interface SourceImportModalProps extends PeopleImportModalProps {
  source: ImportSource
  onBack: () => void
  canOpenSettings: boolean
}

function SourceImportModal({
  organizationId,
  source,
  onBack,
  onClose,
  canOpenSettings,
}: SourceImportModalProps) {
  const connection = useScimConnection(organizationId, source === 'directory')
  const importPeople = useImportPeople(organizationId)
  const [domain, setDomain] = useState('')
  const [token, setToken] = useState('')
  const [sheet, setSheet] = useState<PeopleSheet | null>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PeopleImportResult | null>(null)
  const busy = useRef(false)
  const pending = reading || importPeople.isPending
  const provider = source === 'okta' || source === 'entra'
  const ready =
    source === 'file'
      ? Boolean(sheet)
      : source === 'directory'
        ? connection.isSuccess &&
          connection.data.connection?.status === 'active' &&
          connection.data.connection.userCount > 0
        : Boolean(token.trim() && (source !== 'okta' || domain.trim()))
  const sourceName = IMPORT_SOURCES[source].name
  const title = preview
    ? 'Review import'
    : source === 'file'
      ? 'Import a spreadsheet'
      : `Import from ${sourceName}`

  const submit = async (apply: boolean, file?: File) => {
    if (busy.current || (apply && !preview?.updated)) return
    busy.current = true
    setError(null)
    try {
      let body: PeopleImportBody
      if (source === 'file') {
        let selected = sheet
        if (file) {
          setReading(true)
          setSheet(null)
          selected = await readPeopleSheet(file)
          setSheet(selected)
        }
        if (!selected) return
        body = { headers: selected.headers, rows: selected.rows, apply }
      } else if (source === 'okta') {
        body = {
          source,
          domain: domain.trim(),
          token: token.trim(),
          apply,
          previewDigest: apply ? preview?.previewDigest : undefined,
        }
      } else if (source === 'entra') {
        body = {
          source,
          token: token.trim(),
          apply,
          previewDigest: apply ? preview?.previewDigest : undefined,
        }
      } else {
        body = { source, apply, previewDigest: apply ? preview?.previewDigest : undefined }
      }
      const result = await importPeople.submit(body)
      if (apply) {
        toast.success(`Updated ${plural(result.updated, 'profile')}`)
        onClose()
      } else {
        setPreview(result)
      }
    } catch (cause) {
      if (source !== 'file' && apply && isApiClientError(cause) && cause.status === 409)
        setPreview(null)
      setError(getErrorMessage(cause, 'Could not import people data'))
    } finally {
      busy.current = false
      setReading(false)
    }
  }

  const goBack = () => {
    if (busy.current) return
    if (preview) {
      setPreview(null)
      setError(null)
    } else {
      onBack()
    }
  }

  const done = preview?.updated === 0
  return (
    <ChipModal
      open
      onOpenChange={(open) => !open && onClose()}
      dismissDisabled={pending}
      srTitle={title}
    >
      <ChipModalHeader onClose={onClose}>{title}</ChipModalHeader>
      <ChipModalBody>
        {preview ? (
          <>
            <ChipModalDescription>
              {source === 'file' ? sheet?.fileName : sourceName}
            </ChipModalDescription>
            <ChipModalField type='custom' title='Preview'>
              {() => (
                <div className='flex flex-col gap-2 text-small'>
                  <p className='font-medium text-[var(--text-body)]'>
                    {done
                      ? 'No profiles to update.'
                      : `${plural(preview.updated, 'profile')} will be updated.`}
                  </p>
                  <p className='text-[var(--text-muted)]'>
                    {[
                      `${preview.unchanged} unchanged`,
                      `${preview.skipped} skipped`,
                      plural(preview.warnings, 'warning'),
                    ].join(' · ')}
                  </p>
                  {preview.issues.length > 0 && (
                    <ImportIssueList result={preview} spreadsheet={source === 'file'} />
                  )}
                </div>
              )}
            </ChipModalField>
            {!done && (
              <ChipModalDescription>
                {source !== 'file'
                  ? 'Import updates matching members’ profiles. If the directory changes, you’ll be asked to preview it again.'
                  : 'Import applies these profile updates to matching members.'}
              </ChipModalDescription>
            )}
          </>
        ) : provider ? (
          <ProviderFields
            source={source}
            domain={domain}
            onDomainChange={(value) => {
              setDomain(value)
              setError(null)
            }}
            token={token}
            onTokenChange={(value) => {
              setToken(value)
              setError(null)
            }}
            disabled={pending}
          />
        ) : source === 'directory' ? (
          <ProvisioningSource
            organizationId={organizationId}
            connection={connection}
            canOpenSettings={canOpenSettings}
          />
        ) : (
          <ChipModalField
            type='file'
            title='File'
            accept={ACCEPTED_FILES}
            loading={pending}
            label={
              sheet
                ? `${sheet.fileName} · Choose another file`
                : 'Drop a file here or click to browse'
            }
            description='CSV or Excel with an email column, plus any of title, department, location, start date, and manager email.'
            onChange={([file]) => file && void submit(false, file)}
          />
        )}
        <ChipModalError>{error}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={goBack}
        cancelLabel='Back'
        secondaryActions={
          source === 'file' && !preview
            ? [{ label: 'Template', onClick: downloadTemplate }]
            : undefined
        }
        primaryAction={{
          label: pending
            ? preview
              ? 'Importing…'
              : 'Reading…'
            : done
              ? 'Done'
              : preview
                ? 'Import'
                : 'Preview import',
          disabled: pending || (!preview && !ready),
          onClick: done ? onClose : () => void submit(Boolean(preview)),
        }}
      />
    </ChipModal>
  )
}
