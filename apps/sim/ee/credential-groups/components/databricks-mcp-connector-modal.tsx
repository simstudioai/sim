'use client'

import { useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  toast,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { DatabricksIcon } from '@/components/icons'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import {
  useAddOrganizationAccountMcpProvider,
  useConfigureOrganizationMcp,
  useOrganizationDatabricksSetup,
} from '@/hooks/queries/organization-accounts'

interface DatabricksMcpConnectorModalProps {
  organizationId: string
  onOpenChange: (open: boolean) => void
  open: boolean
  existingServer?: NonNullable<
    OrganizationAccountsSettings['credentialGroup']
  >['mcpServers'][number]
}

export function DatabricksMcpConnectorModal({
  organizationId,
  onOpenChange,
  open,
  existingServer,
}: DatabricksMcpConnectorModalProps) {
  const setup = useOrganizationDatabricksSetup(organizationId, open && Boolean(existingServer))
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
  const title = adding ? 'Add Databricks' : 'Configure Databricks'

  const handleOpenChange = (nextOpen: boolean) => {
    if (pending && !nextOpen) return
    onOpenChange(nextOpen)
  }

  const handleSubmit = async () => {
    if (!canSave || pending) return
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
      onOpenChange(false)
    } catch (submitError) {
      toast.error(getErrorMessage(submitError, 'Could not save Databricks'))
    }
  }

  return (
    <ChipModal
      open={open}
      onOpenChange={handleOpenChange}
      dismissDisabled={pending}
      srTitle={title}
      size='md'
    >
      <ChipModalHeader
        icon={DatabricksIcon}
        onClose={() => handleOpenChange(false)}
        closeDisabled={pending}
      >
        {title}
      </ChipModalHeader>
      <ChipModalBody>
        {existingServer && setup.isPending && (
          <p role='status' className='px-2 text-[var(--text-muted)] text-caption'>
            Loading Databricks configuration...
          </p>
        )}
        {fieldsAvailable && (
          <>
            <ChipModalField
              type='input'
              title='Name'
              value={name}
              onChange={setNameInput}
              disabled={pending}
              maxLength={100}
              required
            />
            <ChipModalField
              type='input'
              title='MCP URL'
              value={url}
              onChange={setUrlInput}
              placeholder='https://workspace.cloud.databricks.com/api/2.0/mcp/...'
              disabled={pending}
              maxLength={2048}
              required
            />
            <ChipModalField
              type='input'
              title='OAuth Client ID'
              value={clientId}
              onChange={setClientIdInput}
              autoComplete='off'
              disabled={pending}
              maxLength={512}
              required
            />
            <ChipModalField
              type='input'
              inputType='password'
              title='OAuth Client Secret'
              value={clientSecret}
              onChange={setClientSecret}
              placeholder={
                server?.hasOauthClientSecret ? 'Leave blank to keep the current secret' : 'Optional'
              }
              autoComplete='new-password'
              disabled={pending}
              maxLength={2048}
            />
            {server?.enabled && (
              <p className='px-2 text-[var(--text-muted)] text-caption'>
                Changing the URL or OAuth client requires people to reconnect their Databricks
                accounts.
              </p>
            )}
          </>
        )}
        <ChipModalError>{error ? getErrorMessage(error) : null}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => handleOpenChange(false)}
        cancelDisabled={pending}
        primaryAction={{
          label: pending ? (adding ? 'Adding...' : 'Saving...') : adding ? 'Add' : 'Save',
          onClick: () => void handleSubmit(),
          disabled: pending || !canSave,
        }}
      />
    </ChipModal>
  )
}
