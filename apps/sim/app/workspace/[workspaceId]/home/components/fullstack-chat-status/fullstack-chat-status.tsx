'use client'

import { useEffect, useState } from 'react'
import { Button } from '@sim/emcn'
import { Loader } from '@sim/emcn/icons'
import { useFullstackLifecycleState } from '@/app/workspace/[workspaceId]/home/hooks/fullstack-lifecycle-store'

export function FullstackChatStatus({
  isSending,
  onContinueCredentials,
}: {
  isSending: boolean
  onContinueCredentials: (params: {
    projectId: string
    chatId: string
    credentialSelections: Record<string, string>
  }) => void
}) {
  const lifecycle = useFullstackLifecycleState()
  const [choices, setChoices] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!lifecycle.credentialSelection) return
    setChoices(
      Object.fromEntries(
        lifecycle.credentialSelection.selections.flatMap((selection) =>
          selection.choices[0] ? [[selection.bindingKey, selection.choices[0].id]] : []
        )
      )
    )
  }, [lifecycle.credentialSelection])

  if (lifecycle.credentialSelection) {
    return (
      <div className='mx-auto mb-3 w-full max-w-[48rem] rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3'>
        <p className='font-medium text-[var(--text-primary)] text-sm'>Select connected accounts</p>
        <div className='mt-3 space-y-2'>
          {lifecycle.credentialSelection.selections.map((selection) => (
            <label key={selection.bindingKey} className='block text-xs'>
              <span className='mb-1 block font-medium text-[var(--text-primary)]'>
                {selection.serviceId}
              </span>
              <select
                className='w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-sm'
                value={choices[selection.bindingKey] || ''}
                onChange={(event) =>
                  setChoices((current) => ({
                    ...current,
                    [selection.bindingKey]: event.target.value,
                  }))
                }
              >
                {selection.choices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.displayName}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <Button
          type='button'
          className='mt-3'
          disabled={isSending || !lifecycle.credentialSelection.chatId}
          onClick={() => {
            const selection = lifecycle.credentialSelection
            if (!selection?.chatId) return
            onContinueCredentials({
              projectId: selection.projectId,
              chatId: selection.chatId,
              credentialSelections: choices,
            })
          }}
        >
          Continue with selected accounts
        </Button>
      </div>
    )
  }

  if (lifecycle.deployStatus === 'deploying') {
    return (
      <div className='mx-auto mb-3 flex w-full max-w-[48rem] items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3 text-[var(--text-secondary)] text-sm'>
        <Loader animate className='size-4' />
        Deploying workflows and publishing the App…
      </div>
    )
  }

  if (lifecycle.deployStatus === 'deployed') {
    return (
      <div className='mx-auto mb-3 w-full max-w-[48rem] rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3 text-[var(--text-secondary)] text-sm'>
        App deployed and published.
      </div>
    )
  }

  if (lifecycle.deployStatus === 'failed') {
    return (
      <div
        className='mx-auto mb-3 w-full max-w-[48rem] rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3 text-[var(--text-error)] text-sm'
        role='alert'
      >
        {lifecycle.deployError || 'Deploy failed.'}
      </div>
    )
  }

  if (
    isSending &&
    (lifecycle.phase === 'building_backend' ||
      lifecycle.phase === 'generating_interface' ||
      lifecycle.phase === 'building_app' ||
      lifecycle.phase === 'updating')
  ) {
    const label =
      lifecycle.phase === 'building_backend'
        ? 'Building backend workflows'
        : lifecycle.phase === 'generating_interface'
          ? 'Designing the interface'
          : lifecycle.phase === 'building_app'
            ? 'Building the live preview'
            : 'Updating the app'
    return (
      <div className='mx-auto mb-3 flex w-full max-w-[48rem] items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3 text-[var(--text-secondary)] text-sm'>
        <Loader animate className='size-4' />
        {label}…
      </div>
    )
  }

  if (lifecycle.phase === 'failed') {
    return (
      <div
        className='mx-auto mb-3 w-full max-w-[48rem] rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3 text-[var(--text-error)] text-sm'
        role='alert'
      >
        {lifecycle.statusMessage || 'The Full-stack build failed. Retry from chat.'}
      </div>
    )
  }

  return null
}
