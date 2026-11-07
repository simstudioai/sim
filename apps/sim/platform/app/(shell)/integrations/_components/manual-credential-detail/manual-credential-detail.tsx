'use client'

import { useState } from 'react'
import { TextField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { CredentialDetail } from '@/platform/app/(shell)/integrations/_components/credential-detail/credential-detail'
import { ManualSecretFields } from '@/platform/app/(shell)/integrations/_components/manual-secret-fields/manual-secret-fields'
import type {
  IntegrationCenterData,
  IntegrationResource,
} from '@/platform/lib/integrations/center-model'
import { validCredentialMembers } from '@/platform/lib/integrations/credential-access'
import { credentialSharing } from '@/platform/lib/integrations/credential-display'
import {
  MANUAL_SECRET_TYPES,
  type ManualCredential,
  manualCredentialAccess,
  validateManualSecret,
} from '@/platform/lib/integrations/manual-secret'

interface ManualCredentialDetailProps {
  resource: ManualCredential
  data: IntegrationCenterData
  appName?: string
  onSave: (resource: IntegrationResource) => void
  onRemove: () => void
  onLeave: () => void
}

export function ManualCredentialDetail({
  resource,
  data,
  appName,
  onSave,
  onRemove,
  onLeave,
}: ManualCredentialDetailProps) {
  const [action, setAction] = useState<'replace' | 'delete' | null>(null)
  const credential = manualCredentialAccess(resource, data)
  return (
    <>
      <CredentialDetail
        credential={credential}
        integrationName={appName ?? 'Credential'}
        providerId={resource.appId}
        viewer={data.viewer}
        people={data.people}
        onChange={(next) => {
          if (!resource.canEdit || !validCredentialMembers(credential, next.members)) return
          onSave({
            ...resource,
            name: next.displayName,
            description: next.description,
            members: next.members,
            scope: credentialSharing(next),
            people: next.members.filter((member) => member.status !== 'revoked'),
            canEdit: next.role === 'admin',
          })
        }}
        onDisconnect={() => setAction('delete')}
        onReplace={() => setAction('replace')}
        onLeave={onLeave}
        fields={
          <>
            <TextField label='Key' placeholder='Credential key' value={resource.key} viewOnly />
            <TextField
              label='Type'
              placeholder='Credential type'
              value={
                MANUAL_SECRET_TYPES.find((type) => type.value === resource.credentialType)?.label ??
                'Secret'
              }
              viewOnly
            />
          </>
        }
      />
      {action === 'replace' && (
        <Modal
          open
          title={`Replace ${resource.name}`}
          confirmLabel='Save value'
          onOpenChange={(open) => {
            if (!open) setAction(null)
          }}
          onConfirm={(values) => {
            validateManualSecret(resource.credentialType, values)
            setAction(null)
          }}
        >
          <ManualSecretFields type={resource.credentialType} replacing />
        </Modal>
      )}
      {action === 'delete' && (
        <Modal
          open
          title={`Delete ${resource.name}?`}
          description='People and workflows using this credential will lose access.'
          confirmLabel='Delete'
          destructive
          variant='confirm'
          onOpenChange={(open) => {
            if (!open) setAction(null)
          }}
          onConfirm={onRemove}
        />
      )}
    </>
  )
}
