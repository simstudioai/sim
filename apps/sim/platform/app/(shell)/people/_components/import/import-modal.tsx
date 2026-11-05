'use client'

import { useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import styles from '@/platform/app/(shell)/people/_components/import/import.module.css'
import {
  Button,
  FileField,
  InlineNotice,
  Modal,
  SecretField,
  SelectField,
  TextField,
} from '@/platform/design-system/components'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import {
  type ImportBody,
  isApiConflict,
  type PeopleImportResult,
  usePeopleImport,
  useProvisioningConnection,
} from '@/platform/lib/data/people'
import { toast } from '@/platform/lib/data/toast'

const ACCEPTED_FILES = '.csv,.tsv,.xlsx,.xls'
const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(
  'email,title,department,location,start_date,manager_email\nada@example.com,Engineer,Platform,Berlin,2024-01-31,grace@example.com\n'
)}`

const SOURCES = {
  okta: { name: 'Okta', description: 'Read profiles from your Okta directory' },
  entra: { name: 'Microsoft Entra ID', description: 'Read profiles from Microsoft Graph' },
  directory: {
    name: 'SCIM provisioning',
    description: 'Use directory data already provisioned to Sim',
  },
  file: { name: 'Spreadsheet', description: 'Upload a CSV or Excel file' },
} as const

type ImportSource = keyof typeof SOURCES

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** Whether SCIM can be offered: `canProvision` in the legacy sync and import dialogs alike. */
export function canUseProvisioning({ deployment, settingsFeatures }: PlatformOrganization) {
  return deployment.features.scim && (!deployment.hosted || settingsFeatures.hasEnterprisePlan)
}

interface IssueListProps {
  result: PeopleImportResult
  spreadsheet: boolean
}

function IssueList({ result, spreadsheet }: IssueListProps) {
  const unlisted = result.skipped + result.warnings - result.issues.length
  return (
    <ul className={styles.issues} data-type='T060'>
      {result.issues.map((issue) => (
        <li key={`${issue.row}-${issue.message}`} data-severity={issue.severity}>
          {spreadsheet && `Row ${issue.row} `}
          {issue.email ? `${issue.email}: ` : ''}
          {issue.message}
        </li>
      ))}
      {unlisted > 0 && <li>and {plural(unlisted, 'more issue')}</li>}
    </ul>
  )
}

interface ImportModalProps {
  organization: PlatformOrganization
  onClose: () => void
}

/**
 * One-time import: choose a source, preview, then apply exactly what was previewed. A directory
 * that moved after its preview answers 409 and returns here for a new one. Tokens stay in this
 * component's state and reach the request through the mutation that keeps them out of the cache.
 */
export function ImportModal({ organization, onClose }: ImportModalProps) {
  const organizationId = organization.organization.id
  const provisionable = canUseProvisioning(organization)
  const importPeople = usePeopleImport(organizationId)
  const [source, setSource] = useState<ImportSource>('okta')
  const connection = useProvisioningConnection(organizationId, source === 'directory')
  const [domain, setDomain] = useState('')
  const [token, setToken] = useState('')
  const [sheet, setSheet] = useState<Awaited<ReturnType<typeof importPeople.readSheet>> | null>(
    null
  )
  const [reading, setReading] = useState(false)
  const [fileError, setFileError] = useState<string | undefined>()
  const [preview, setPreview] = useState<PeopleImportResult | null>(null)
  const pending = reading || importPeople.pending
  const done = preview?.updated === 0
  const ready =
    source === 'file'
      ? Boolean(sheet)
      : source === 'directory'
        ? connection.ready && connection.userCount > 0
        : Boolean(token.trim() && (source !== 'okta' || domain.trim()))

  function requestBody(apply: boolean, selected = sheet): ImportBody | null {
    const previewDigest = apply ? preview?.previewDigest : undefined
    if (source === 'file')
      return selected ? { headers: selected.headers, rows: selected.rows, apply } : null
    if (source === 'okta')
      return { source, domain: domain.trim(), token: token.trim(), apply, previewDigest }
    if (source === 'entra') return { source, token: token.trim(), apply, previewDigest }
    return { source, apply, previewDigest }
  }

  async function chooseFile(file: File) {
    setFileError(undefined)
    setReading(true)
    setSheet(null)
    try {
      const selected = await importPeople.readSheet(file)
      setSheet(selected)
      const body = requestBody(false, selected)
      if (body) setPreview(await importPeople.submit(body))
    } catch (error) {
      setFileError(getErrorMessage(error, 'Could not import people data'))
    } finally {
      setReading(false)
    }
  }

  const title = preview
    ? 'Review import'
    : source === 'file'
      ? 'Import a spreadsheet'
      : `Import from ${SOURCES[source].name}`
  const sourceOptions = (Object.keys(SOURCES) as ImportSource[])
    .filter((key) => key !== 'directory' || provisionable)
    .map((key) => ({ value: key, label: SOURCES[key].name }))

  return (
    <Modal
      open
      onOpenChange={onClose}
      title={title}
      confirmLabel={done ? 'Done' : preview ? 'Import' : 'Preview import'}
      confirmDisabled={pending || (!preview && !ready)}
      cancelLabel={preview ? 'Back' : undefined}
      onCancel={preview && !pending ? () => setPreview(null) : undefined}
      onConfirm={
        done
          ? undefined
          : async () => {
              const body = requestBody(Boolean(preview))
              if (!body) return
              try {
                const result = await importPeople.submit(body)
                if (preview) {
                  toast.success(`Updated ${plural(result.updated, 'profile')}`)
                  return
                }
                setPreview(result)
                return false
              } catch (error) {
                if (source !== 'file' && preview && isApiConflict(error)) setPreview(null)
                throw error
              }
            }
      }
    >
      {preview ? (
        <>
          <p className={styles.secondary} data-type='T060'>
            {source === 'file' ? sheet?.fileName : SOURCES[source].name}
          </p>
          <p data-type='T059'>
            {done
              ? 'No profiles to update.'
              : `${plural(preview.updated, 'profile')} will be updated.`}
          </p>
          <p className={styles.secondary} data-type='T060'>
            {`${preview.unchanged} unchanged · ${preview.skipped} skipped · ${plural(preview.warnings, 'warning')}`}
          </p>
          {preview.issues.length > 0 && (
            <IssueList result={preview} spreadsheet={source === 'file'} />
          )}
          {!done && (
            <p className={styles.secondary} data-type='T060'>
              {source === 'file'
                ? 'Import applies these profile updates to matching members.'
                : 'Import updates matching members’ profiles. If the directory changes, you’ll be asked to preview it again.'}
            </p>
          )}
        </>
      ) : (
        <>
          <SelectField
            label='Source'
            options={sourceOptions}
            value={source}
            hint={SOURCES[source].description}
            disabled={pending}
            onValueChange={(next) => {
              setSource(next as ImportSource)
              setToken('')
            }}
          />
          {(source === 'okta' || source === 'entra') && (
            <>
              <p className={styles.secondary} data-type='T060'>
                {source === 'okta'
                  ? 'Use an Okta API token that can read users in your organization.'
                  : 'In Graph Explorer, sign in with your work or school account, grant delegated User.Read.All permission, and copy your access token. Microsoft commercial cloud is supported.'}{' '}
                Sim uses the token for this import only.
              </p>
              {source === 'okta' && (
                <TextField
                  label='Okta domain'
                  placeholder='company.okta.com'
                  autoComplete='off'
                  value={domain}
                  disabled={pending}
                  onChange={setDomain}
                />
              )}
              <SecretField
                label={source === 'okta' ? 'API token' : 'Access token'}
                placeholder={
                  source === 'okta'
                    ? 'Paste your token without SSWS'
                    : 'Paste your token without Bearer'
                }
                value={token}
                disabled={pending}
                onChange={setToken}
              />
              <div>
                <Button
                  variant='quiet'
                  size='compact'
                  render={
                    <Link
                      href={
                        source === 'okta'
                          ? 'https://developer.okta.com/docs/guides/create-an-api-token/main/'
                          : 'https://developer.microsoft.com/en-us/graph/graph-explorer'
                      }
                      target='_blank'
                      rel='noreferrer'
                    />
                  }
                >
                  {source === 'okta' ? 'Create an Okta API token' : 'Open Graph Explorer'}
                </Button>
              </div>
            </>
          )}
          {source === 'directory' && (
            <>
              <p className={styles.secondary} data-type='T060'>
                {connection.loading
                  ? 'Checking your provisioning connection…'
                  : connection.failed
                    ? 'Could not load your provisioning connection.'
                    : !connection.active
                      ? 'Enable SCIM provisioning and assign accounts in your provider to import their profiles.'
                      : connection.userCount === 0
                        ? 'Your connection is active. Assign accounts to Sim in your identity provider, then refresh here.'
                        : `Your connection has ${connection.userCount} provisioned ${connection.userCount === 1 ? 'account' : 'accounts'}. Preview the profile fields and reporting lines sent by your provider.`}
              </p>
              {!connection.loading && (
                <div className={styles.links}>
                  {organization.settingsSections.includes('sso') && !connection.failed && (
                    <Button
                      variant='quiet'
                      size='compact'
                      render={<Link href='/settings/sso?tab=provisioning' />}
                    >
                      {connection.active ? 'Manage provisioning' : 'Set up provisioning'}
                    </Button>
                  )}
                  {!connection.active && (
                    <Button
                      variant='quiet'
                      size='compact'
                      render={
                        <Link
                          href='https://docs.sim.ai/platform/enterprise/scim'
                          target='_blank'
                          rel='noreferrer'
                        />
                      }
                    >
                      Provisioning guide
                    </Button>
                  )}
                  <Button
                    variant='quiet'
                    size='compact'
                    disabled={connection.fetching}
                    onClick={connection.refresh}
                  >
                    {connection.failed ? 'Retry connection' : 'Refresh'}
                  </Button>
                </div>
              )}
            </>
          )}
          {source === 'file' && (
            <>
              <FileField
                label='File'
                accept={ACCEPTED_FILES}
                prompt='Drop a file here or click to browse'
                selection={sheet ? { name: sheet.fileName } : undefined}
                onClear={() => setSheet(null)}
                onFileChange={(file) => void chooseFile(file)}
                disabled={pending}
                error={fileError}
                hint='CSV or Excel with an email column, plus any of title, department, location, start date, and manager email.'
              />
              {reading && <InlineNotice message='Reading…' />}
              <div>
                <Button
                  variant='quiet'
                  size='compact'
                  render={<Link href={TEMPLATE_HREF} download='people-template.csv' />}
                >
                  Download template
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  )
}
