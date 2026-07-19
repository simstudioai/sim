'use client'

import { useEffect, useState } from 'react'
import {
  Button,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  Input,
  Textarea,
} from '@sim/emcn'
import { Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type {
  FullstackDesignPreferences,
  FullstackWorkflowSeed,
} from '@/lib/apps/build-interface/types'
import { FullstackWorkflowHandoffStorage } from '@/lib/core/utils/browser-storage'
import { useCreateMothershipChat } from '@/hooks/queries/mothership-chats'

type ExistingApp = { id: string; name: string; updatedAt: string; chatId: string | null }
type Readiness = {
  ready: boolean
  credentialRequired?: boolean
  code?: string
  message?: string
  existingApps: ExistingApp[]
}

export function BuildInterface({
  workspaceId,
  workflowId,
  workflowName,
  canEdit,
  disabled,
}: {
  workspaceId: string
  workflowId: string | null
  workflowName: string
  canEdit: boolean
  disabled?: boolean
}) {
  const router = useRouter()
  const createChat = useCreateMothershipChat(workspaceId, 'fullstack')
  const [open, setOpen] = useState(false)
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [appName, setAppName] = useState(`${workflowName} App`)
  const [instructions, setInstructions] = useState('')
  const [primaryColor, setPrimaryColor] = useState('#2563eb')
  const [style, setStyle] = useState<FullstackDesignPreferences['style']>('professional')
  const [theme, setTheme] = useState<FullstackDesignPreferences['theme']>('system')
  const [existingProjectId, setExistingProjectId] = useState('')

  useEffect(() => {
    if (!open || !workflowId) return
    setLoading(true)
    setError(null)
    void fetch(`/api/workflows/${encodeURIComponent(workflowId)}/app-readiness`, {
      method: 'POST',
    })
      .then(async (response) => {
        const json = (await response.json()) as Readiness & { error?: string }
        if (!response.ok) throw new Error(json.error || 'Failed to validate workflow')
        setReadiness(json)
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Readiness check failed'))
      .finally(() => setLoading(false))
  }, [open, workflowId])

  const start = async () => {
    if (!workflowId || !readiness?.ready) return
    setError(null)
    try {
      const existing = readiness.existingApps.find((app) => app.id === existingProjectId)
      const chatId = existing?.chatId || (await createChat.mutateAsync()).id
      const design: FullstackDesignPreferences = {
        appName: appName.trim() || undefined,
        instructions: instructions.trim() || undefined,
        primaryColor,
        style,
        theme,
      }
      const seed: FullstackWorkflowSeed = {
        source: 'existing_workflow',
        workflowIds: [workflowId],
        ...(existing ? { projectId: existing.id } : {}),
        design,
      }
      const message = [
        `Build an interface for the existing workflow "${workflowName}".`,
        `App name: ${design.appName || `${workflowName} App`}.`,
        `Style: ${style}; theme: ${theme}; primary color: ${primaryColor}.`,
        instructions.trim() ? `Design instructions: ${instructions.trim()}` : '',
        'Reuse the existing backend exactly as-is and do not generate or modify workflows.',
      ]
        .filter(Boolean)
        .join('\n')
      if (!FullstackWorkflowHandoffStorage.store({ chatId, message, seed }, workspaceId)) {
        throw new Error('Failed to prepare the Full-stack handoff')
      }
      setOpen(false)
      router.push(`/workspace/${workspaceId}/chat/${chatId}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to start interface builder')
    }
  }

  return (
    <>
      <Button
        className='h-[30px] gap-1.5 px-2.5'
        variant='tertiary'
        disabled={!canEdit || disabled || !workflowId}
        onClick={() => setOpen(true)}
      >
        <Sparkles className='size-[12px]' />
        Build Interface
      </Button>
      <ChipModal open={open} onOpenChange={setOpen} srTitle='Build Interface'>
        <ChipModalHeader onClose={() => setOpen(false)}>Build Interface</ChipModalHeader>
        <ChipModalBody>
          <p className='text-[var(--text-secondary)] text-sm'>
            Reuse <span className='font-medium text-[var(--text-primary)]'>{workflowName}</span> as
            the backend and generate a Full-stack App.
          </p>
          <ChipModalField type='custom' title='App name'>
            <Input value={appName} onChange={(event) => setAppName(event.target.value)} />
          </ChipModalField>
          <ChipModalField type='custom' title='Design instructions'>
            <Textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value.slice(0, 4000))}
              placeholder='Describe the layout, audience, components, and visual preferences...'
              className='min-h-28'
            />
          </ChipModalField>
          <div className='grid grid-cols-3 gap-3'>
            <ChipModalField type='custom' title='Primary color'>
              <Input
                type='color'
                value={primaryColor}
                onChange={(event) => setPrimaryColor(event.target.value)}
              />
            </ChipModalField>
            <ChipModalField type='custom' title='Style'>
              <select
                className='h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 text-sm'
                value={style}
                onChange={(event) =>
                  setStyle(event.target.value as FullstackDesignPreferences['style'])
                }
              >
                <option value='minimal'>Minimal</option>
                <option value='professional'>Professional</option>
                <option value='playful'>Playful</option>
                <option value='custom'>Custom</option>
              </select>
            </ChipModalField>
            <ChipModalField type='custom' title='Theme'>
              <select
                className='h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 text-sm'
                value={theme}
                onChange={(event) =>
                  setTheme(event.target.value as FullstackDesignPreferences['theme'])
                }
              >
                <option value='system'>System</option>
                <option value='light'>Light</option>
                <option value='dark'>Dark</option>
              </select>
            </ChipModalField>
          </div>
          {readiness?.existingApps.length ? (
            <ChipModalField type='custom' title='App'>
              <select
                className='h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 text-sm'
                value={existingProjectId}
                onChange={(event) => setExistingProjectId(event.target.value)}
              >
                <option value=''>Create a new App</option>
                {readiness.existingApps
                  .filter((app) => app.chatId)
                  .map((app) => (
                    <option key={app.id} value={app.id}>
                      Continue {app.name}
                    </option>
                  ))}
              </select>
            </ChipModalField>
          ) : null}
          {loading ? (
            <p className='text-[var(--text-secondary)] text-sm'>Checking workflow…</p>
          ) : null}
          {readiness && !readiness.ready ? (
            <ChipModalError>
              {readiness.message || readiness.code || 'Workflow is not App-ready'}
            </ChipModalError>
          ) : null}
          <ChipModalError>{error}</ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => setOpen(false)}
          primaryAction={{
            label: createChat.isPending ? 'Starting…' : 'Start building',
            onClick: () => void start(),
            disabled: loading || createChat.isPending || !readiness?.ready,
          }}
        />
      </ChipModal>
    </>
  )
}
