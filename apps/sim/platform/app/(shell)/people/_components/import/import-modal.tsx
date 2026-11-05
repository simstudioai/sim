'use client'

import { useState } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import { isOrganizationSettingsSectionAvailable } from '@/components/settings/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'
import { serializeSsoSettings } from '@/ee/sso/search-params'
import styles from '@/platform/app/(shell)/people/_components/import/import.module.css'
import {
  ActivityRow,
  Button,
  FileField,
  InlineNotice,
  Modal,
  SecretField,
  TextField,
} from '@/platform/design-system/components'
import { ModalBody } from '@/platform/design-system/components/modal/modal-parts'
import { OverlayDialog } from '@/platform/design-system/components/modal/overlay-dialog'
import {
  type ImportBody,
  isApiConflict,
  type PeopleImportResult,
  usePeopleImport,
  useProvisioningConnection,
} from '@/platform/lib/data/people'
import { plural } from '@/platform/lib/plural'

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

/** Whether SCIM can be offered: `canProvision` in the legacy sync and import dialogs alike. */
export function canUseProvisioning({ deployment, settingsFeatures }: OrganizationSurfaceContext) {
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
  organization: OrganizationSurfaceContext
  onClose: () => void
}

/**
 * One-time import: choose a source, preview, then apply exactly what was previewed. A directory
 * that moved after its preview answers 409 and returns here for a new one. Tokens stay in this
 * component's state and reach the request through the mutation that keeps them out of the cache.
 */
export function ImportModal({ organization, onClose }: ImportModalProps) {
  const [source, setSource] = useState<ImportSource | null>(null)
  const provisionable = canUseProvisioning(organization)
  if (source && (source !== 'directory' || provisionable))
    return (
      <SourceImportModal
        key={source}
        organization={organization}
        source={source}
        onBack={() => setSource(null)}
        onClose={onClose}
      />
    )
  return (
    <OverlayDialog open onClose={onClose} title='Import people data'>
      <ModalBody label='Source'>
        <p className={styles.secondary} data-type='T060'>
          Choose a source for a one-time update to members’ job titles, departments, and reporting
          lines.
        </p>
        <ul className={styles.sources}>
          {(Object.keys(SOURCES) as ImportSource[])
            .filter((key) => key !== 'directory' || provisionable)
            .map((key) => (
              <ActivityRow
                key={key}
                title={SOURCES[key].name}
                detail={SOURCES[key].description}
                render={
                  <button
                    type='button'
                    aria-label={SOURCES[key].name}
                    onClick={() => setSource(key)}
                  />
                }
              />
            ))}
        </ul>
      </ModalBody>
    </OverlayDialog>
  )
}

interface SourceImportModalProps extends ImportModalProps {
  source: ImportSource
  onBack: () => void
}

/** Back returns from the preview to the source's fields, and from the fields to the sources. */
function SourceImportModal({ organization, source, onBack, onClose }: SourceImportModalProps) {
  const organizationId = organization.organization.id
  const importPeople = usePeopleImport(organizationId)
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
  return (
    <Modal
      open
      onOpenChange={() => {
        // A spreadsheet previews as soon as it is chosen, outside the dialog's own confirm.
        if (!pending) onClose()
      }}
      title={title}
      confirmLabel={done ? 'Done' : preview ? 'Import' : 'Preview import'}
      confirmDisabled={pending || (!preview && !ready)}
      onBack={() => {
        if (pending) return
        if (preview) setPreview(null)
        else onBack()
      }}
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
                        : `Your connection has ${plural(connection.userCount, 'provisioned account')}. Preview the profile fields and reporting lines sent by your provider.`}
              </p>
              {!connection.loading && (
                <div className={styles.links}>
                  {isOrganizationSettingsSectionAvailable('sso', organization.settingsFeatures) &&
                    !connection.failed && (
                      <Button
                        variant='quiet'
                        size='compact'
                        render={
                          <Link
                            href={serializeSsoSettings(
                              organizationRoutes(organizationId).settingsSection('sso'),
                              { tab: 'provisioning' }
                            )}
                          />
                        }
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
