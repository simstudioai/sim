'use client'

import { useState } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import {
  Button,
  FileField,
  InlineNotice,
  MetricGroup,
  Modal,
  SecretField,
  SelectField,
  TextField,
} from '@/platform/design-system/components'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'
import { ExternalLink } from '@/platform/embedded/app/(shell)/people/_components/external-link/external-link'
import styles from '@/platform/embedded/app/(shell)/people/_components/import/import.module.css'
import {
  downloadImportTemplate,
  type ImportBody,
  isApiConflict,
  type PeopleImportResult,
  usePeopleImport,
  usePeopleViewer,
  useProvisioningConnection,
} from '@/platform/embedded/lib/data/people'
import { plural } from '@/platform/embedded/lib/plural'

const ACCEPTED_FILES = '.csv,.tsv,.xlsx,.xls'

const SOURCES = {
  file: { name: 'Spreadsheet', description: 'Upload a CSV or Excel file' },
  okta: { name: 'Okta', description: 'Read profiles from your Okta directory' },
  entra: { name: 'Microsoft Entra ID', description: 'Read profiles from Microsoft Graph' },
  directory: {
    name: 'SCIM provisioning',
    description: 'Use directory data already provisioned to Sim',
  },
} as const

type ImportSource = keyof typeof SOURCES

const TOKEN_SOURCES = {
  okta: {
    instructions: 'Use an Okta API token that can read users in your organization.',
    tokenLabel: 'API token',
    tokenPlaceholder: 'Paste your token without SSWS',
    helpHref: 'https://developer.okta.com/docs/guides/create-an-api-token/main/',
    helpLabel: 'Create an Okta API token',
  },
  entra: {
    instructions:
      'In Graph Explorer, sign in with your work or school account, grant delegated User.Read.All permission, and copy your access token. Microsoft commercial cloud is supported.',
    tokenLabel: 'Access token',
    tokenPlaceholder: 'Paste your token without Bearer',
    helpHref: 'https://developer.microsoft.com/en-us/graph/graph-explorer',
    helpLabel: 'Open Graph Explorer',
  },
} as const

interface IssueListProps {
  result: PeopleImportResult
  spreadsheet: boolean
}

function IssueList({ result, spreadsheet }: IssueListProps) {
  const unlisted = result.skipped + result.warnings - result.issues.length
  const issueEdges = useScrollEdges<HTMLUListElement>()
  return (
    <section className={styles.attention} aria-labelledby='import-attention'>
      <h3 id='import-attention' className={styles.attentionTitle} data-type='T042'>
        {`${plural(result.skipped + result.warnings, 'row')} need${result.skipped + result.warnings === 1 ? 's' : ''} attention`}
      </h3>
      <ul ref={issueEdges} className={styles.issues} data-type='T060'>
        {result.issues.map((issue) => (
          <li key={`${issue.row}-${issue.message}`} className={styles.issue}>
            {spreadsheet && <span className={styles.secondary}>Row {issue.row}</span>}
            <span className={styles.issueMessage}>
              {issue.email ? `${issue.email}: ` : ''}
              {issue.message}
            </span>
            <span className={styles.secondary}>
              {issue.severity === 'skipped' ? 'Skipped' : 'Warning'}
            </span>
          </li>
        ))}
        {unlisted > 0 && <li className={styles.secondary}>and {plural(unlisted, 'more issue')}</li>}
      </ul>
    </section>
  )
}

interface ImportModalProps {
  organizationId: string
  onClose: () => void
  onOpenSync: () => void
}

/**
 * One-time import: choose a source, preview, then apply exactly what was previewed. A directory
 * that moved after its preview answers 409 and returns here for a new one. Tokens stay in this
 * component's state and reach the request through the mutation that keeps them out of the cache.
 */
export function ImportModal({ organizationId, onClose, onOpenSync }: ImportModalProps) {
  const { canProvision, canOpenProvisioningSettings, provisioningSettingsHref } = usePeopleViewer()
  const importPeople = usePeopleImport(organizationId)
  const [source, setSource] = useState<ImportSource>('file')
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
  const spreadsheet = source === 'file'
  const ready = spreadsheet
    ? Boolean(sheet)
    : source === 'directory'
      ? connection.ready && connection.userCount > 0
      : Boolean(token.trim() && (source !== 'okta' || domain.trim()))

  function requestBody(apply: boolean): ImportBody | null {
    const previewDigest = apply ? preview?.previewDigest : undefined
    if (source === 'file') return sheet ? { headers: sheet.headers, rows: sheet.rows, apply } : null
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
      setPreview(
        await importPeople.submit({ headers: selected.headers, rows: selected.rows, apply: false })
      )
    } catch (error) {
      setFileError(getErrorMessage(error, 'Could not import people data'))
    } finally {
      setReading(false)
    }
  }

  return (
    <Modal
      open
      onOpenChange={onClose}
      title={preview ? 'Review profile import' : 'Import profiles'}
      confirmLabel={
        done ? 'Done' : preview ? `Import ${plural(preview.updated, 'profile')}` : 'Preview import'
      }
      confirmDisabled={pending || (!preview && !ready)}
      pending={pending}
      onBack={preview ? () => setPreview(null) : undefined}
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
                if (!spreadsheet && preview && isApiConflict(error)) setPreview(null)
                throw error
              }
            }
      }
    >
      {preview ? (
        <>
          <p className={styles.secondary} data-type='T060'>
            {spreadsheet
              ? `${sheet?.fileName} updates profiles for existing organization members. It does not create accounts or an ongoing connection.`
              : `${SOURCES[source].name} updates profiles for existing organization members. If the directory changes, you’ll be asked to preview it again.`}
          </p>
          <MetricGroup
            metrics={[
              { label: 'To update', value: preview.updated },
              { label: 'Unchanged', value: preview.unchanged },
              { label: 'Skipped', value: preview.skipped },
            ]}
          />
          {preview.issues.length > 0 && <IssueList result={preview} spreadsheet={spreadsheet} />}
          {spreadsheet && (
            <p className={styles.secondary} data-type='T060'>
              To include people without Sim accounts and keep profiles current, connect Okta or
              Microsoft Entra ID through{' '}
              <button type='button' className={styles.inlineLink} onClick={onOpenSync}>
                Directory sync
              </button>
              .
            </p>
          )}
        </>
      ) : (
        <>
          <SelectField
            label='Source'
            options={(Object.keys(SOURCES) as ImportSource[])
              .filter((key) => key !== 'directory' || canProvision)
              .map((key) => ({ value: key, label: SOURCES[key].name }))}
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
                {TOKEN_SOURCES[source].instructions} Sim uses the token for this import only.
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
                label={TOKEN_SOURCES[source].tokenLabel}
                placeholder={TOKEN_SOURCES[source].tokenPlaceholder}
                value={token}
                disabled={pending}
                onChange={setToken}
              />
              <ExternalLink href={TOKEN_SOURCES[source].helpHref}>
                {TOKEN_SOURCES[source].helpLabel}
              </ExternalLink>
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
                        : `Your connection has ${plural(connection.userCount, 'provisioned account')}. Preview the profile fields and reporting lines sent by your provider.`}
              </p>
              {!connection.loading && (
                <div className={styles.links}>
                  {canOpenProvisioningSettings && !connection.failed && (
                    <Button
                      variant='quiet'
                      size='compact'
                      render={<Link href={provisioningSettingsHref} />}
                    >
                      {connection.active ? 'Manage provisioning' : 'Set up provisioning'}
                    </Button>
                  )}
                  {!connection.active && (
                    <ExternalLink href='https://docs.sim.ai/platform/enterprise/scim'>
                      Provisioning guide
                    </ExternalLink>
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
                <Button variant='quiet' size='compact' onClick={downloadImportTemplate}>
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
