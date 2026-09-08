'use client'

import { useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  SecretInput,
} from '@sim/emcn'
import { GitlabIcon } from '@/components/icons'
import {
  useCreateWorkspaceCredential,
  useUpdateWorkspaceCredential,
} from '@/hooks/queries/credentials'

interface ConnectPersonalTokenModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  credentialId?: string
  instanceUrl?: string
  onConnected?: () => void
}

/** Personal connections use the existing credential modal and mutation conventions. */
export function ConnectPersonalTokenModal(props: ConnectPersonalTokenModalProps) {
  if (!props.open) return null
  return (
    <PersonalTokenForm key={`${props.workspaceId}:${props.credentialId ?? 'new'}`} {...props} />
  )
}

function PersonalTokenForm({
  open,
  onOpenChange,
  workspaceId,
  credentialId,
  instanceUrl,
  onConnected,
}: ConnectPersonalTokenModalProps) {
  const [host, setHost] = useState(instanceUrl ? new URL(instanceUrl).host : 'gitlab.com')
  const [token, setToken] = useState('')
  const create = useCreateWorkspaceCredential()
  const update = useUpdateWorkspaceCredential(workspaceId)
  const pending = create.isPending || update.isPending
  const error = (credentialId ? update.error : create.error)?.message
  function submit() {
    if (!host.trim() || !token.trim() || pending) return
    const onSuccess = () => {
      onConnected?.()
      onOpenChange(false)
    }
    if (credentialId) update.mutate({ credentialId, apiToken: token.trim() }, { onSuccess })
    else
      create.mutate(
        {
          workspaceId,
          type: 'personal_token',
          providerId: 'gitlab',
          apiToken: token.trim(),
          domain: host.trim(),
        },
        { onSuccess }
      )
  }
  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Connect your GitLab account'>
      <ChipModalHeader icon={GitlabIcon} onClose={() => onOpenChange(false)}>
        Connect your GitLab account
      </ChipModalHeader>
      <ChipModalBody>
        {credentialId ? (
          <ChipModalField type='copy' title='GitLab host' value={host} />
        ) : (
          <ChipModalField
            type='input'
            title='GitLab host'
            value={host}
            onChange={setHost}
            placeholder='gitlab.example.com'
            required
          />
        )}
        <ChipModalField
          type='custom'
          title='Personal access token'
          required
          hint='Only you can use this connection.'
        >
          <SecretInput
            value={token}
            onChange={setToken}
            autoComplete='new-password'
            placeholder='glpat-…'
          />
        </ChipModalField>
        <ChipModalError>{error}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        primaryAction={{
          label: pending ? 'Connecting…' : credentialId ? 'Reconnect' : 'Connect',
          onClick: submit,
          disabled: pending || !host.trim() || !token.trim(),
        }}
        secondaryActions={[
          {
            label: 'Create a token',
            onClick: () =>
              window.open(
                'https://docs.gitlab.com/user/profile/personal_access_tokens/',
                '_blank',
                'noopener,noreferrer'
              ),
          },
        ]}
      />
    </ChipModal>
  )
}
