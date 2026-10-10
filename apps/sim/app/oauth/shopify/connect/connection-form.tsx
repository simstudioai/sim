'use client'

import { useState } from 'react'
import { Chip, ChipInput, ChipSelect, pageHeadingClassName } from '@sim/emcn'
import { permissionSatisfies } from '@sim/platform-authz/predicates'
import { useCompleteShopifyInstall } from '@/hooks/queries/shopify-install'
import { useCreateWorkspace, useWorkspacesWithMetadata } from '@/hooks/queries/workspace'

interface ConnectionFormProps {
  attemptId: string
  shopDomain: string
}

export function ConnectionForm({ attemptId, shopDomain }: ConnectionFormProps) {
  const workspaces = useWorkspacesWithMetadata()
  const complete = useCompleteShopifyInstall()
  const createWorkspace = useCreateWorkspace()
  const [workspaceId, setWorkspaceId] = useState('')
  const [displayName, setDisplayName] = useState(shopDomain)
  const [workspaceName, setWorkspaceName] = useState('')
  const available = (workspaces.data?.workspaces ?? []).filter((workspace) =>
    permissionSatisfies(workspace.permissions, 'write')
  )
  const selectedWorkspaceId = available.some((workspace) => workspace.id === workspaceId)
    ? workspaceId
    : ''
  const error = complete.error ?? createWorkspace.error ?? workspaces.error
  const busy = complete.isPending || createWorkspace.isPending

  return (
    <form
      className='flex w-full max-w-sm flex-col gap-5'
      onSubmit={(event) => {
        event.preventDefault()
        if (busy || !selectedWorkspaceId || !displayName.trim()) return
        complete.mutate(
          { attemptId, workspaceId: selectedWorkspaceId, displayName },
          {
            onSuccess: (result) =>
              window.location.assign(
                `/workspace/${encodeURIComponent(result.workspaceId)}/integrations`
              ),
          }
        )
      }}
    >
      <h1 className={pageHeadingClassName}>Connect Shopify to Sim</h1>
      <p className='text-[var(--text-muted)] text-small'>{shopDomain}</p>
      <div className='flex flex-col gap-[9px]'>
        <label htmlFor='shopify-connection-name' className='text-[var(--text-muted)] text-small'>
          Connection name
        </label>
        <ChipInput
          id='shopify-connection-name'
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          maxLength={255}
          required
        />
      </div>
      <div className='flex flex-col gap-[9px]'>
        <span className='text-[var(--text-muted)] text-small'>Workspace</span>
        <ChipSelect
          aria-label='Workspace'
          value={selectedWorkspaceId}
          onChange={setWorkspaceId}
          options={available.map((workspace) => ({ value: workspace.id, label: workspace.name }))}
          placeholder={workspaces.isPending ? 'Loading workspaces…' : 'Choose a workspace'}
          fullWidth
          disabled={busy || workspaces.isPending}
        />
      </div>
      {available.length === 0 && workspaces.data?.creationPolicy?.canCreate && (
        <div className='flex flex-col gap-[9px]'>
          <label htmlFor='shopify-workspace-name' className='text-[var(--text-muted)] text-small'>
            New workspace name
          </label>
          <ChipInput
            id='shopify-workspace-name'
            value={workspaceName}
            onChange={(event) => setWorkspaceName(event.target.value)}
            maxLength={100}
          />
          <Chip
            type='button'
            disabled={busy || !workspaceName.trim()}
            onClick={() =>
              createWorkspace.mutate(
                { name: workspaceName.trim() },
                { onSuccess: (workspace) => setWorkspaceId(workspace.id) }
              )
            }
          >
            Create workspace
          </Chip>
        </div>
      )}
      {available.length === 0 && workspaces.data?.creationPolicy?.canCreate === false && (
        <p className='text-[var(--text-error)] text-small'>
          {workspaces.data.creationPolicy.reason ?? 'Ask your administrator for workspace access.'}
        </p>
      )}
      {error && (
        <p role='alert' className='text-[var(--text-error)] text-small'>
          {error.message}
        </p>
      )}
      <Chip
        type='submit'
        variant='primary'
        disabled={busy || !selectedWorkspaceId || !displayName.trim()}
      >
        {complete.isPending ? 'Connecting…' : 'Connect Shopify'}
      </Chip>
    </form>
  )
}
