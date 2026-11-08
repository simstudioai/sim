'use client'

import { useState } from 'react'
import { TextField } from '@sim/emcn/field'
import { SecretField } from '@sim/emcn/field/value-fields'
import { Modal } from '@sim/emcn/modal'
import { InlineNotice } from '@sim/emcn/status'
import { LoadingRows } from '@sim/emcn/status/query-boundary'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import { Muted } from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import { useDatabricksConfiguration } from '@/platform/embedded/lib/data/integrations'

interface DatabricksModalProps {
  organizationId: string
  onClose: () => void
  existingServer?: NonNullable<
    OrganizationAccountsSettings['credentialGroup']
  >['mcpServers'][number]
}

export function DatabricksModal({ organizationId, onClose, existingServer }: DatabricksModalProps) {
  const { adding, server, loading, fieldsAvailable, pending, error, save } =
    useDatabricksConfiguration(organizationId, existingServer)
  const [nameInput, setNameInput] = useState<string | null>(null)
  const [urlInput, setUrlInput] = useState<string | null>(null)
  const [clientIdInput, setClientIdInput] = useState<string | null>(null)
  const [clientSecret, setClientSecret] = useState('')
  const name = nameInput ?? server?.name ?? 'Databricks'
  const url = urlInput ?? server?.url ?? ''
  const clientId = clientIdInput ?? server?.oauthClientId ?? ''
  const canSave = fieldsAvailable && Boolean(name.trim() && url.trim() && clientId.trim())

  async function submit() {
    if (!canSave || pending) return false
    return save({
      name: name.trim(),
      url: url.trim(),
      oauthClientId: clientId.trim(),
      ...(clientSecret.trim() ? { oauthClientSecret: clientSecret.trim() } : {}),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={adding ? 'Add Databricks' : 'Configure Databricks'}
      confirmLabel={pending ? (adding ? 'Adding…' : 'Saving…') : adding ? 'Add' : 'Save'}
      confirmDisabled={pending || !canSave}
      onConfirm={submit}
    >
      {loading && <LoadingRows label='Loading Databricks configuration…' rows={2} />}
      {fieldsAvailable && (
        <>
          <TextField
            label='Name'
            placeholder='Name'
            value={name}
            onChange={setNameInput}
            disabled={pending}
            maxLength={100}
            required
          />
          <TextField
            label='MCP URL'
            value={url}
            onChange={setUrlInput}
            placeholder='https://workspace.cloud.databricks.com/api/2.0/mcp/...'
            disabled={pending}
            maxLength={2048}
            required
          />
          <TextField
            label='OAuth Client ID'
            placeholder='Enter the OAuth client ID'
            value={clientId}
            onChange={setClientIdInput}
            autoComplete='off'
            disabled={pending}
            maxLength={512}
            required
          />
          <SecretField
            label='OAuth Client Secret'
            value={clientSecret}
            onChange={setClientSecret}
            placeholder={
              server?.hasOauthClientSecret ? 'Leave blank to keep the current secret' : 'Optional'
            }
            autoComplete='new-password'
            disabled={pending}
          />
          {server?.enabled && (
            <Muted>
              Changing the URL or OAuth client requires people to reconnect their Databricks
              accounts.
            </Muted>
          )}
        </>
      )}
      {error && <InlineNotice intent='danger' message={error} />}
    </Modal>
  )
}
