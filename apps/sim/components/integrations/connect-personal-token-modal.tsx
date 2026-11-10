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
} from '@sim/emcn-legacy'
import { GitlabIcon } from '@/components/icons'
import { useCreateWorkspaceCredential } from '@/hooks/queries/credentials'

interface ConnectPersonalTokenModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  onConnected: () => void
}

/** Personal connections use the existing credential modal and mutation conventions. */
export function ConnectPersonalTokenModal(props: ConnectPersonalTokenModalProps) {
  if (!props.open) return null
  return <PersonalTokenForm key={props.workspaceId} {...props} />
}

function PersonalTokenForm({
  open,
  onOpenChange,
  workspaceId,
  onConnected,
}: ConnectPersonalTokenModalProps) {
  const [host, setHost] = useState('gitlab.com')
  const [token, setToken] = useState('')
  const create = useCreateWorkspaceCredential()
  const pending = create.isPending
  function submit() {
    if (!host.trim() || !token.trim() || pending) return
    create.mutate(
      {
        workspaceId,
        type: 'personal_token',
        providerId: 'gitlab',
        apiToken: token.trim(),
        domain: host.trim(),
      },
      {
        onSuccess: () => {
          onConnected()
          onOpenChange(false)
        },
      }
    )
  }
  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Connect your GitLab account'>
      <ChipModalHeader icon={GitlabIcon} onClose={() => onOpenChange(false)}>
        Connect your GitLab account
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='input'
          title='GitLab host'
          value={host}
          onChange={setHost}
          placeholder='gitlab.example.com'
          required
        />
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
        <ChipModalError>{create.error?.message}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        primaryAction={{
          label: pending ? 'Connecting…' : 'Connect',
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
