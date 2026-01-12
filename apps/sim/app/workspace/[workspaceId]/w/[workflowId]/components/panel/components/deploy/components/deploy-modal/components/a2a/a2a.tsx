'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { Copy, ExternalLink, RefreshCw } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Badge,
  Button,
  Checkbox,
  Combobox,
  type ComboboxOption,
  Input,
  Label,
  Textarea,
} from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import type { AgentAuthentication, AgentCapabilities } from '@/lib/a2a/types'
import { getEnv } from '@/lib/core/config/env'
import {
  a2aAgentKeys,
  useA2AAgentByWorkflow,
  useCreateA2AAgent,
  useDeleteA2AAgent,
  usePublishA2AAgent,
  useUpdateA2AAgent,
} from '@/hooks/queries/a2a/agents'

const logger = createLogger('A2ADeploy')

interface A2aDeployProps {
  workflowId: string
  workflowName: string
  workflowDescription?: string | null
  isDeployed: boolean
  onSubmittingChange?: (submitting: boolean) => void
  onCanSaveChange?: (canSave: boolean) => void
  onAgentExistsChange?: (exists: boolean) => void
}

type AuthScheme = 'none' | 'apiKey' | 'bearer'

export function A2aDeploy({
  workflowId,
  workflowName,
  workflowDescription,
  isDeployed,
  onSubmittingChange,
  onCanSaveChange,
  onAgentExistsChange,
}: A2aDeployProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const queryClient = useQueryClient()

  const { data: existingAgent, isLoading, refetch } = useA2AAgentByWorkflow(workspaceId, workflowId)

  const createAgent = useCreateA2AAgent()
  const updateAgent = useUpdateA2AAgent()
  const deleteAgent = useDeleteA2AAgent()
  const publishAgent = usePublishA2AAgent()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [version, setVersion] = useState('1.0.0')
  const [authScheme, setAuthScheme] = useState<AuthScheme>('apiKey')
  const [streamingEnabled, setStreamingEnabled] = useState(true)
  const [pushNotificationsEnabled, setPushNotificationsEnabled] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (existingAgent) {
      setName(existingAgent.name)
      setDescription(existingAgent.description || '')
      setVersion(existingAgent.version)
      setStreamingEnabled(existingAgent.capabilities?.streaming ?? true)
      setPushNotificationsEnabled(existingAgent.capabilities?.pushNotifications ?? false)
      const schemes = existingAgent.authentication?.schemes || []
      if (schemes.includes('apiKey')) {
        setAuthScheme('apiKey')
      } else if (schemes.includes('bearer')) {
        setAuthScheme('bearer')
      } else {
        setAuthScheme('none')
      }
    } else {
      setName(workflowName)
      setDescription(workflowDescription || '')
      setVersion('1.0.0')
      setAuthScheme('apiKey')
      setStreamingEnabled(true)
      setPushNotificationsEnabled(false)
    }
  }, [existingAgent, workflowName, workflowDescription])

  useEffect(() => {
    onAgentExistsChange?.(!!existingAgent)
  }, [existingAgent, onAgentExistsChange])

  const authSchemeOptions: ComboboxOption[] = useMemo(
    () => [
      { label: 'API Key', value: 'apiKey' },
      { label: 'Bearer Token', value: 'bearer' },
      { label: 'None (Public)', value: 'none' },
    ],
    []
  )

  const canSave = name.trim().length > 0
  useEffect(() => {
    onCanSaveChange?.(canSave)
  }, [canSave, onCanSaveChange])

  const isSubmitting =
    createAgent.isPending ||
    updateAgent.isPending ||
    deleteAgent.isPending ||
    publishAgent.isPending

  useEffect(() => {
    onSubmittingChange?.(isSubmitting)
  }, [isSubmitting, onSubmittingChange])

  const handleCreateOrUpdate = useCallback(async () => {
    const capabilities: AgentCapabilities = {
      streaming: streamingEnabled,
      pushNotifications: pushNotificationsEnabled,
      stateTransitionHistory: true,
    }

    const authentication: AgentAuthentication = {
      schemes: authScheme === 'none' ? ['none'] : [authScheme],
    }

    try {
      if (existingAgent) {
        await updateAgent.mutateAsync({
          agentId: existingAgent.id,
          name: name.trim(),
          description: description.trim() || undefined,
          version,
          capabilities,
          authentication,
        })
      } else {
        await createAgent.mutateAsync({
          workspaceId,
          workflowId,
          name: name.trim(),
          description: description.trim() || undefined,
          capabilities,
          authentication,
        })
      }
      queryClient.invalidateQueries({
        queryKey: [...a2aAgentKeys.all, 'byWorkflow', workspaceId, workflowId],
      })
    } catch (error) {
      logger.error('Failed to save A2A agent:', error)
    }
  }, [
    existingAgent,
    name,
    description,
    version,
    streamingEnabled,
    pushNotificationsEnabled,
    authScheme,
    workspaceId,
    workflowId,
    createAgent,
    updateAgent,
    queryClient,
  ])

  const handlePublish = useCallback(async () => {
    if (!existingAgent) return
    try {
      await publishAgent.mutateAsync({
        agentId: existingAgent.id,
        workspaceId,
        action: 'publish',
      })
      refetch()
    } catch (error) {
      logger.error('Failed to publish A2A agent:', error)
    }
  }, [existingAgent, workspaceId, publishAgent, refetch])

  const handleUnpublish = useCallback(async () => {
    if (!existingAgent) return
    try {
      await publishAgent.mutateAsync({
        agentId: existingAgent.id,
        workspaceId,
        action: 'unpublish',
      })
      refetch()
    } catch (error) {
      logger.error('Failed to unpublish A2A agent:', error)
    }
  }, [existingAgent, workspaceId, publishAgent, refetch])

  const handleRefreshSkills = useCallback(async () => {
    if (!existingAgent) return
    try {
      await publishAgent.mutateAsync({
        agentId: existingAgent.id,
        workspaceId,
        action: 'refresh',
      })
      refetch()
    } catch (error) {
      logger.error('Failed to refresh A2A agent skills:', error)
    }
  }, [existingAgent, workspaceId, publishAgent, refetch])

  const handleDelete = useCallback(async () => {
    if (!existingAgent) return
    try {
      await deleteAgent.mutateAsync({
        agentId: existingAgent.id,
        workspaceId,
      })
      setName(workflowName)
      setDescription(workflowDescription || '')
      setVersion('1.0.0')
    } catch (error) {
      logger.error('Failed to delete A2A agent:', error)
    }
  }, [existingAgent, workspaceId, deleteAgent, workflowName, workflowDescription])

  const handleCopyEndpoint = useCallback(() => {
    if (!existingAgent) return
    const endpoint = `${getEnv('NEXT_PUBLIC_APP_URL')}/api/a2a/serve/${existingAgent.id}`
    navigator.clipboard.writeText(endpoint)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [existingAgent])

  if (!isDeployed) {
    return (
      <div className='flex h-full items-center justify-center text-[13px] text-[var(--text-muted)]'>
        Deploy your workflow first to expose it as an A2A agent.
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className='-mx-1 space-y-[12px] px-1'>
        <div>
          <Skeleton className='mb-[6.5px] h-[16px] w-[80px]' />
          <Skeleton className='h-[34px] w-full rounded-[4px]' />
          <Skeleton className='mt-[6.5px] h-[14px] w-[200px]' />
        </div>
        <div>
          <Skeleton className='mb-[6.5px] h-[16px] w-[70px]' />
          <Skeleton className='h-[80px] w-full rounded-[4px]' />
        </div>
        <div>
          <Skeleton className='mb-[6.5px] h-[16px] w-[50px]' />
          <Skeleton className='h-[34px] w-full rounded-[4px]' />
        </div>
        <div>
          <Skeleton className='mb-[6.5px] h-[16px] w-[90px]' />
          <Skeleton className='h-[34px] w-full rounded-[4px]' />
        </div>
      </div>
    )
  }

  const endpoint = existingAgent
    ? `${getEnv('NEXT_PUBLIC_APP_URL')}/api/a2a/serve/${existingAgent.id}`
    : null

  return (
    <form
      id='a2a-deploy-form'
      onSubmit={(e) => {
        e.preventDefault()
        handleCreateOrUpdate()
      }}
      className='-mx-1 space-y-[12px] overflow-y-auto px-1'
    >
      {/* Status Badge */}
      {existingAgent && (
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-[8px]'>
            <Badge variant={existingAgent.isPublished ? 'green' : 'default'} size='lg' dot>
              {existingAgent.isPublished ? 'Published' : 'Unpublished'}
            </Badge>
            {existingAgent.taskCount !== undefined && existingAgent.taskCount > 0 && (
              <span className='text-[11px] text-[var(--text-tertiary)]'>
                {existingAgent.taskCount} task{existingAgent.taskCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {existingAgent.isPublished && (
            <a
              href={`${getEnv('NEXT_PUBLIC_APP_URL')}/docs/a2a`}
              target='_blank'
              rel='noopener noreferrer'
              className='flex items-center gap-[4px] text-[11px] text-[var(--text-link)] hover:underline'
            >
              Documentation
              <ExternalLink className='h-[12px] w-[12px]' />
            </a>
          )}
        </div>
      )}

      {/* Agent Name */}
      <div>
        <Label
          htmlFor='a2a-name'
          className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'
        >
          Agent name
        </Label>
        <Input
          id='a2a-name'
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder='Enter agent name'
          required
        />
        <p className='mt-[6.5px] text-[11px] text-[var(--text-secondary)]'>
          Human-readable name shown in the Agent Card
        </p>
      </div>

      {/* Description */}
      <div>
        <Label
          htmlFor='a2a-description'
          className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'
        >
          Description
        </Label>
        <Textarea
          id='a2a-description'
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder='Describe what this agent does...'
          className='min-h-[80px] resize-none'
        />
      </div>

      {/* Version */}
      <div>
        <Label
          htmlFor='a2a-version'
          className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'
        >
          Version
        </Label>
        <Input
          id='a2a-version'
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          placeholder='1.0.0'
        />
      </div>

      {/* Authentication */}
      <div>
        <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
          Authentication
        </Label>
        <Combobox
          options={authSchemeOptions}
          value={authScheme}
          onChange={(v) => setAuthScheme(v as AuthScheme)}
          placeholder='Select authentication...'
        />
        <p className='mt-[6.5px] text-[11px] text-[var(--text-secondary)]'>
          {authScheme === 'none'
            ? 'Anyone can call this agent without authentication'
            : authScheme === 'apiKey'
              ? 'Requires X-API-Key header or API key query parameter'
              : 'Requires Authorization: Bearer token header'}
        </p>
      </div>

      {/* Capabilities */}
      <div>
        <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
          Capabilities
        </Label>
        <div className='space-y-[8px]'>
          <div className='flex items-center gap-[8px]'>
            <Checkbox
              id='a2a-streaming'
              checked={streamingEnabled}
              onCheckedChange={(checked) => setStreamingEnabled(checked === true)}
            />
            <label htmlFor='a2a-streaming' className='text-[13px] text-[var(--text-primary)]'>
              Streaming responses (SSE)
            </label>
          </div>
          <div className='flex items-center gap-[8px]'>
            <Checkbox
              id='a2a-push'
              checked={pushNotificationsEnabled}
              onCheckedChange={(checked) => setPushNotificationsEnabled(checked === true)}
            />
            <label htmlFor='a2a-push' className='text-[13px] text-[var(--text-primary)]'>
              Push notifications (webhooks)
            </label>
          </div>
        </div>
      </div>

      {/* Endpoint URL (only shown when agent exists) */}
      {existingAgent && endpoint && (
        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            Endpoint URL
          </Label>
          <div className='flex items-center gap-[8px]'>
            <Input value={endpoint} readOnly className='font-mono text-[12px]' />
            <Button type='button' variant='outline' size='sm' onClick={handleCopyEndpoint}>
              <Copy className='h-[14px] w-[14px]' />
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <p className='mt-[6.5px] text-[11px] text-[var(--text-secondary)]'>
            External A2A clients can discover and call your agent at this URL
          </p>
        </div>
      )}

      {/* Skills (only shown when agent exists) */}
      {existingAgent?.skills && existingAgent.skills.length > 0 && (
        <div>
          <div className='mb-[6.5px] flex items-center justify-between'>
            <Label className='block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
              Skills
            </Label>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={handleRefreshSkills}
              disabled={isSubmitting}
              className='h-[24px] px-[8px] text-[11px]'
            >
              <RefreshCw className='mr-[4px] h-[12px] w-[12px]' />
              Refresh
            </Button>
          </div>
          <div className='flex flex-col gap-[8px]'>
            {existingAgent.skills.map((skill) => (
              <div
                key={skill.id}
                className='rounded-[6px] border bg-[var(--surface-3)] px-[10px] py-[8px]'
              >
                <div className='font-medium text-[13px] text-[var(--text-primary)]'>
                  {skill.name}
                </div>
                {skill.description && (
                  <div className='mt-[4px] text-[11px] text-[var(--text-secondary)]'>
                    {skill.description}
                  </div>
                )}
                {skill.tags && skill.tags.length > 0 && (
                  <div className='mt-[6px] flex flex-wrap gap-[4px]'>
                    {skill.tags.map((tag) => (
                      <Badge key={tag} variant='outline' className='text-[10px]'>
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hidden triggers for modal footer */}
      <button type='submit' data-a2a-save-trigger className='hidden' />
      <button type='button' data-a2a-publish-trigger className='hidden' onClick={handlePublish} />
      <button
        type='button'
        data-a2a-unpublish-trigger
        className='hidden'
        onClick={handleUnpublish}
      />
      <button type='button' data-a2a-delete-trigger className='hidden' onClick={handleDelete} />
    </form>
  )
}
