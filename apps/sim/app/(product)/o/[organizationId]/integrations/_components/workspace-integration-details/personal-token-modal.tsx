'use client'

import { useState } from 'react'
import { TextField } from '@sim/emcn/field'
import { SecretField } from '@sim/emcn/field/value-fields'
import { Modal } from '@sim/emcn/modal'
import {
  useCreateWorkspaceCredential,
  useUpdateWorkspaceCredential,
} from '@/platform/lib/data/credentials'

const TOKEN_GUIDE_URL = 'https://docs.gitlab.com/user/profile/personal_access_tokens/'

interface PersonalTokenModalProps {
  workspaceId: string
  /** The token connection to replace, which keeps its GitLab host; absent to connect a new one. */
  replacing?: { credentialId: string; instanceUrl?: string }
  onClose: () => void
}

/**
 * Connects the viewer's own GitLab account from a personal access token, or replaces the token of
 * one already connected. Only its owner can use it.
 */
export function PersonalTokenModal({ workspaceId, replacing, onClose }: PersonalTokenModalProps) {
  const [host, setHost] = useState(
    replacing?.instanceUrl ? new URL(replacing.instanceUrl).host : 'gitlab.com'
  )
  const [token, setToken] = useState('')
  const create = useCreateWorkspaceCredential()
  const update = useUpdateWorkspaceCredential(workspaceId)

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title='Connect your GitLab account'
      confirmLabel={replacing ? 'Reconnect' : 'Connect'}
      confirmDisabled={!host.trim() || !token.trim()}
      onConfirm={async () => {
        if (replacing) {
          await update.mutateAsync({ credentialId: replacing.credentialId, apiToken: token.trim() })
          return
        }
        await create.mutateAsync({
          workspaceId,
          type: 'personal_token',
          providerId: 'gitlab',
          apiToken: token.trim(),
          domain: host.trim(),
        })
      }}
      footerStartAction={{
        label: 'Create a token',
        variant: 'quiet',
        onClick: () => window.open(TOKEN_GUIDE_URL, '_blank', 'noopener,noreferrer'),
      }}
    >
      {(!replacing || replacing.instanceUrl) && (
        <TextField
          label='GitLab host'
          placeholder='gitlab.example.com'
          value={host}
          onChange={setHost}
          autoComplete='off'
          required
          viewOnly={Boolean(replacing)}
        />
      )}
      <SecretField
        label='Personal access token'
        placeholder='glpat-…'
        value={token}
        onChange={setToken}
        name='gitlab_personal_access_token'
        autoComplete='new-password'
        required
      />
    </Modal>
  )
}
