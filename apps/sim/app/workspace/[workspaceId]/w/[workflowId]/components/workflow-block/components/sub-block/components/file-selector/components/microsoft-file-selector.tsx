'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ExternalLink, RefreshCw, X } from 'lucide-react'
import { MicrosoftExcelIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createLogger } from '@/lib/logs/console/logger'
import {
  type Credential,
  getProviderIdFromServiceId,
  getServiceByProviderAndId,
  getServiceIdFromScopes,
  OAUTH_PROVIDERS,
  type OAuthProvider,
  parseProvider,
} from '@/lib/oauth'
import { OAuthRequiredModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components/credential-selector/components/oauth-required-modal'
import type { PlannerTask } from '@/tools/microsoft_planner/types'

const logger = createLogger('MicrosoftFileSelector')

export interface MicrosoftFileInfo {
  id: string
  name: string
  mimeType: string
  iconLink?: string
  webViewLink?: string
  thumbnailLink?: string
  createdTime?: string
  modifiedTime?: string
  size?: string
  owners?: { displayName: string; emailAddress: string }[]
}

// Union type for items that can be displayed in the file selector
type SelectableItem = MicrosoftFileInfo | PlannerTask

interface MicrosoftFileSelectorProps {
  value: string
  onChange: (value: string, fileInfo?: MicrosoftFileInfo) => void
  provider: OAuthProvider
  requiredScopes?: string[]
  label?: string
  disabled?: boolean
  serviceId?: string
  showPreview?: boolean
  onFileInfoChange?: (fileInfo: MicrosoftFileInfo | null) => void
  planId?: string
  workflowId?: string
  credentialId?: string
  isForeignCredential?: boolean
}

export function MicrosoftFileSelector({
  value,
  onChange,
  provider,
  requiredScopes = [],
  label = 'Select file',
  disabled = false,
  serviceId,
  showPreview = true,
  onFileInfoChange,
  planId,
  workflowId,
  credentialId,
  isForeignCredential = false,
}: MicrosoftFileSelectorProps) {
  const [open, setOpen] = useState(false)
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [selectedCredentialId, setSelectedCredentialId] = useState<string>(credentialId || '')
  const [selectedFileId, setSelectedFileId] = useState(value)
  const [selectedFile, setSelectedFile] = useState<MicrosoftFileInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingSelectedFile, setIsLoadingSelectedFile] = useState(false)
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  const [availableFiles, setAvailableFiles] = useState<MicrosoftFileInfo[]>([])
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const [credentialsLoaded, setCredentialsLoaded] = useState(false)
  const initialFetchRef = useRef(false)

  // Handle Microsoft Planner task selection
  const [plannerTasks, setPlannerTasks] = useState<PlannerTask[]>([])
  const [isLoadingTasks, setIsLoadingTasks] = useState(false)
  const [selectedTask, setSelectedTask] = useState<PlannerTask | null>(null)

  // Determine the appropriate service ID based on provider and scopes
  const getServiceId = (): string => {
    if (serviceId) return serviceId
    return getServiceIdFromScopes(provider, requiredScopes)
  }

  // Determine the appropriate provider ID based on service and scopes
  const getProviderId = (): string => {
    const effectiveServiceId = getServiceId()
    return getProviderIdFromServiceId(effectiveServiceId)
  }

  // Fetch available credentials for this provider
  const fetchCredentials = useCallback(async () => {
    setIsLoading(true)
    setCredentialsLoaded(false)
    try {
      const providerId = getProviderId()
      const response = await fetch(`/api/auth/oauth/credentials?provider=${providerId}`)

      if (response.ok) {
        const data = await response.json()
        setCredentials(data.credentials)

        // If a credentialId prop is provided (collaborator case), do not auto-select
        if (!credentialId && data.credentials.length > 0 && !selectedCredentialId) {
          const defaultCred = data.credentials.find((cred: Credential) => cred.isDefault)
          if (defaultCred) setSelectedCredentialId(defaultCred.id)
          else if (data.credentials.length === 1) setSelectedCredentialId(data.credentials[0].id)
        }
      }
    } catch (error) {
      logger.error('Error fetching credentials:', { error })
    } finally {
      setIsLoading(false)
      setCredentialsLoaded(true)
    }
  }, [provider, getProviderId, selectedCredentialId, credentialId])

  // Keep internal credential in sync with prop
  useEffect(() => {
    if (credentialId && credentialId !== selectedCredentialId) {
      setSelectedCredentialId(credentialId)
    }
  }, [credentialId, selectedCredentialId])

  // Fetch available files for the selected credential
  const fetchAvailableFiles = useCallback(async () => {
    if (!selectedCredentialId || isForeignCredential) return

    setIsLoadingFiles(true)
    try {
      const queryParams = new URLSearchParams({
        credentialId: selectedCredentialId,
      })

      // Add search query if provided
      if (searchQuery.trim()) {
        queryParams.append('query', searchQuery.trim())
      }

      // Route to correct endpoint based on service
      let endpoint: string
      if (serviceId === 'onedrive') {
        endpoint = `/api/tools/onedrive/folders?${queryParams.toString()}`
      } else if (serviceId === 'sharepoint') {
        endpoint = `/api/tools/sharepoint/sites?${queryParams.toString()}`
      } else {
        endpoint = `/api/auth/oauth/microsoft/files?${queryParams.toString()}`
      }

      const response = await fetch(endpoint)

      if (response.ok) {
        const data = await response.json()
        setAvailableFiles(data.files || [])
      } else {
        const txt = await response.text()
        if (response.status === 401 || response.status === 403) {
          // Suppress noisy auth errors for collaborators; lists are intentionally gated
          logger.info('Skipping list fetch (auth)', { status: response.status })
        } else {
          logger.warn('Non-OK list fetch', { status: response.status, txt })
        }
        setAvailableFiles([])
      }
    } catch (error) {
      logger.error('Error fetching available files:', { error })
      setAvailableFiles([])
    } finally {
      setIsLoadingFiles(false)
    }
  }, [selectedCredentialId, searchQuery, serviceId, isForeignCredential])

  // Fetch a single file by ID when we have a selectedFileId but no metadata
  const fetchFileById = useCallback(
    async (fileId: string) => {
      if (!selectedCredentialId || !fileId) return null

      setIsLoadingSelectedFile(true)
      try {
        // Use owner-scoped token for OneDrive items (files/folders) and Excel
        if (serviceId !== 'sharepoint') {
          const tokenRes = await fetch('/api/auth/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credentialId: selectedCredentialId, workflowId }),
          })
          if (!tokenRes.ok) {
            const err = await tokenRes.text()
            logger.error('Failed to get access token for Microsoft file fetch', { err })
            return null
          }
          const { accessToken } = await tokenRes.json()
          if (!accessToken) return null

          const graphUrl =
            `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(fileId)}?` +
            new URLSearchParams({
              $select:
                'id,name,webUrl,thumbnails,createdDateTime,lastModifiedDateTime,size,createdBy,file,folder',
            }).toString()
          const resp = await fetch(graphUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
          })
          if (!resp.ok) {
            const t = await resp.text()
            // For 404/403, keep current selection; this often means the item moved or is shared differently.
            if (resp.status !== 404 && resp.status !== 403) {
              logger.warn('Graph error fetching file by ID', { status: resp.status, t })
            }
            return null
          }
          const file = await resp.json()
          const fileInfo: MicrosoftFileInfo = {
            id: file.id,
            name: file.name,
            mimeType:
              file?.file?.mimeType || (file.folder ? 'application/vnd.ms-onedrive.folder' : ''),
            iconLink: file.thumbnails?.[0]?.small?.url,
            webViewLink: file.webUrl,
            thumbnailLink: file.thumbnails?.[0]?.medium?.url,
            createdTime: file.createdDateTime,
            modifiedTime: file.lastModifiedDateTime,
            size: file.size?.toString(),
            owners: file.createdBy
              ? [
                  {
                    displayName: file.createdBy.user?.displayName || 'Unknown',
                    emailAddress: file.createdBy.user?.email || '',
                  },
                ]
              : [],
          }
          setSelectedFile(fileInfo)
          onFileInfoChange?.(fileInfo)
          return fileInfo
        }

        // SharePoint site: fetch via Graph sites endpoint for collaborator visibility
        const tokenRes = await fetch('/api/auth/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credentialId: selectedCredentialId, workflowId }),
        })
        if (!tokenRes.ok) return null
        const { accessToken: spToken } = await tokenRes.json()
        if (!spToken) return null
        const spResp = await fetch(
          `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(fileId)}?$select=id,displayName,webUrl`,
          {
            headers: { Authorization: `Bearer ${spToken}` },
          }
        )
        if (!spResp.ok) return null
        const site = await spResp.json()
        const siteInfo: MicrosoftFileInfo = {
          id: site.id,
          name: site.displayName,
          mimeType: 'sharepoint/site',
          webViewLink: site.webUrl,
        }
        setSelectedFile(siteInfo)
        onFileInfoChange?.(siteInfo)
        return siteInfo
      } catch (error) {
        logger.error('Error fetching file by ID:', { error })
        return null
      } finally {
        setIsLoadingSelectedFile(false)
      }
    },
    [selectedCredentialId, onFileInfoChange, serviceId, workflowId, onChange]
  )

  // Fetch Microsoft Planner tasks when planId and credentials are available
  const fetchPlannerTasks = useCallback(async () => {
    if (
      !selectedCredentialId ||
      !planId ||
      serviceId !== 'microsoft-planner' ||
      isForeignCredential
    ) {
      logger.info('Skipping task fetch - missing requirements:', {
        selectedCredentialId: !!selectedCredentialId,
        planId: !!planId,
        serviceId,
        isForeignCredential,
      })
      return
    }

    logger.info('Fetching Planner tasks with:', {
      credentialId: selectedCredentialId,
      planId,
      serviceId,
    })

    setIsLoadingTasks(true)
    try {
      const queryParams = new URLSearchParams({
        credentialId: selectedCredentialId,
        planId: planId,
      })

      const url = `/api/tools/microsoft_planner/tasks?${queryParams.toString()}`
      logger.info('Calling API endpoint:', url)

      const response = await fetch(url)

      if (response.ok) {
        const data = await response.json()
        logger.info('Received task data:', data)
        const tasks = data.tasks || []

        // Transform tasks to match file info format for consistency
        const transformedTasks = tasks.map((task: PlannerTask) => ({
          id: task.id,
          name: task.title,
          mimeType: 'planner/task',
          webViewLink: `https://tasks.office.com/planner/task/${task.id}`,
          modifiedTime: task.createdDateTime,
          createdTime: task.createdDateTime,
          planId: task.planId,
          bucketId: task.bucketId,
          percentComplete: task.percentComplete,
          priority: task.priority,
          dueDateTime: task.dueDateTime,
        }))

        logger.info('Transformed tasks:', transformedTasks)
        setPlannerTasks(transformedTasks)
      } else {
        const errorText = await response.text()
        if (response.status === 401 || response.status === 403) {
          logger.info('Planner list fetch unauthorized (expected for collaborator)', {
            status: response.status,
          })
        } else {
          logger.warn('Planner tasks fetch non-OK', {
            status: response.status,
            statusText: response.statusText,
            errorText,
          })
        }
        setPlannerTasks([])
      }
    } catch (error) {
      logger.error('Network/fetch error:', error)
      setPlannerTasks([])
    } finally {
      setIsLoadingTasks(false)
    }
  }, [selectedCredentialId, planId, serviceId, isForeignCredential])

  // Fetch a single planner task by ID for collaborator preview
  const fetchPlannerTaskById = useCallback(
    async (taskId: string) => {
      if (!selectedCredentialId || !taskId || serviceId !== 'microsoft-planner') return null
      setIsLoadingTasks(true)
      try {
        const tokenRes = await fetch('/api/auth/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credentialId: selectedCredentialId, workflowId }),
        })
        if (!tokenRes.ok) return null
        const { accessToken } = await tokenRes.json()
        if (!accessToken) return null
        const resp = await fetch(
          `https://graph.microsoft.com/v1.0/planner/tasks/${encodeURIComponent(taskId)}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        )
        if (!resp.ok) return null
        const task = await resp.json()
        const taskAsFileInfo: MicrosoftFileInfo = {
          id: task.id,
          name: task.title,
          mimeType: 'planner/task',
          webViewLink: `https://tasks.office.com/planner/task/${task.id}`,
          createdTime: task.createdDateTime,
          modifiedTime: task.createdDateTime,
        }
        setSelectedTask(task)
        setSelectedFile(taskAsFileInfo)
        onFileInfoChange?.(taskAsFileInfo)
        return taskAsFileInfo
      } catch {
        return null
      } finally {
        setIsLoadingTasks(false)
      }
    },
    [selectedCredentialId, workflowId, onFileInfoChange, serviceId]
  )

  // Fetch credentials on initial mount
  useEffect(() => {
    if (!initialFetchRef.current) {
      fetchCredentials()
      initialFetchRef.current = true
    }
  }, [fetchCredentials])

  // Fetch available files when credential changes
  useEffect(() => {
    if (selectedCredentialId) {
      fetchAvailableFiles()
    }
  }, [selectedCredentialId, fetchAvailableFiles])

  // Refetch files when search query changes
  useEffect(() => {
    if (selectedCredentialId && searchQuery !== undefined) {
      const timeoutId = setTimeout(() => {
        fetchAvailableFiles()
      }, 300) // Debounce search

      return () => clearTimeout(timeoutId)
    }
  }, [searchQuery, selectedCredentialId, fetchAvailableFiles])

  // Fetch planner tasks when credentials and planId change
  useEffect(() => {
    if (
      serviceId === 'microsoft-planner' &&
      selectedCredentialId &&
      planId &&
      !isForeignCredential
    ) {
      fetchPlannerTasks()
    }
  }, [selectedCredentialId, planId, serviceId, isForeignCredential, fetchPlannerTasks])

  // Handle task selection for planner
  const handleTaskSelect = (task: PlannerTask) => {
    const taskId = task.id || ''
    // Convert PlannerTask to MicrosoftFileInfo format for compatibility
    const taskAsFileInfo: MicrosoftFileInfo = {
      id: taskId,
      name: task.title,
      mimeType: 'planner/task',
      webViewLink: `https://tasks.office.com/planner/task/${taskId}`,
      createdTime: task.createdDateTime,
      modifiedTime: task.createdDateTime,
    }

    // Update internal state first to avoid race with list refetch
    setSelectedFileId(taskId)
    setSelectedFile(taskAsFileInfo)
    setSelectedTask(task)
    // Then propagate up
    onChange(taskId, taskAsFileInfo)
    onFileInfoChange?.(taskAsFileInfo)
    setOpen(false)
    setSearchQuery('')
  }

  // Keep internal selectedFileId in sync with the value prop (do not clear selectedFile; we'll resolve new metadata below)
  useEffect(() => {
    if (value !== selectedFileId) {
      setSelectedFileId(value)
    }
  }, [value, selectedFileId])

  // Track previous credential ID to detect changes
  const prevCredentialIdRef = useRef<string>('')

  // Clear selected file when credentials are removed or changed
  useEffect(() => {
    const prevCredentialId = prevCredentialIdRef.current
    prevCredentialIdRef.current = selectedCredentialId

    if (!selectedCredentialId) {
      // No credentials - clear everything
      if (selectedFile) {
        setSelectedFile(null)
        setSelectedFileId('')
        onChange('')
      }
    } else if (prevCredentialId && prevCredentialId !== selectedCredentialId) {
      // Credentials changed (not initial load) - clear file info to force refetch
      if (selectedFile) {
        setSelectedFile(null)
      }
    }
  }, [selectedCredentialId, selectedFile, onChange])

  // Fetch the selected file metadata once credentials are loaded or changed
  useEffect(() => {
    // Fetch metadata when the external value doesn't match our current selectedFile
    if (
      value &&
      selectedCredentialId &&
      credentialsLoaded &&
      (!selectedFile || selectedFile.id !== value) &&
      !isLoadingSelectedFile
    ) {
      if (serviceId === 'microsoft-planner') {
        void fetchPlannerTaskById(value)
      } else {
        fetchFileById(value)
      }
    }
  }, [
    value,
    selectedCredentialId,
    credentialsLoaded,
    selectedFile,
    isLoadingSelectedFile,
    fetchFileById,
    fetchPlannerTaskById,
    serviceId,
  ])

  // Resolve planner task selection for collaborators
  useEffect(() => {
    if (
      value &&
      selectedCredentialId &&
      credentialsLoaded &&
      !selectedTask &&
      serviceId === 'microsoft-planner'
    ) {
      void fetchPlannerTaskById(value)
    }
  }, [
    value,
    selectedCredentialId,
    credentialsLoaded,
    selectedTask,
    serviceId,
    fetchPlannerTaskById,
  ])

  // Handle selecting a file from the available files
  const handleFileSelect = (file: MicrosoftFileInfo) => {
    setSelectedFileId(file.id)
    setSelectedFile(file)
    onChange(file.id, file)
    onFileInfoChange?.(file)
    setOpen(false)
    setSearchQuery('') // Clear search when file is selected
  }

  // Handle adding a new credential
  const handleAddCredential = () => {
    // Show the OAuth modal
    setShowOAuthModal(true)
    setOpen(false)
    setSearchQuery('') // Clear search when closing
  }

  // Clear selection
  const handleClearSelection = () => {
    setSelectedFileId('')
    setSelectedFile(null)
    onChange('', undefined)
    onFileInfoChange?.(null)
  }

  // Get provider icon
  const getProviderIcon = (providerName: OAuthProvider) => {
    const { baseProvider } = parseProvider(providerName)
    const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

    if (!baseProviderConfig) {
      return <ExternalLink className='h-4 w-4' />
    }

    // Handle OneDrive specifically by checking serviceId
    if (baseProvider === 'microsoft' && serviceId === 'onedrive') {
      const onedriveService = baseProviderConfig.services.onedrive
      if (onedriveService) {
        return onedriveService.icon({ className: 'h-4 w-4' })
      }
    }

    // Handle SharePoint specifically by checking serviceId
    if (baseProvider === 'microsoft' && serviceId === 'sharepoint') {
      const sharepointService = baseProviderConfig.services.sharepoint
      if (sharepointService) {
        return sharepointService.icon({ className: 'h-4 w-4' })
      }
    }

    // For compound providers, find the specific service
    if (providerName.includes('-')) {
      for (const service of Object.values(baseProviderConfig.services)) {
        if (service.providerId === providerName) {
          return service.icon({ className: 'h-4 w-4' })
        }
      }
    }

    // Fallback to base provider icon
    return baseProviderConfig.icon({ className: 'h-4 w-4' })
  }

  // Get provider name
  const getProviderName = (providerName: OAuthProvider) => {
    const effectiveServiceId = getServiceId()
    try {
      // First try to get the service by provider and service ID
      const service = getServiceByProviderAndId(providerName, effectiveServiceId)
      return service.name
    } catch (_error) {
      // If that fails, try to get the service by parsing the provider
      try {
        const { baseProvider } = parseProvider(providerName)
        const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

        // For compound providers like 'google-drive', try to find the specific service
        if (providerName.includes('-')) {
          const serviceKey = providerName.split('-')[1] || ''
          for (const [key, service] of Object.entries(baseProviderConfig?.services || {})) {
            if (key === serviceKey || key === providerName || service.providerId === providerName) {
              return service.name
            }
          }
        }

        // Fallback to provider name if service not found
        if (baseProviderConfig) {
          return baseProviderConfig.name
        }
      } catch (_parseError) {
        // Ignore parse error and continue to final fallback
      }

      // Final fallback: capitalize the provider name
      return providerName
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
    }
  }

  // Get file icon based on mime type
  const getFileIcon = (file: MicrosoftFileInfo, size: 'sm' | 'md' = 'sm') => {
    const iconSize = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'

    if (file.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      return <MicrosoftExcelIcon className={`${iconSize} text-green-600`} />
    }
    if (file.mimeType === 'planner/task') {
      return getProviderIcon(provider)
    }
    // if (file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    //   return <FileIcon className={`${iconSize} text-blue-600`} />
    // }
    // if (file.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    //   return <FileIcon className={`${iconSize} text-orange-600`} />
    // }
    // return <FileIcon className={`${iconSize} text-muted-foreground`} />
  }

  // Handle search input changes
  const handleSearch = (query: string) => {
    setSearchQuery(query)
  }

  const getFileTypeTitleCase = () => {
    if (serviceId === 'onedrive') return 'Folders'
    if (serviceId === 'sharepoint') return 'Sites'
    if (serviceId === 'microsoft-planner') return 'Tasks'
    return 'Excel Files'
  }

  const getSearchPlaceholder = () => {
    if (serviceId === 'onedrive') return 'Search OneDrive folders...'
    if (serviceId === 'sharepoint') return 'Search SharePoint sites...'
    if (serviceId === 'microsoft-planner') return 'Search tasks...'
    return 'Search Excel files...'
  }

  const getEmptyStateText = () => {
    if (serviceId === 'onedrive') {
      return {
        title: 'No folders found.',
        description: 'No folders were found in your OneDrive.',
      }
    }
    if (serviceId === 'sharepoint') {
      return {
        title: 'No sites found.',
        description: 'No SharePoint sites were found.',
      }
    }
    if (serviceId === 'microsoft-planner') {
      return {
        title: 'No tasks found.',
        description: 'No tasks were found in this plan.',
      }
    }
    return {
      title: 'No Excel files found.',
      description: 'No .xlsx files were found in your OneDrive.',
    }
  }

  // Filter tasks based on search query for planner
  const filteredTasks: SelectableItem[] =
    serviceId === 'microsoft-planner'
      ? plannerTasks.filter((task) => {
          const title = task.title || ''
          const query = searchQuery || ''
          return title.toLowerCase().includes(query.toLowerCase())
        })
      : availableFiles

  const canShowPreview = !!(
    showPreview &&
    selectedFile &&
    selectedFileId &&
    selectedFile.id === selectedFileId
  )

  return (
    <>
      <div className='space-y-2'>
        <Popover
          open={open}
          onOpenChange={(isOpen) => {
            setOpen(isOpen)
            if (!isOpen) {
              setSearchQuery('')
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant='outline'
              role='combobox'
              aria-expanded={open}
              className='h-10 w-full min-w-0 justify-between'
              disabled={
                disabled || isForeignCredential || (serviceId === 'microsoft-planner' && !planId)
              }
            >
              <div className='flex min-w-0 items-center gap-2 overflow-hidden'>
                {canShowPreview ? (
                  <>
                    {getFileIcon(selectedFile, 'sm')}
                    <span className='truncate font-normal'>{selectedFile.name}</span>
                  </>
                ) : selectedFileId && isLoadingSelectedFile && selectedCredentialId ? (
                  <>
                    <RefreshCw className='h-4 w-4 animate-spin' />
                    <span className='truncate text-muted-foreground'>Loading document...</span>
                  </>
                ) : (
                  <>
                    {getProviderIcon(provider)}
                    <span className='truncate text-muted-foreground'>{label}</span>
                  </>
                )}
              </div>
              <ChevronDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
            </Button>
          </PopoverTrigger>
          {!isForeignCredential && (
            <PopoverContent className='w-[300px] p-0' align='start'>
              {/* Current account indicator */}
              {selectedCredentialId && credentials.length > 0 && (
                <div className='flex items-center justify-between border-b px-3 py-2'>
                  <div className='flex items-center gap-2'>
                    {getProviderIcon(provider)}
                    <span className='text-muted-foreground text-xs'>
                      {credentials.find((cred) => cred.id === selectedCredentialId)?.name ||
                        'Unknown'}
                    </span>
                  </div>
                  {credentials.length > 1 && (
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-6 px-2 text-xs'
                      onClick={() => setOpen(true)}
                    >
                      Switch
                    </Button>
                  )}
                </div>
              )}

              <Command>
                <CommandInput placeholder={getSearchPlaceholder()} onValueChange={handleSearch} />
                <CommandList>
                  <CommandEmpty>
                    {isLoading || isLoadingFiles || isLoadingTasks ? (
                      <div className='flex items-center justify-center p-4'>
                        <RefreshCw className='h-4 w-4 animate-spin' />
                        <span className='ml-2'>Loading...</span>
                      </div>
                    ) : credentials.length === 0 ? (
                      <div className='p-4 text-center'>
                        <p className='font-medium text-sm'>No accounts connected.</p>
                        <p className='text-muted-foreground text-xs'>
                          Connect a {getProviderName(provider)} account to continue.
                        </p>
                      </div>
                    ) : serviceId === 'microsoft-planner' && !planId ? (
                      <div className='p-4 text-center'>
                        <p className='font-medium text-sm'>Plan ID required.</p>
                        <p className='text-muted-foreground text-xs'>
                          Please enter a Plan ID first to see tasks.
                        </p>
                      </div>
                    ) : filteredTasks.length === 0 ? (
                      <div className='p-4 text-center'>
                        <p className='font-medium text-sm'>{getEmptyStateText().title}</p>
                        <p className='text-muted-foreground text-xs'>
                          {getEmptyStateText().description}
                        </p>
                      </div>
                    ) : null}
                  </CommandEmpty>

                  {/* Account selection - only show if we have multiple accounts */}
                  {credentials.length > 1 && (
                    <CommandGroup>
                      <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>
                        Switch Account
                      </div>
                      {credentials.map((cred) => (
                        <CommandItem
                          key={cred.id}
                          value={`account-${cred.id}`}
                          onSelect={() => setSelectedCredentialId(cred.id)}
                        >
                          <div className='flex items-center gap-2'>
                            {getProviderIcon(cred.provider)}
                            <span className='font-normal'>{cred.name}</span>
                          </div>
                          {cred.id === selectedCredentialId && (
                            <Check className='ml-auto h-4 w-4' />
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}

                  {/* Available files/tasks - only show if we have credentials and items */}
                  {credentials.length > 0 && selectedCredentialId && filteredTasks.length > 0 && (
                    <CommandGroup>
                      <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>
                        {getFileTypeTitleCase()}
                      </div>
                      {filteredTasks.map((item) => {
                        const isPlanner = serviceId === 'microsoft-planner'
                        const isPlannerTask = isPlanner && 'title' in item
                        const plannerTask = item as PlannerTask
                        const fileInfo = item as MicrosoftFileInfo

                        const displayName = isPlannerTask ? plannerTask.title : fileInfo.name
                        const dateField = isPlannerTask
                          ? plannerTask.createdDateTime
                          : fileInfo.createdTime

                        return (
                          <CommandItem
                            key={item.id}
                            value={`file-${item.id}-${displayName}`}
                            onSelect={() =>
                              isPlannerTask
                                ? handleTaskSelect(plannerTask)
                                : handleFileSelect(fileInfo)
                            }
                          >
                            <div className='flex items-center gap-2 overflow-hidden'>
                              {getFileIcon(
                                isPlannerTask
                                  ? {
                                      ...fileInfo,
                                      id: plannerTask.id || '',
                                      name: plannerTask.title,
                                      mimeType: 'planner/task',
                                    }
                                  : fileInfo,
                                'sm'
                              )}
                              <div className='min-w-0 flex-1'>
                                <span className='truncate font-normal'>{displayName}</span>
                                {dateField && (
                                  <div className='text-muted-foreground text-xs'>
                                    Modified {new Date(dateField).toLocaleDateString()}
                                  </div>
                                )}
                              </div>
                            </div>
                            {item.id === selectedFileId && <Check className='ml-auto h-4 w-4' />}
                          </CommandItem>
                        )
                      })}
                    </CommandGroup>
                  )}

                  {/* Connect account option - only show if no credentials */}
                  {credentials.length === 0 && (
                    <CommandGroup>
                      <CommandItem onSelect={handleAddCredential}>
                        <div className='flex items-center gap-2 text-primary'>
                          {getProviderIcon(provider)}
                          <span>Connect {getProviderName(provider)} account</span>
                        </div>
                      </CommandItem>
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          )}
        </Popover>

        {/* File preview */}
        {canShowPreview && (
          <div className='relative mt-2 rounded-md border border-muted bg-muted/10 p-2'>
            <div className='absolute top-2 right-2'>
              <Button
                variant='ghost'
                size='icon'
                className='h-5 w-5 hover:bg-muted'
                onClick={handleClearSelection}
              >
                <X className='h-3 w-3' />
              </Button>
            </div>
            <div className='flex items-center gap-3 pr-4'>
              <div className='flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-muted/20'>
                {getFileIcon(selectedFile, 'sm')}
              </div>
              <div className='min-w-0 flex-1 overflow-hidden'>
                <div className='flex items-center gap-2'>
                  <h4 className='truncate font-medium text-xs'>{selectedFile.name}</h4>
                  {selectedFile.modifiedTime && (
                    <span className='whitespace-nowrap text-muted-foreground text-xs'>
                      {new Date(selectedFile.modifiedTime).toLocaleDateString()}
                    </span>
                  )}
                </div>
                {selectedFile.webViewLink ? (
                  <a
                    href={selectedFile.webViewLink}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='flex items-center gap-1 text-primary text-xs hover:underline'
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>
                      {serviceId === 'microsoft-planner'
                        ? 'Open in Planner'
                        : serviceId === 'sharepoint'
                          ? 'Open in SharePoint'
                          : 'Open in OneDrive'}
                    </span>
                    <ExternalLink className='h-3 w-3' />
                  </a>
                ) : (
                  <a
                    href={`https://graph.microsoft.com/v1.0/me/drive/items/${selectedFile.id}`}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='flex items-center gap-1 text-primary text-xs hover:underline'
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>
                      {serviceId === 'sharepoint' ? 'Open in SharePoint' : 'Open in OneDrive'}
                    </span>
                    <ExternalLink className='h-3 w-3' />
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {showOAuthModal && (
        <OAuthRequiredModal
          isOpen={showOAuthModal}
          onClose={() => setShowOAuthModal(false)}
          provider={provider}
          toolName={getProviderName(provider)}
          requiredScopes={requiredScopes}
          serviceId={getServiceId()}
        />
      )}
    </>
  )
}
