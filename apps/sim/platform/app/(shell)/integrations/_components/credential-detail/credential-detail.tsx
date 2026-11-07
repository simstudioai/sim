'use client'

import { type ReactNode, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { TextAreaField, TextField } from '@sim/emcn/field'
import { Icon } from '@sim/emcn/icon'
import { ContentTabs } from '@sim/emcn/tabs/content-tabs'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryStates } from 'nuqs'
import { DirectoryHeading } from '@/platform/app/(shell)/_components/resource-directory/resource-directory'
import { CredentialAccess } from '@/platform/app/(shell)/integrations/_components/credential-access/credential-access'
import styles from '@/platform/app/(shell)/integrations/_components/credential-detail/credential-detail.module.css'
import { ToolPermissions } from '@/platform/app/(shell)/integrations/_components/fixtures/tool-permissions/tool-permissions'
import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'
import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'
import { credentialDetailParams } from '@/platform/lib/integrations/credential-navigation'

interface CredentialDetailProps {
  credential: IntegrationCredential
  integrationName: string
  providerId?: string
  viewer: IntegrationPerson
  people: readonly IntegrationPerson[]
  onChange: (credential: IntegrationCredential) => void
  onReconnect?: () => void
  onDisconnect: () => void
  onLeave: () => void
  fields?: ReactNode
  onReplace?: () => void
}

export function CredentialDetail({
  credential,
  integrationName,
  providerId,
  viewer,
  people,
  onChange,
  onReconnect,
  onDisconnect,
  onLeave,
  fields,
  onReplace,
}: CredentialDetailProps) {
  const [view, setView] = useQueryStates(credentialDetailParams)
  const [displayName, setDisplayName] = useState(credential.displayName)
  const [description, setDescription] = useState(credential.description)
  const [error, setError] = useState<string>()
  const editable = credential.role === 'admin' && credential.scope.kind !== 'organization-managed'
  const dirty = displayName !== credential.displayName || description !== credential.description
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
          editable ? (
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
          view.credentialTab === 'permissions' && !credential.permissions
            ? 'details'
            : view.credentialTab
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
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!editable || !displayName.trim()) return
                  try {
                    const name = displayName.trim()
                    const detail = description.trim()
                    onChange({ ...credential, displayName: name, description: detail })
                    setDisplayName(name)
                    setDescription(detail)
                    setError(undefined)
                  } catch (error) {
                    setError(getErrorMessage(error, 'Could not save this credential.'))
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
                      credential.providerId === 'microsoft-dataverse'
                        ? 'Environment URL'
                        : 'GitLab instance'
                    }
                    placeholder='Connection URL'
                    value={credential.instanceUrl}
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
                    <Button
                      variant='quiet'
                      size='compact'
                      onClick={() => {
                        setDisplayName(credential.displayName)
                        setDescription(credential.description)
                        setError(undefined)
                      }}
                    >
                      Cancel
                    </Button>
                    <Button size='compact' submit disabled={!displayName.trim()}>
                      Save changes
                    </Button>
                  </div>
                )}
              </form>
            ),
          },
          {
            id: 'access',
            label: 'Access',
            content: (
              <CredentialAccess
                credential={credential}
                viewer={viewer}
                people={people}
                onChange={onChange}
                onLeave={onLeave}
              />
            ),
          },
          ...(credential.permissions
            ? [
                {
                  id: 'permissions',
                  label: 'Permissions',
                  content: (
                    <ToolPermissions
                      account={credential}
                      permissions={credential.permissions}
                      readOnly={!editable}
                      onChange={(permissions) => onChange({ ...credential, permissions })}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
    </>
  )
}
