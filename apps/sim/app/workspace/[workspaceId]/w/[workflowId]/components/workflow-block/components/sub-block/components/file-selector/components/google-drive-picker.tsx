'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, FileIcon, FolderIcon, RefreshCw, X } from 'lucide-react'
import useDrivePicker from 'react-google-drive-picker'
import { GoogleDocsIcon, GoogleSheetsIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { getEnv } from '@/lib/env'
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
import { useFetchAttemptGuard } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/hooks/use-fetch-attempt-guard'
import { OAuthRequiredModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components/credential-selector/components/oauth-required-modal'

const logger = createLogger('GoogleDrivePicker')

export interface FileInfo {
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

interface GoogleDrivePickerProps {
  value: string
  onChange: (value: string, fileInfo?: FileInfo) => void
  provider: OAuthProvider
  requiredScopes?: string[]
  label?: string
  disabled?: boolean
  serviceId?: string
  mimeTypeFilter?: string
  showPreview?: boolean
  onFileInfoChange?: (fileInfo: FileInfo | null) => void
  clientId: string
  apiKey: string
  credentialId?: string
  workflowId?: string
}

export function GoogleDrivePicker({
  value,
  onChange,
  provider,
  requiredScopes = [],
  label = 'Select file',
  disabled = false,
  serviceId,
  mimeTypeFilter,
  showPreview = true,
  onFileInfoChange,
  clientId,
  apiKey,
  credentialId,
  workflowId,
}: GoogleDrivePickerProps) {
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [selectedCredentialId, setSelectedCredentialId] = useState<string>('')
  const [selectedFileId, setSelectedFileId] = useState(value)
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingSelectedFile, setIsLoadingSelectedFile] = useState(false)
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const [credentialsLoaded, setCredentialsLoaded] = useState(false)
  const initialFetchRef = useRef(false)
  const { shouldAttempt, markAttempt, reset } = useFetchAttemptGuard()
  const [openPicker, _authResponse] = useDrivePicker()

  const getServiceId = (): string => {
    if (serviceId) return serviceId
    return getServiceIdFromScopes(provider, requiredScopes)
  }

  const getProviderId = (): string => {
    const effectiveServiceId = getServiceId()
    return getProviderIdFromServiceId(effectiveServiceId)
  }

  const fetchCredentials = useCallback(async () => {
    setIsLoading(true)
    setCredentialsLoaded(false)
    try {
      const providerId = getProviderId()
      const response = await fetch(`/api/auth/oauth/credentials?provider=${providerId}`)

      if (response.ok) {
        const data = await response.json()
        setCredentials(data.credentials)
      }
    } catch (error) {
      logger.error('Error fetching credentials:', { error })
    } finally {
      setIsLoading(false)
      setCredentialsLoaded(true)
    }
  }, [provider, getProviderId, selectedCredentialId])

  useEffect(() => {
    if (credentialId && credentialId !== selectedCredentialId) {
      setSelectedCredentialId(credentialId)
    }
  }, [credentialId, selectedCredentialId])

  const fetchFileById = useCallback(
    async (fileId: string) => {
      if (!selectedCredentialId || !fileId) return null

      setIsLoadingSelectedFile(true)
      try {
        const queryParams = new URLSearchParams({
          credentialId: selectedCredentialId,
          fileId: fileId,
        })
        if (workflowId) queryParams.set('workflowId', workflowId)

        const response = await fetch(`/api/tools/drive/file?${queryParams.toString()}`)

        if (response.ok) {
          const data = await response.json()
          if (data.file) {
            setSelectedFile(data.file)
            onFileInfoChange?.(data.file)
            return data.file
          }
        } else {
          const errorText = await response.text()
          logger.error('Error fetching file by ID:', { error: errorText })

          if (response.status === 404 || response.status === 403) {
            logger.info('File not accessible, clearing selection')
            setSelectedFileId('')
            onChange('')
            onFileInfoChange?.(null)
          }
        }
        return null
      } catch (error) {
        logger.error('Error fetching file by ID:', { error })
        return null
      } finally {
        setIsLoadingSelectedFile(false)
      }
    },
    [selectedCredentialId, onChange, onFileInfoChange]
  )

  useEffect(() => {
    if (!initialFetchRef.current) {
      fetchCredentials()
      initialFetchRef.current = true
    }
  }, [fetchCredentials])

  useEffect(() => {
    if (value !== selectedFileId) {
      const previousFileId = selectedFileId
      setSelectedFileId(value)

      if (previousFileId && previousFileId !== value && selectedFile) {
        setSelectedFile(null)
      }

      reset()
    }
  }, [value, selectedFileId, selectedFile])

  const prevCredentialIdRef = useRef<string>('')

  useEffect(() => {
    const prevCredentialId = prevCredentialIdRef.current
    prevCredentialIdRef.current = selectedCredentialId

    if (!selectedCredentialId) {
      if (selectedFile) {
        setSelectedFile(null)
        setSelectedFileId('')
        onChange('')
      }

      reset()
    } else if (prevCredentialId && prevCredentialId !== selectedCredentialId) {
      if (selectedFile) {
        setSelectedFile(null)
      }

      reset()
    }
  }, [selectedCredentialId, selectedFile, onChange])

  useEffect(() => {
    // Only fetch if we have both a file ID and credentials, credentials are loaded, but no file info yet
    if (
      value &&
      selectedCredentialId &&
      credentialsLoaded &&
      !selectedFile &&
      !isLoadingSelectedFile
    ) {
      const attemptKey = `${selectedCredentialId}:${value}`
      if (!shouldAttempt(attemptKey)) return
      markAttempt(attemptKey)
      fetchFileById(value)
    }
  }, [
    value,
    selectedCredentialId,
    credentialsLoaded,
    selectedFile,
    isLoadingSelectedFile,
    fetchFileById,
  ])

  const fetchAccessToken = async (credentialOverrideId?: string): Promise<string | null> => {
    const effectiveCredentialId = credentialOverrideId || selectedCredentialId
    if (!effectiveCredentialId) {
      logger.error('No credential ID selected for Google Drive Picker')
      return null
    }

    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: effectiveCredentialId, workflowId }),
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch access token: ${response.status}`)
      }

      const data = await response.json()
      return data.accessToken || null
    } catch (error) {
      logger.error('Error fetching access token:', { error })
      return null
    } finally {
      setIsLoading(false)
    }
  }

  const handleOpenPicker = async (credentialOverrideId?: string) => {
    try {
      const accessToken = await fetchAccessToken(credentialOverrideId)

      if (!accessToken) {
        logger.error('Failed to get access token for Google Drive Picker')
        return
      }

      const viewIdForMimeType = () => {
        if (mimeTypeFilter?.includes('folder')) {
          return 'FOLDERS'
        }
        if (mimeTypeFilter?.includes('spreadsheet')) {
          return 'SPREADSHEETS'
        }
        if (mimeTypeFilter?.includes('document')) {
          return 'DOCUMENTS'
        }
        return 'DOCS'
      }

      openPicker({
        clientId,
        developerKey: apiKey,
        viewId: viewIdForMimeType(),
        token: accessToken,
        showUploadView: true,
        showUploadFolders: true,
        supportDrives: true,
        multiselect: false,
        appId: getEnv('NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER'),

        setSelectFolderEnabled: !!mimeTypeFilter?.includes('folder'),
        callbackFunction: (data) => {
          if (data.action === 'picked') {
            const file = data.docs[0]
            if (file) {
              const fileInfo: FileInfo = {
                id: file.id,
                name: file.name,
                mimeType: file.mimeType,
                iconLink: file.iconUrl,
                webViewLink: file.url,

                thumbnailLink: file.iconUrl,
                modifiedTime: file.lastEditedUtc
                  ? new Date(file.lastEditedUtc).toISOString()
                  : undefined,
              }

              setSelectedFileId(file.id)
              setSelectedFile(fileInfo)
              onChange(file.id, fileInfo)
              onFileInfoChange?.(fileInfo)
            }
          }
        },
      })
    } catch (error) {
      logger.error('Error opening Google Drive Picker:', { error })
    }
  }

  const handleAddCredential = () => {
    setShowOAuthModal(true)
  }

  const handleClearSelection = () => {
    setSelectedFileId('')
    setSelectedFile(null)
    onChange('', undefined)
    onFileInfoChange?.(null)
  }

  const getProviderIcon = (providerName: OAuthProvider) => {
    const { baseProvider } = parseProvider(providerName)
    const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

    if (!baseProviderConfig) {
      return <ExternalLink className='h-4 w-4' />
    }

    if (providerName.includes('-')) {
      for (const service of Object.values(baseProviderConfig.services)) {
        if (service.providerId === providerName) {
          return service.icon({ className: 'h-4 w-4' })
        }
      }
    }

    return baseProviderConfig.icon({ className: 'h-4 w-4' })
  }

  const getProviderName = (providerName: OAuthProvider) => {
    const effectiveServiceId = getServiceId()
    try {
      const service = getServiceByProviderAndId(providerName, effectiveServiceId)
      return service.name
    } catch (_error) {
      try {
        const { baseProvider } = parseProvider(providerName)
        const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

        if (providerName.includes('-')) {
          const serviceKey = providerName.split('-')[1] || ''
          for (const [key, service] of Object.entries(baseProviderConfig?.services || {})) {
            if (key === serviceKey || key === providerName || service.providerId === providerName) {
              return service.name
            }
          }
        }

        if (baseProviderConfig) {
          return baseProviderConfig.name
        }
      } catch (_parseError) {}

      return providerName
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
    }
  }

  const getFileIcon = (file: FileInfo, size: 'sm' | 'md' = 'sm') => {
    const iconSize = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'

    if (file.mimeType === 'application/vnd.google-apps.folder') {
      return <FolderIcon className={`${iconSize} text-muted-foreground`} />
    }
    if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
      return <GoogleSheetsIcon className={iconSize} />
    }
    if (file.mimeType === 'application/vnd.google-apps.document') {
      return <GoogleDocsIcon className={iconSize} />
    }
    return <FileIcon className={`${iconSize} text-muted-foreground`} />
  }

  const canShowPreview = !!(
    showPreview &&
    selectedFile &&
    selectedFileId &&
    selectedFile.id === selectedFileId
  )

  return (
    <>
      <div className='space-y-2'>
        <Button
          variant='outline'
          role='combobox'
          className='h-10 w-full min-w-0 justify-between'
          disabled={disabled || isLoading}
          onClick={async () => {
            let idToUse = selectedCredentialId
            if (!idToUse && credentials.length === 1) {
              idToUse = credentials[0].id
              setSelectedCredentialId(idToUse)
            }

            if (!idToUse) {
              handleAddCredential()
              return
            }

            await handleOpenPicker(idToUse)
          }}
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
        </Button>

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
                    className='flex items-center gap-1 text-muted-foreground text-xs hover:underline'
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>Open in Drive</span>
                    <ExternalLink className='h-3 w-3' />
                  </a>
                ) : (
                  <a
                    href={`https://drive.google.com/file/d/${selectedFile.id}/view`}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='flex items-center gap-1 text-muted-foreground text-xs hover:underline'
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>Open in Drive</span>
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
