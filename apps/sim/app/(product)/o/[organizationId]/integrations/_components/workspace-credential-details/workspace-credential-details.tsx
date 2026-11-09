'use client'

import { type ReactNode, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { TextAreaField, TextField } from '@sim/emcn/field'
import { ContentTabs } from '@sim/emcn/tabs/content-tabs'
import { useQueryStates } from 'nuqs'
import {
  AddPeopleModal,
  CredentialMembers,
} from '@/app/(product)/_components/credential-members/credential-members'
import styles from '@/app/(product)/o/[organizationId]/integrations/_components/workspace-credential-details/workspace-credential-details.module.css'
import { useCredentialDetailForm, useWorkspaceCredential } from '@/platform/lib/data/credentials'
import { resourceDetailParams } from '@/platform/lib/integrations/center-navigation'

interface WorkspaceCredentialDetailsProps {
  workspaceId: string
  credentialId: string
  appName: string
  /** Reconnect and Disconnect, which the app page owns; shown to the credential's admins. */
  actions: ReactNode
  /** Leaving revokes the viewer's access, so the page returns to the app. */
  onLeft: () => void
}

/**
 * One workspace credential, as legacy's connected credential page served it: its ID, a display name
 * and description its admins rename and describe, and, except for an owner-only personal token,
 * the members who can use it, shared with more of the workspace through Share.
 */
export function WorkspaceCredentialDetails({
  workspaceId,
  credentialId,
  appName,
  actions,
  onLeft,
}: WorkspaceCredentialDetailsProps) {
  const { data: credential = null } = useWorkspaceCredential(credentialId)
  const [view, setView] = useQueryStates(resourceDetailParams)
  const [sharing, setSharing] = useState(false)
  const isAdmin = credential?.role === 'admin'
  const form = useCredentialDetailForm({ credential, isAdmin })
  if (!credential) return null
  const shareable = credential.type !== 'personal_token'

  const details = (
    <form
      className={styles.form}
      aria-label='Credential details'
      onSubmit={(event) => {
        event.preventDefault()
        if (form.displayNameDraft.trim()) void form.save()
      }}
    >
      <TextField label='Credential ID' placeholder='Credential ID' value={credential.id} viewOnly />
      <TextField
        label='Display name'
        placeholder={`${appName} connection`}
        value={form.displayNameDraft}
        onChange={form.setDisplayNameDraft}
        maxLength={255}
        required
        viewOnly={!isAdmin}
      />
      <TextAreaField
        label='Description'
        placeholder='What will you use this connection for?'
        value={form.descriptionDraft}
        onChange={form.setDescriptionDraft}
        maxLength={500}
        viewOnly={!isAdmin}
        optional
      />
      {credential.instanceUrl && (
        <TextField
          label={
            credential.providerId === 'microsoft-dataverse' ? 'Environment URL' : 'GitLab instance'
          }
          placeholder='Connection URL'
          value={credential.instanceUrl}
          viewOnly
        />
      )}
      {isAdmin && form.isDirty && (
        <div className={styles.actions}>
          <Button variant='quiet' size='compact' disabled={form.isSaving} onClick={form.discard}>
            Cancel
          </Button>
          <Button size='compact' submit disabled={form.isSaving || !form.displayNameDraft.trim()}>
            {form.isSaving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      )}
    </form>
  )

  return (
    <>
      <ContentTabs
        label='Credential details'
        actions={
          isAdmin ? (
            <>
              {shareable && (
                <Button variant='quiet' size='compact' onClick={() => setSharing(true)}>
                  Share
                </Button>
              )}
              {actions}
            </>
          ) : undefined
        }
        current={shareable ? view.resourceTab : 'details'}
        onSelect={(resourceTab) => {
          if (resourceTab === 'details' || resourceTab === 'access') void setView({ resourceTab })
        }}
        items={[
          { id: 'details', label: 'Details', content: details },
          ...(shareable
            ? [
                {
                  id: 'access',
                  label: 'Access',
                  content: (
                    <CredentialMembers
                      credentialId={credential.id}
                      credentialName={credential.displayName}
                      isAdmin={isAdmin}
                      onLeft={onLeft}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
      {shareable && (
        <AddPeopleModal
          workspaceId={workspaceId}
          credentialId={credential.id}
          open={sharing}
          onOpenChange={setSharing}
        />
      )}
    </>
  )
}
