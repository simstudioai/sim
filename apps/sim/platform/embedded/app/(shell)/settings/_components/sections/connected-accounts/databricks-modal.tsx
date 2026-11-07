'use client'

import { useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import {
  useAddOrganizationAccountMcpProvider,
  useConfigureOrganizationMcp,
  useOrganizationDatabricksSetup,
} from '@/hooks/queries/organization-accounts'
import {
  InlineNotice,
  LoadingRows,
  Modal,
  SecretField,
  TextField,
} from '@/platform/design-system/components'
import { Muted } from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import { toast } from '@/platform/shared/toast'

interface DatabricksModalProps {
  organizationId: string
  onClose: () => void
  existingServer?: NonNullable<
    OrganizationAccountsSettings['credentialGroup']
  >['mcpServers'][number]
}

/** The stored client secret is never returned: only whether one exists. */
export function DatabricksModal({ organizationId, onClose, existingServer }: DatabricksModalProps) {
  const setup = useOrganizationDatabricksSetup(organizationId, Boolean(existingServer))
  const add = useAddOrganizationAccountMcpProvider()
  const configure = useConfigureOrganizationMcp()
  const [nameInput, setNameInput] = useState<string | null>(null)
  const [urlInput, setUrlInput] = useState<string | null>(null)
  const [clientIdInput, setClientIdInput] = useState<string | null>(null)
  const [clientSecret, setClientSecret] = useState('')
  const server = existingServer ? setup.data?.server : undefined
  const adding = !existingServer?.enabled
  const name = nameInput ?? server?.name ?? 'Databricks'
  const url = urlInput ?? server?.url ?? ''
  const clientId = clientIdInput ?? server?.oauthClientId ?? ''
  const pending = configure.isPending || add.isPending
  const setupError = existingServer ? setup.error : null
  const error = add.error ?? configure.error ?? setupError
  const fieldsAvailable = !existingServer || Boolean(server && !setupError)
  const canSave = fieldsAvailable && Boolean(name.trim() && url.trim() && clientId.trim())

  async function submit() {
    if (!canSave || pending) return false
    try {
      const configuration = {
        organizationId,
        name: name.trim(),
        url: url.trim(),
        oauthClientId: clientId.trim(),
        ...(clientSecret.trim() ? { oauthClientSecret: clientSecret.trim() } : {}),
      }
      if (existingServer) await configure.mutateAsync(configuration)
      else await add.mutateAsync({ ...configuration, connectorId: 'databricks' })
      toast.success(adding ? 'Databricks added' : 'Databricks configuration saved')
    } catch (failure) {
      toast.error(getErrorMessage(failure, 'Could not save Databricks'))
      return false
    }
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
      {existingServer && setup.isPending && (
        <LoadingRows label='Loading Databricks configuration…' rows={2} />
      )}
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
      {error && (
        <InlineNotice
          intent='danger'
          message={getErrorMessage(error, 'Could not save Databricks')}
        />
      )}
    </Modal>
  )
}
