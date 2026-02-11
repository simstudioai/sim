'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Check, Clipboard } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  ButtonGroup,
  ButtonGroupItem,
  Checkbox,
  Code,
  Input,
  Label,
  TagInput,
  Textarea,
  Tooltip,
} from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import type { AgentAuthentication, AgentCapabilities } from '@/lib/a2a/types'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { normalizeInputFormatValue } from '@/lib/workflows/input-format'
import { StartBlockPath, TriggerUtils } from '@/lib/workflows/triggers/triggers'
import {
  useA2AAgentByWorkflow,
  useCreateA2AAgent,
  useDeleteA2AAgent,
  usePublishA2AAgent,
  useUpdateA2AAgent,
} from '@/hooks/queries/a2a/agents'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('A2ADeploy')

interface InputFormatField {
  id?: string
  name?: string
  type?: string
  value?: unknown
  collapsed?: boolean
}

/**
 * Check if a description is a default/placeholder value that should be filtered out
 */
function isDefaultDescription(desc: string | null | undefined, workflowName: string): boolean {
  if (!desc) return true
  const normalized = desc.toLowerCase().trim()
  return (
    normalized === '' ||
    normalized === 'new workflow' ||
    normalized === 'your first workflow - start building here!' ||
    normalized === workflowName.toLowerCase()
  )
}

type CodeLanguage = 'curl' | 'python' | 'javascript' | 'typescript'

const LANGUAGE_LABELS: Record<CodeLanguage, string> = {
  curl: 'cURL',
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
}

const LANGUAGE_SYNTAX: Record<CodeLanguage, 'python' | 'javascript' | 'json'> = {
  curl: 'javascript',
  python: 'python',
  javascript: 'javascript',
  typescript: 'javascript',
}

interface A2aDeployProps {
  workflowId: string
  workflowName: string
  workflowDescription?: string | null
  isDeployed: boolean
  workflowNeedsRedeployment?: boolean
  onSubmittingChange?: (submitting: boolean) => void
  onCanSaveChange?: (canSave: boolean) => void
  /** Callback for when republish status changes - depends on local form state */
  onNeedsRepublishChange?: (needsRepublish: boolean) => void
  onDeployWorkflow?: () => Promise<void>
}

type AuthScheme = 'none' | 'apiKey'

export function A2aDeploy({
  workflowId,
  workflowName,
  workflowDescription,
  isDeployed,
  workflowNeedsRedeployment,
  onSubmittingChange,
  onCanSaveChange,
  onNeedsRepublishChange,
  onDeployWorkflow,
}: A2aDeployProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const { data: existingAgent, isLoading } = useA2AAgentByWorkflow(workspaceId, workflowId)

  const createAgent = useCreateA2AAgent()
  const updateAgent = useUpdateA2AAgent()
  const deleteAgent = useDeleteA2AAgent()
  const publishAgent = usePublishA2AAgent()

  const blocks = useWorkflowStore((state) => state.blocks)
  const { collaborativeSetSubblockValue } = useCollaborativeWorkflow()

  const startBlockId = useMemo(() => {
    if (!blocks || Object.keys(blocks).length === 0) return null
    const candidate = TriggerUtils.findStartBlock(blocks, 'api')
    if (!candidate || candidate.path !== StartBlockPath.UNIFIED) return null
    return candidate.blockId
  }, [blocks])

  const startBlockInputFormat = useSubBlockStore((state) => {
    if (!workflowId || !startBlockId) return null
    const workflowValues = state.workflowValues[workflowId]
    const fromStore = workflowValues?.[startBlockId]?.inputFormat
    if (fromStore !== undefined) return fromStore
    const startBlock = blocks[startBlockId]
    return startBlock?.subBlocks?.inputFormat?.value ?? null
  })

  const missingFields = useMemo(() => {
    if (!startBlockId) return { input: false, data: false, files: false, any: false }
    const normalizedFields = normalizeInputFormatValue(startBlockInputFormat)
    const existingNames = new Set(
      normalizedFields
        .map((field) => field.name)
        .filter((n): n is string => typeof n === 'string' && n.trim() !== '')
        .map((n) => n.trim().toLowerCase())
    )
    const missing = {
      input: !existingNames.has('input'),
      data: !existingNames.has('data'),
      files: !existingNames.has('files'),
      any: false,
    }
    missing.any = missing.input || missing.data || missing.files
    return missing
  }, [startBlockId, startBlockInputFormat])

  const handleAddA2AInputs = useCallback(() => {
    if (!startBlockId) return

    const normalizedExisting = normalizeInputFormatValue(startBlockInputFormat)
    const newFields: InputFormatField[] = []

    // Add input field if missing (for TextPart)
    if (missingFields.input) {
      newFields.push({
        id: crypto.randomUUID(),
        name: 'input',
        type: 'string',
        value: '',
        collapsed: false,
      })
    }

    // Add data field if missing (for DataPart)
    if (missingFields.data) {
      newFields.push({
        id: crypto.randomUUID(),
        name: 'data',
        type: 'object',
        value: '',
        collapsed: false,
      })
    }

    // Add files field if missing (for FilePart)
    if (missingFields.files) {
      newFields.push({
        id: crypto.randomUUID(),
        name: 'files',
        type: 'file[]',
        value: '',
        collapsed: false,
      })
    }

    if (newFields.length > 0) {
      const updatedFields = [...newFields, ...normalizedExisting]
      collaborativeSetSubblockValue(startBlockId, 'inputFormat', updatedFields)
      logger.info(
        `Added A2A input fields to Start block: ${newFields.map((f) => f.name).join(', ')}`
      )
    }
  }, [startBlockId, startBlockInputFormat, missingFields, collaborativeSetSubblockValue])

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [authScheme, setAuthScheme] = useState<AuthScheme>('apiKey')
  const [pushNotificationsEnabled, setPushNotificationsEnabled] = useState(false)
  const [skillTags, setSkillTags] = useState<string[]>([])
  const [language, setLanguage] = useState<CodeLanguage>('curl')
  const [useStreamingExample, setUseStreamingExample] = useState(false)
  const [urlCopied, setUrlCopied] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)

  useEffect(() => {
    if (existingAgent) {
      setName(existingAgent.name)
      const savedDesc = existingAgent.description || ''
      setDescription(isDefaultDescription(savedDesc, workflowName) ? '' : savedDesc)
      setPushNotificationsEnabled(existingAgent.capabilities?.pushNotifications ?? false)
      const schemes = existingAgent.authentication?.schemes || []
      if (schemes.includes('apiKey')) {
        setAuthScheme('apiKey')
      } else {
        setAuthScheme('none')
      }
      const skills = existingAgent.skills as Array<{ tags?: string[] }> | undefined
      const savedTags = skills?.[0]?.tags
      setSkillTags(savedTags?.length ? savedTags : [])
    } else {
      setName(workflowName)
      setDescription(
        isDefaultDescription(workflowDescription, workflowName) ? '' : workflowDescription || ''
      )
      setAuthScheme('apiKey')
      setPushNotificationsEnabled(false)
      setSkillTags([])
    }
  }, [existingAgent, workflowName, workflowDescription])

  const hasFormChanges = useMemo(() => {
    if (!existingAgent) return false
    const savedSchemes = existingAgent.authentication?.schemes || []
    const savedAuthScheme = savedSchemes.includes('apiKey') ? 'apiKey' : 'none'
    const savedDesc = existingAgent.description || ''
    const normalizedSavedDesc = isDefaultDescription(savedDesc, workflowName) ? '' : savedDesc
    const skills = existingAgent.skills as Array<{ tags?: string[] }> | undefined
    const savedTags = skills?.[0]?.tags || []
    const tagsChanged =
      skillTags.length !== savedTags.length || skillTags.some((t, i) => t !== savedTags[i])
    return (
      name !== existingAgent.name ||
      description !== normalizedSavedDesc ||
      pushNotificationsEnabled !== (existingAgent.capabilities?.pushNotifications ?? false) ||
      authScheme !== savedAuthScheme ||
      tagsChanged
    )
  }, [
    existingAgent,
    name,
    description,
    pushNotificationsEnabled,
    authScheme,
    skillTags,
    workflowName,
  ])

  const hasWorkflowChanges = useMemo(() => {
    if (!existingAgent) return false
    return !!workflowNeedsRedeployment
  }, [existingAgent, workflowNeedsRedeployment])

  const needsRepublish = existingAgent && (hasFormChanges || hasWorkflowChanges)

  useEffect(() => {
    onNeedsRepublishChange?.(!!needsRepublish)
  }, [needsRepublish, onNeedsRepublishChange])

  const canSave = name.trim().length > 0 && description.trim().length > 0
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
      streaming: true,
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
          capabilities,
          authentication,
          skillTags,
        })
      } else {
        await createAgent.mutateAsync({
          workspaceId,
          workflowId,
          name: name.trim(),
          description: description.trim() || undefined,
          capabilities,
          authentication,
          skillTags,
        })
      }
    } catch (error) {
      logger.error('Failed to save A2A agent:', error)
    }
  }, [
    existingAgent,
    name,
    description,
    pushNotificationsEnabled,
    authScheme,
    skillTags,
    workspaceId,
    workflowId,
    createAgent,
    updateAgent,
  ])

  const handlePublish = useCallback(async () => {
    if (!existingAgent) return
    try {
      await publishAgent.mutateAsync({
        agentId: existingAgent.id,
        workspaceId,
        action: 'publish',
      })
    } catch (error) {
      logger.error('Failed to publish A2A agent:', error)
    }
  }, [existingAgent, workspaceId, publishAgent])

  const handleUnpublish = useCallback(async () => {
    if (!existingAgent) return
    try {
      await publishAgent.mutateAsync({
        agentId: existingAgent.id,
        workspaceId,
        action: 'unpublish',
      })
    } catch (error) {
      logger.error('Failed to unpublish A2A agent:', error)
    }
  }, [existingAgent, workspaceId, publishAgent])

  const handleDelete = useCallback(async () => {
    if (!existingAgent) return
    try {
      await deleteAgent.mutateAsync({
        agentId: existingAgent.id,
        workspaceId,
      })
      setName(workflowName)
      setDescription(workflowDescription || '')
    } catch (error) {
      logger.error('Failed to delete A2A agent:', error)
    }
  }, [existingAgent, workspaceId, deleteAgent, workflowName, workflowDescription])

  const handlePublishNewAgent = useCallback(async () => {
    const capabilities: AgentCapabilities = {
      streaming: true,
      pushNotifications: pushNotificationsEnabled,
      stateTransitionHistory: true,
    }

    const authentication: AgentAuthentication = {
      schemes: authScheme === 'none' ? ['none'] : [authScheme],
    }

    try {
      if (!isDeployed && onDeployWorkflow) {
        await onDeployWorkflow()
      }

      const newAgent = await createAgent.mutateAsync({
        workspaceId,
        workflowId,
        name: name.trim(),
        description: description.trim() || undefined,
        capabilities,
        authentication,
        skillTags,
      })

      await publishAgent.mutateAsync({
        agentId: newAgent.id,
        workspaceId,
        action: 'publish',
      })
    } catch (error) {
      logger.error('Failed to publish A2A agent:', error)
    }
  }, [
    name,
    description,
    pushNotificationsEnabled,
    authScheme,
    skillTags,
    workspaceId,
    workflowId,
    createAgent,
    publishAgent,
    isDeployed,
    onDeployWorkflow,
  ])

  const handleUpdateAndRepublish = useCallback(async () => {
    if (!existingAgent) return

    const capabilities: AgentCapabilities = {
      streaming: true,
      pushNotifications: pushNotificationsEnabled,
      stateTransitionHistory: true,
    }

    const authentication: AgentAuthentication = {
      schemes: authScheme === 'none' ? ['none'] : [authScheme],
    }

    try {
      if ((!isDeployed || workflowNeedsRedeployment) && onDeployWorkflow) {
        await onDeployWorkflow()
      }

      await updateAgent.mutateAsync({
        agentId: existingAgent.id,
        name: name.trim(),
        description: description.trim() || undefined,
        capabilities,
        authentication,
        skillTags,
      })

      await publishAgent.mutateAsync({
        agentId: existingAgent.id,
        workspaceId,
        action: 'publish',
      })
    } catch (error) {
      logger.error('Failed to update and republish A2A agent:', error)
    }
  }, [
    existingAgent,
    isDeployed,
    workflowNeedsRedeployment,
    onDeployWorkflow,
    name,
    description,
    pushNotificationsEnabled,
    authScheme,
    skillTags,
    workspaceId,
    updateAgent,
    publishAgent,
  ])

  const baseUrl = getBaseUrl()
  const endpoint = existingAgent ? `${baseUrl}/api/a2a/serve/${existingAgent.id}` : null

  const additionalInputFields = useMemo(() => {
    const allFields = normalizeInputFormatValue(startBlockInputFormat)
    return allFields.filter(
      (field): field is InputFormatField & { name: string } =>
        !!field.name &&
        field.name.toLowerCase() !== 'input' &&
        field.name.toLowerCase() !== 'data' &&
        field.name.toLowerCase() !== 'files'
    )
  }, [startBlockInputFormat])

  const getExampleInputData = useCallback((): Record<string, unknown> => {
    const data: Record<string, unknown> = {}
    for (const field of additionalInputFields) {
      switch (field.type) {
        case 'string':
          data[field.name] = 'example'
          break
        case 'number':
          data[field.name] = 42
          break
        case 'boolean':
          data[field.name] = true
          break
        case 'object':
          data[field.name] = { key: 'value' }
          break
        case 'array':
          data[field.name] = [1, 2, 3]
          break
        default:
          data[field.name] = 'example'
      }
    }
    return data
  }, [additionalInputFields])

  const getJsonRpcPayload = useCallback((): Record<string, unknown> => {
    const inputData = getExampleInputData()
    const hasAdditionalData = Object.keys(inputData).length > 0

    // Build parts array: TextPart for message text, DataPart for additional fields
    const parts: Array<Record<string, unknown>> = [{ kind: 'text', text: 'Hello, agent!' }]
    if (hasAdditionalData) {
      parts.push({ kind: 'data', data: inputData })
    }

    return {
      jsonrpc: '2.0',
      id: '1',
      method: useStreamingExample ? 'message/stream' : 'message/send',
      params: {
        message: {
          role: 'user',
          parts,
        },
      },
    }
  }, [getExampleInputData, useStreamingExample])

  const getCurlCommand = useCallback((): string => {
    if (!endpoint) return ''
    const payload = getJsonRpcPayload()
    const requiresAuth = authScheme !== 'none'

    switch (language) {
      case 'curl':
        return requiresAuth
          ? `curl -X POST \\
  -H "X-API-Key: $SIM_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(payload)}' \\
  ${endpoint}`
          : `curl -X POST \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(payload)}' \\
  ${endpoint}`

      case 'python':
        return requiresAuth
          ? `import os
import requests

response = requests.post(
    "${endpoint}",
    headers={
        "X-API-Key": os.environ.get("SIM_API_KEY"),
        "Content-Type": "application/json"
    },
    json=${JSON.stringify(payload, null, 4).replace(/\n/g, '\n    ')}
)

print(response.json())`
          : `import requests

response = requests.post(
    "${endpoint}",
    headers={"Content-Type": "application/json"},
    json=${JSON.stringify(payload, null, 4).replace(/\n/g, '\n    ')}
)

print(response.json())`

      case 'javascript':
        return requiresAuth
          ? `const response = await fetch("${endpoint}", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.SIM_API_KEY,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(${JSON.stringify(payload)})
});

const data = await response.json();
console.log(data);`
          : `const response = await fetch("${endpoint}", {
  method: "POST",
  headers: {"Content-Type": "application/json"},
  body: JSON.stringify(${JSON.stringify(payload)})
});

const data = await response.json();
console.log(data);`

      case 'typescript':
        return requiresAuth
          ? `const response = await fetch("${endpoint}", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.SIM_API_KEY,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(${JSON.stringify(payload)})
});

const data: Record<string, unknown> = await response.json();
console.log(data);`
          : `const response = await fetch("${endpoint}", {
  method: "POST",
  headers: {"Content-Type": "application/json"},
  body: JSON.stringify(${JSON.stringify(payload)})
});

const data: Record<string, unknown> = await response.json();
console.log(data);`

      default:
        return ''
    }
  }, [endpoint, language, getJsonRpcPayload, authScheme])

  const handleCopyCommand = useCallback(() => {
    navigator.clipboard.writeText(getCurlCommand())
    setCodeCopied(true)
    setTimeout(() => setCodeCopied(false), 2000)
  }, [getCurlCommand])

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

  return (
    <form
      id='a2a-deploy-form'
      onSubmit={(e) => {
        e.preventDefault()
        handleCreateOrUpdate()
      }}
      className='-mx-1 space-y-[12px] overflow-y-auto px-1 pb-[16px]'
    >
      {/* Endpoint URL (shown when agent exists) */}
      {existingAgent && endpoint && (
        <div>
          <div className='mb-[6.5px] flex items-center justify-between'>
            <Label className='block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
              URL
            </Label>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  type='button'
                  variant='ghost'
                  onClick={() => {
                    navigator.clipboard.writeText(endpoint)
                    setUrlCopied(true)
                    setTimeout(() => setUrlCopied(false), 2000)
                  }}
                  aria-label='Copy URL'
                  className='!p-1.5 -my-1.5'
                >
                  {urlCopied ? <Check className='h-3 w-3' /> : <Clipboard className='h-3 w-3' />}
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>
                <span>{urlCopied ? 'Copied' : 'Copy'}</span>
              </Tooltip.Content>
            </Tooltip.Root>
          </div>
          <div className='relative flex items-stretch overflow-hidden rounded-[4px] border border-[var(--border-1)]'>
            <div className='flex items-center whitespace-nowrap bg-[var(--surface-5)] pr-[6px] pl-[8px] font-medium text-[var(--text-secondary)] text-sm dark:bg-[var(--surface-5)]'>
              {baseUrl.replace(/^https?:\/\//, '')}/api/a2a/serve/
            </div>
            <div className='relative flex-1'>
              <Input
                value={existingAgent.id}
                readOnly
                className='rounded-none border-0 pl-0 text-[var(--text-tertiary)] shadow-none'
              />
            </div>
          </div>
          <p className='mt-[6.5px] text-[11px] text-[var(--text-secondary)]'>
            The A2A endpoint URL where clients can discover and call your agent
          </p>
        </div>
      )}

      {/* Agent Name */}
      <div>
        <Label
          htmlFor='a2a-name'
          className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'
        >
          Agent name <span className='text-red-500'>*</span>
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
          Description <span className='text-red-500'>*</span>
        </Label>
        <Textarea
          id='a2a-description'
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder='Describe what this agent does...'
          className='min-h-[80px] resize-none'
          required
        />
      </div>

      {/* Access */}
      <div>
        <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
          Access
        </Label>
        <ButtonGroup
          value={authScheme}
          onValueChange={(value) => setAuthScheme(value as AuthScheme)}
        >
          <ButtonGroupItem value='apiKey'>API Key</ButtonGroupItem>
          <ButtonGroupItem value='none'>Public</ButtonGroupItem>
        </ButtonGroup>
        <p className='mt-[6.5px] text-[11px] text-[var(--text-secondary)]'>
          {authScheme === 'none'
            ? 'Anyone can call this agent without authentication'
            : 'Requires X-API-Key header or API key query parameter'}
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

      {/* Tags */}
      <div>
        <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
          Tags
        </Label>
        <TagInput
          items={skillTags.map((tag) => ({ value: tag, isValid: true }))}
          onAdd={(value) => {
            if (!skillTags.includes(value)) {
              setSkillTags((prev) => [...prev, value])
              return true
            }
            return false
          }}
          onRemove={(_value, index) => {
            setSkillTags((prev) => prev.filter((_, i) => i !== index))
          }}
          placeholder='Add tags'
          placeholderWithTags='Add another'
          tagVariant='secondary'
          triggerKeys={['Enter', ',']}
        />
      </div>

      {/* Curl Preview (shown when agent exists) */}
      {existingAgent && endpoint && (
        <>
          <div>
            <div className='mb-[6.5px] flex items-center justify-between'>
              <Label className='block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
                Language
              </Label>
            </div>
            <ButtonGroup value={language} onValueChange={(val) => setLanguage(val as CodeLanguage)}>
              {(Object.keys(LANGUAGE_LABELS) as CodeLanguage[]).map((lang) => (
                <ButtonGroupItem key={lang} value={lang}>
                  {LANGUAGE_LABELS[lang]}
                </ButtonGroupItem>
              ))}
            </ButtonGroup>
          </div>

          <div>
            <div className='mb-[6.5px] flex items-center justify-between'>
              <Label className='block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
                Send message
              </Label>
              <div className='flex items-center gap-[8px]'>
                <div className='flex items-center gap-[6px]'>
                  <Checkbox
                    id='a2a-stream-example'
                    checked={useStreamingExample}
                    onCheckedChange={(checked) => setUseStreamingExample(checked === true)}
                  />
                  <label
                    htmlFor='a2a-stream-example'
                    className='text-[12px] text-[var(--text-secondary)]'
                  >
                    Stream
                  </label>
                </div>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button
                      type='button'
                      variant='ghost'
                      onClick={handleCopyCommand}
                      aria-label='Copy command'
                      className='!p-1.5 -my-1.5'
                    >
                      {codeCopied ? (
                        <Check className='h-3 w-3' />
                      ) : (
                        <Clipboard className='h-3 w-3' />
                      )}
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content>
                    <span>{codeCopied ? 'Copied' : 'Copy'}</span>
                  </Tooltip.Content>
                </Tooltip.Root>
              </div>
            </div>
            <Code.Viewer
              code={getCurlCommand()}
              language={LANGUAGE_SYNTAX[language]}
              wrapText
              className='!min-h-0 rounded-[4px] border border-[var(--border-1)]'
            />
            <div className='mt-[6.5px] flex items-start justify-between gap-2'>
              <p className='text-[11px] text-[var(--text-secondary)]'>
                External A2A clients can discover and call your agent. TextPart →{' '}
                <code className='text-[10px]'>&lt;start.input&gt;</code>, DataPart →{' '}
                <code className='text-[10px]'>&lt;start.data&gt;</code>, FilePart →{' '}
                <code className='text-[10px]'>&lt;start.files&gt;</code>.
              </p>
              {missingFields.any && (
                <div
                  className='flex flex-none cursor-pointer items-center whitespace-nowrap rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-5)] px-[9px] py-[2px] font-medium font-sans text-[12px] text-[var(--text-primary)] hover:bg-[var(--surface-7)] dark:hover:border-[var(--surface-7)] dark:hover:bg-[var(--border-1)]'
                  title='Add required A2A input fields to Start block'
                  onClick={handleAddA2AInputs}
                >
                  <span className='whitespace-nowrap'>Add inputs</span>
                </div>
              )}
            </div>
          </div>
        </>
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
      <button
        type='button'
        data-a2a-publish-new-trigger
        className='hidden'
        onClick={handlePublishNewAgent}
      />
      <button
        type='button'
        data-a2a-update-republish-trigger
        className='hidden'
        onClick={handleUpdateAndRepublish}
      />
    </form>
  )
}
