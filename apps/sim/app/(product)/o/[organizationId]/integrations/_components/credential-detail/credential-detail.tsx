'use client'

import { type ReactNode, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { TextAreaField, TextField } from '@sim/emcn/field'
import { Icon } from '@sim/emcn/icon'
import { ContentTabs } from '@sim/emcn/tabs/content-tabs'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryStates } from 'nuqs'
import { DirectoryHeading } from '@/app/(product)/_components/resource-directory/resource-directory'
import {
  CredentialAccess,
  type CredentialAccessActions,
} from '@/app/(product)/o/[organizationId]/integrations/_components/credential-access/credential-access'
import styles from '@/app/(product)/o/[organizationId]/integrations/_components/credential-detail/credential-detail.module.css'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'
import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'
import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'
import { credentialDetailParams } from '@/platform/lib/integrations/credential-navigation'

interface CredentialDetailProps {
  credential: IntegrationCredential
  integrationName: string
  providerId?: string
  viewer: IntegrationPerson
  /**
   * Saves the edited name and description; a rejection's reason shows on the form, which keeps the
   * draft. Absent where nothing can rename this credential.
   */
  onSaveDetails?: (details: { displayName: string; description: string }) => Promise<void> | void
  /** Who can be given access and the Access tab's edits; absent where nothing can change them. */
  access?: CredentialAccessActions
  onReconnect?: () => void
  onDisconnect: () => void
  fields?: ReactNode
  onReplace?: () => void
  /** The Permissions tab's content, where the account has tool policies. */
  permissions?: ReactNode
  /** The sites one grant reaches, such as an Atlassian account's Jira and Confluence sites. */
  sites?: readonly { name: string; url: string }[]
}

function siteHost(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function CredentialDetail({
  credential,
  integrationName,
  providerId,
  viewer,
  onSaveDetails,
  access,
  onReconnect,
  onDisconnect,
  fields,
  onReplace,
  permissions,
  sites,
}: CredentialDetailProps) {
  const [view, setView] = useQueryStates(credentialDetailParams)
  const [saved, setSaved] = useState({
    displayName: credential.displayName,
    description: credential.description,
  })
  const [displayName, setDisplayName] = useState(saved.displayName)
  const [description, setDescription] = useState(saved.description)
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const manageable = credential.role === 'admin' && credential.scope.kind !== 'organization-managed'
  const editable = manageable && Boolean(onSaveDetails)
  const dirty = displayName !== saved.displayName || description !== saved.description
  // A rename elsewhere (another tab, a teammate) re-seeds the form unless it holds an unsaved edit.
  const [seen, setSeen] = useState({
    displayName: credential.displayName,
    description: credential.description,
  })
  if (seen.displayName !== credential.displayName || seen.description !== credential.description) {
    const latest = { displayName: credential.displayName, description: credential.description }
    setSeen(latest)
    if (!dirty && !saving) {
      setSaved(latest)
      setDisplayName(latest.displayName)
      setDescription(latest.description)
    }
  }
  function discard() {
    setDisplayName(saved.displayName)
    setDescription(saved.description)
    setError(undefined)
  }
  useSettingsUnsavedGuard({
    isDirty: editable && dirty,
    navigationBlocked: saving,
    onDiscard: discard,
  })
  return (
    <>
      <DirectoryHeading
        title={credential.displayName}
        description={credential.accountLabel ?? integrationName}
        leading={providerId ? <Icon providerId={providerId} /> : <Icon name='I137' />}
      />
      <ContentTabs
        label='Credential details'
        actions={
          manageable ? (
            <>
              {onReplace && (
                <Button variant='quiet' size='compact' onClick={onReplace}>
                  Replace value
                </Button>
              )}
              {onReconnect && (
                <Button variant='quiet' size='compact' onClick={onReconnect}>
                  Reconnect
                </Button>
              )}
              <Button variant='quiet' destructive size='compact' onClick={onDisconnect}>
                {credential.type === 'secret' ? 'Delete credential' : 'Disconnect'}
              </Button>
            </>
          ) : undefined
        }
        current={
          view.credentialTab === 'permissions' && !permissions ? 'details' : view.credentialTab
        }
        onSelect={(credentialTab) => {
          if (
            credentialTab === 'details' ||
            credentialTab === 'access' ||
            credentialTab === 'permissions'
          )
            void setView({ credentialTab })
        }}
        items={[
          {
            id: 'details',
            label: 'Details',
            content: (
              <form
                className={styles.form}
                aria-label='Credential details'
                onSubmit={async (event) => {
                  event.preventDefault()
                  if (!onSaveDetails || !editable || !displayName.trim()) return
                  const next = { displayName: displayName.trim(), description: description.trim() }
                  setSaving(true)
                  try {
                    await onSaveDetails(next)
                    setSaved(next)
                    setDisplayName(next.displayName)
                    setDescription(next.description)
                    setError(undefined)
                  } catch (error) {
                    setError(getErrorMessage(error, 'Could not save this credential.'))
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                <TextField
                  label='Credential ID'
                  placeholder='Credential ID'
                  value={credential.id}
                  viewOnly
                />
                <TextField
                  label='Display name'
                  placeholder={`${integrationName} connection`}
                  value={displayName}
                  onChange={setDisplayName}
                  maxLength={255}
                  required
                  viewOnly={!editable}
                  error={error}
                />
                <TextAreaField
                  label='Description'
                  placeholder='What will you use this connection for?'
                  value={description}
                  onChange={setDescription}
                  maxLength={500}
                  viewOnly={!editable}
                  optional
                />
                {credential.instanceUrl && (
                  <TextField
                    label={
                      credential.instanceLabel ??
                      (credential.providerId === 'microsoft-dataverse'
                        ? 'Environment URL'
                        : 'GitLab instance')
                    }
                    placeholder='Connection URL'
                    value={credential.instanceUrl}
                    viewOnly
                  />
                )}
                {sites && sites.length > 0 && (
                  <TextAreaField
                    label='Sites'
                    placeholder='Sites'
                    value={sites.map((site) => `${site.name} (${siteHost(site.url)})`).join('\n')}
                    viewOnly
                  />
                )}
                {fields}
                {credential.scope.kind === 'organization-managed' && (
                  <p className={styles.managed} data-type='T060'>
                    Managed by {credential.scope.name}
                  </p>
                )}
                {editable && dirty && (
                  <div className={styles.actions}>
                    <Button variant='quiet' size='compact' disabled={saving} onClick={discard}>
                      Cancel
                    </Button>
                    <Button size='compact' submit disabled={saving || !displayName.trim()}>
                      Save
                    </Button>
                  </div>
                )}
              </form>
            ),
          },
          {
            id: 'access',
            label: 'Access',
            content: <CredentialAccess credential={credential} viewer={viewer} access={access} />,
          },
          ...(permissions
            ? [{ id: 'permissions', label: 'Permissions', content: permissions }]
            : []),
        ]}
      />
    </>
  )
}
