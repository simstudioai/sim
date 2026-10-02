'use client'

import { useState } from 'react'
import { Chip, toast } from '@sim/emcn'
import { SecretValueField } from '@/app/workspace/[workspaceId]/settings/components/secrets/components/secret-value-field/secret-value-field'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'
import { useUpsertWorkspaceEnvironment, useWorkspaceEnvironment } from '@/hooks/queries/environment'
import { useWorkspacePermissionsQuery } from '@/hooks/queries/workspace'

interface EnvironmentSecretPeekProps {
  workspaceId: string
  environmentName: string
  secretKey: string
}

/** Shares the workspace settings field's reveal behavior and per-secret edit permissions. */
export function EnvironmentSecretPeek({
  workspaceId,
  environmentName,
  secretKey,
}: EnvironmentSecretPeekProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const permissions = useWorkspacePermissionsQuery(workspaceId)
  const credentials = useWorkspaceCredentials({
    workspaceId,
    type: 'env_workspace',
    enabled: Boolean(workspaceId),
  })
  const credential = credentials.data?.find((item) => item.envKey === secretKey)
  const canEdit = credential?.role === 'admin'
  const canReveal = Boolean(permissions.data?.viewer?.isAdmin || canEdit || credential?.unredacted)
  const environment = useWorkspaceEnvironment(workspaceId, { enabled: canReveal })
  const save = useUpsertWorkspaceEnvironment()
  const storedValue = environment.data?.workspace[secretKey]
  const value = draft ?? storedValue ?? ''
  const changed = draft !== null && draft !== storedValue

  return (
    <form
      className='flex min-w-0 flex-1 flex-col gap-2'
      onSubmit={(event) => {
        event.preventDefault()
        if (!canEdit || !changed || save.isPending || storedValue === undefined) return
        save.mutate(
          { workspaceId, variables: { [secretKey]: value } },
          {
            onSuccess: () => {
              setDraft(null)
              toast.success('Secret saved')
            },
          }
        )
      }}
    >
      <span className='text-[var(--text-muted)] text-caption'>{environmentName}</span>
      <SecretValueField
        value={value}
        canEdit={canEdit && storedValue !== undefined}
        canReveal={canReveal && storedValue !== undefined}
        onChange={setDraft}
        aria-label={`${secretKey} value in ${environmentName}`}
        disabled={environment.isLoading || save.isPending}
      />
      {environment.isError && (
        <p role='alert' className='text-[var(--text-error)] text-caption'>
          Could not load this secret.
        </p>
      )}
      {canReveal && environment.isSuccess && storedValue === undefined && (
        <p className='text-[var(--text-muted)] text-caption'>Not available in this environment.</p>
      )}
      {save.error && (
        <p role='alert' className='text-[var(--text-error)] text-caption'>
          {save.error.message}
        </p>
      )}
      {changed && canEdit && (
        <div className='flex gap-2'>
          <Chip type='submit' variant='primary' disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Chip>
          <Chip
            type='button'
            disabled={save.isPending}
            onClick={() => {
              setDraft(null)
              save.reset()
            }}
          >
            Discard
          </Chip>
        </div>
      )}
    </form>
  )
}
