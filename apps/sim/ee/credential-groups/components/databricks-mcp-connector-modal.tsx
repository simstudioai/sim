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
import type { McpServer } from '@/lib/api/contracts/mcp'
import {
  useCreateCredentialGroupMcpConnector,
  useUpdateCredentialGroupMcpConnector,
} from '@/hooks/queries/credential-groups'

interface DatabricksMcpConnectorModalProps {
  credentialGroupId: string
  onOpenChange: (open: boolean) => void
  open: boolean
  server?: McpServer
  workspaceId: string
}

export function DatabricksMcpConnectorModal({
  credentialGroupId,
  onOpenChange,
  open,
  server,
  workspaceId,
}: DatabricksMcpConnectorModalProps) {
  const createConnector = useCreateCredentialGroupMcpConnector()
  const updateConnector = useUpdateCredentialGroupMcpConnector()
  const [nameInput, setNameInput] = useState<string | null>(null)
  const [urlInput, setUrlInput] = useState<string | null>(null)
  const [clientIdInput, setClientIdInput] = useState<string | null>(null)
  const [clientSecret, setClientSecret] = useState('')
  const name = nameInput ?? server?.name ?? 'Databricks'
  const url = urlInput ?? server?.url ?? ''
  const clientId = clientIdInput ?? server?.oauthClientId ?? ''
  const pending = createConnector.isPending || updateConnector.isPending
  const error = createConnector.error ?? updateConnector.error

  const reset = () => {
    setNameInput(null)
    setUrlInput(null)
    setClientIdInput(null)
    setClientSecret('')
    createConnector.reset()
    updateConnector.reset()
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (pending && !nextOpen) return
    onOpenChange(nextOpen)
    if (!nextOpen) reset()
  }

  const handleSubmit = async () => {
    if (!name.trim() || !url.trim() || !clientId.trim() || pending) return
    try {
      if (server) {
        await updateConnector.mutateAsync({
          workspaceId,
          groupId: credentialGroupId,
          connectorId: 'databricks',
          body: {
            name: name.trim(),
            url: url.trim(),
            oauthClientId: clientId.trim(),
            ...(clientSecret.trim() ? { oauthClientSecret: clientSecret.trim() } : {}),
          },
        })
      } else {
        await createConnector.mutateAsync({
          workspaceId,
          groupId: credentialGroupId,
          body: {
            connectorId: 'databricks',
            name: name.trim(),
            url: url.trim(),
            oauthClientId: clientId.trim(),
            ...(clientSecret.trim() ? { oauthClientSecret: clientSecret.trim() } : {}),
          },
        })
      }
      toast.success(server ? 'Databricks updated' : 'Databricks added')
      handleOpenChange(false)
    } catch (submitError) {
      toast.error(getErrorMessage(submitError, 'Could not save Databricks'))
    }
  }

  return (
    <ChipModal
      open={open}
      onOpenChange={handleOpenChange}
      dismissDisabled={pending}
      srTitle={server ? 'Edit Databricks MCP' : 'Add Databricks MCP'}
      size='md'
    >
      <ChipModalHeader
        icon={DatabricksIcon}
        onClose={() => handleOpenChange(false)}
        closeDisabled={pending}
      >
        {server ? 'Edit Databricks MCP' : 'Add Databricks MCP'}
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='input'
          title='Name'
          value={name}
          onChange={setNameInput}
          disabled={pending}
          required
        />
        <ChipModalField
          type='input'
          title='MCP URL'
          value={url}
          onChange={setUrlInput}
          placeholder='https://workspace.cloud.databricks.com/api/2.0/mcp/...'
          disabled={pending}
          required
        />
        <ChipModalField
          type='input'
          title='OAuth Client ID'
          value={clientId}
          onChange={setClientIdInput}
          autoComplete='off'
          disabled={pending}
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
        />
        <ChipModalError>{error ? getErrorMessage(error) : null}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => handleOpenChange(false)}
        cancelDisabled={pending}
        primaryAction={{
          label: pending ? 'Saving...' : 'Save',
          onClick: () => void handleSubmit(),
          disabled: pending || !name.trim() || !url.trim() || !clientId.trim(),
        }}
      />
    </ChipModal>
  )
}
