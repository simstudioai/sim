'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ExternalLink, RefreshCw, X } from 'lucide-react'
import { ConfluenceIcon } from '@/components/icons'
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
import {
  type Credential,
  getProviderIdFromServiceId,
  getServiceIdFromScopes,
  type OAuthProvider,
} from '@/lib/oauth'
import { OAuthRequiredModal } from '../../credential-selector/components/oauth-required-modal'

export interface ConfluenceFileInfo {
  id: string
  name: string
  mimeType: string
  webViewLink?: string
  modifiedTime?: string
  spaceId?: string
  url?: string
}

interface ConfluenceFileSelectorProps {
  value: string
  onChange: (value: string, fileInfo?: ConfluenceFileInfo) => void
  provider: OAuthProvider
  requiredScopes?: string[]
  label?: string
  disabled?: boolean
  serviceId?: string
  domain: string
  showPreview?: boolean
  onFileInfoChange?: (fileInfo: ConfluenceFileInfo | null) => void
}

export function ConfluenceFileSelector({
  value,
  onChange,
  provider,
  requiredScopes = [],
  label = 'Select Confluence page',
  disabled = false,
  serviceId,
  domain,
  showPreview = true,
  onFileInfoChange,
}: ConfluenceFileSelectorProps) {
  const [open, setOpen] = useState(false)
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [files, setFiles] = useState<ConfluenceFileInfo[]>([])
  const [selectedCredentialId, setSelectedCredentialId] = useState<string>('')
  const [selectedFileId, setSelectedFileId] = useState(value)
  const [selectedFile, setSelectedFile] = useState<ConfluenceFileInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const initialFetchRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  // Handle search with debounce
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handleSearch = (value: string) => {
    // Clear any existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    // Set a new timeout
    searchTimeoutRef.current = setTimeout(() => {
      if (value.length > 2) {
        fetchFiles(value)
      } else if (value.length === 0) {
        fetchFiles()
      }
    }, 500) // 500ms debounce
  }

  // Clean up the timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [])

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
    try {
      const providerId = getProviderId()
      const response = await fetch(`/api/auth/oauth/credentials?provider=${providerId}`)

      if (response.ok) {
        const data = await response.json()
        setCredentials(data.credentials)

        // Auto-select logic for credentials
        if (data.credentials.length > 0) {
          // If we already have a selected credential ID, check if it's valid
          if (
            selectedCredentialId &&
            data.credentials.some((cred: Credential) => cred.id === selectedCredentialId)
          ) {
            // Keep the current selection
          } else {
            // Otherwise, select the default or first credential
            const defaultCred = data.credentials.find((cred: Credential) => cred.isDefault)
            if (defaultCred) {
              setSelectedCredentialId(defaultCred.id)
            } else if (data.credentials.length === 1) {
              setSelectedCredentialId(data.credentials[0].id)
            }
          }
        }
      }
    } catch (error) {
      console.error('Error fetching credentials:', error)
    } finally {
      setIsLoading(false)
    }
  }, [provider, getProviderId, selectedCredentialId])

  // Fetch page info when we have a selected file ID
  const fetchPageInfo = useCallback(
    async (pageId: string) => {
      if (!selectedCredentialId || !domain) return

      // Validate domain format
      const trimmedDomain = domain.trim().toLowerCase()
      if (!trimmedDomain.includes('.')) {
        setError(
          'Invalid domain format. Please provide the full domain (e.g., your-site.atlassian.net)'
        )
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        // Get the access token from the selected credential
        const tokenResponse = await fetch('/api/auth/oauth/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            credentialId: selectedCredentialId,
          }),
        })

        if (!tokenResponse.ok) {
          const errorData = await tokenResponse.json()
          throw new Error(errorData.error || 'Failed to get access token')
        }

        const tokenData = await tokenResponse.json()
        const accessToken = tokenData.accessToken

        // Use the access token to fetch the page info
        const response = await fetch('/api/tools/confluence/page', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            domain,
            accessToken,
            pageId,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to fetch page info')
        }

        const data = await response.json()
        if (data.file) {
          setSelectedFile(data.file)
          onFileInfoChange?.(data.file)
        }
      } catch (error) {
        console.error('Error fetching page info:', error)
        setError((error as Error).message)
      } finally {
        setIsLoading(false)
      }
    },
    [selectedCredentialId, domain, onFileInfoChange]
  )

  // Fetch pages from Confluence
  const fetchFiles = useCallback(
    async (searchQuery?: string) => {
      if (!selectedCredentialId || !domain) return

      // Validate domain format
      const trimmedDomain = domain.trim().toLowerCase()
      if (!trimmedDomain.includes('.')) {
        setError(
          'Invalid domain format. Please provide the full domain (e.g., your-site.atlassian.net)'
        )
        setFiles([])
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        // Get the access token from the selected credential
        const tokenResponse = await fetch('/api/auth/oauth/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            credentialId: selectedCredentialId,
          }),
        })

        if (!tokenResponse.ok) {
          const errorData = await tokenResponse.json()
          console.error('Access token error:', errorData)

          // If there's a token error, we might need to reconnect the account
          setError('Authentication failed. Please reconnect your Confluence account.')
          setIsLoading(false)
          return
        }

        const tokenData = await tokenResponse.json()
        const accessToken = tokenData.accessToken

        if (!accessToken) {
          console.error('No access token returned')
          setError('Authentication failed. Please reconnect your Confluence account.')
          setIsLoading(false)
          return
        }

        // Simply fetch pages directly using the endpoint
        const response = await fetch('/api/tools/confluence/pages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            domain,
            accessToken,
            title: searchQuery || undefined,
            limit: 50,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          console.error('Confluence API error:', errorData)
          throw new Error(errorData.error || 'Failed to fetch pages')
        }

        const data = await response.json()
        console.log(`Received ${data.files?.length || 0} files from API`)
        setFiles(data.files || [])

        // If we have a selected file ID, find the file info
        if (selectedFileId) {
          const fileInfo = data.files.find((file: ConfluenceFileInfo) => file.id === selectedFileId)
          if (fileInfo) {
            setSelectedFile(fileInfo)
            onFileInfoChange?.(fileInfo)
          } else if (!searchQuery && selectedFileId) {
            // If we can't find the file in the list, try to fetch it directly
            fetchPageInfo(selectedFileId)
          }
        }
      } catch (error) {
        console.error('Error fetching pages:', error)
        setError((error as Error).message)
        setFiles([])
      } finally {
        setIsLoading(false)
      }
    },
    [selectedCredentialId, domain, selectedFileId, onFileInfoChange, fetchPageInfo]
  )

  // Fetch credentials on initial mount
  useEffect(() => {
    if (!initialFetchRef.current) {
      fetchCredentials()
      initialFetchRef.current = true
    }
  }, [fetchCredentials])

  // Only fetch files when the dropdown is opened, not on credential selection
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)

    // Only fetch files when opening the dropdown and if we have valid credentials and domain
    if (isOpen && selectedCredentialId && domain && domain.includes('.')) {
      fetchFiles()
    }
  }

  // Fetch the selected page metadata once credentials and domain are ready or changed
  useEffect(() => {
    if (value && selectedCredentialId && !selectedFile && domain && domain.includes('.')) {
      fetchPageInfo(value)
    }
  }, [value, selectedCredentialId, selectedFile, domain, fetchPageInfo])

  // Keep internal selectedFileId in sync with the value prop
  useEffect(() => {
    if (value !== selectedFileId) {
      setSelectedFileId(value)
    }
  }, [value])

  // Handle file selection
  const handleSelectFile = (file: ConfluenceFileInfo) => {
    setSelectedFileId(file.id)
    setSelectedFile(file)
    onChange(file.id, file)
    onFileInfoChange?.(file)
    setOpen(false)
  }

  // Handle adding a new credential
  const handleAddCredential = () => {
    // Show the OAuth modal
    setShowOAuthModal(true)
    setOpen(false)
  }

  // Clear selection
  const handleClearSelection = () => {
    setSelectedFileId('')
    setSelectedFile(null)
    onChange('', undefined)
    onFileInfoChange?.(null)
  }

  return (
    <>
      <div className='space-y-2'>
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <Button
              variant='outline'
              role='combobox'
              aria-expanded={open}
              className='h-10 w-full min-w-0 justify-between'
              disabled={disabled || !domain}
            >
              <div className='flex min-w-0 items-center gap-2 overflow-hidden'>
                {selectedFile ? (
                  <>
                    <ConfluenceIcon className='h-4 w-4' />
                    <span className='truncate font-normal'>{selectedFile.name}</span>
                  </>
                ) : (
                  <>
                    <ConfluenceIcon className='h-4 w-4' />
                    <span className='truncate text-muted-foreground'>{label}</span>
                  </>
                )}
              </div>
              <ChevronDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
            </Button>
          </PopoverTrigger>
          <PopoverContent className='w-[300px] p-0' align='start'>
            {/* Current account indicator */}
            {selectedCredentialId && credentials.length > 0 && (
              <div className='flex items-center justify-between border-b px-3 py-2'>
                <div className='flex items-center gap-2'>
                  <ConfluenceIcon className='h-4 w-4' />
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
              <CommandInput placeholder='Search pages...' onValueChange={handleSearch} />
              <CommandList>
                <CommandEmpty>
                  {isLoading ? (
                    <div className='flex items-center justify-center p-4'>
                      <RefreshCw className='h-4 w-4 animate-spin' />
                      <span className='ml-2'>Loading pages...</span>
                    </div>
                  ) : error ? (
                    <div className='p-4 text-center'>
                      <p className='text-destructive text-sm'>{error}</p>
                    </div>
                  ) : credentials.length === 0 ? (
                    <div className='p-4 text-center'>
                      <p className='font-medium text-sm'>No accounts connected.</p>
                      <p className='text-muted-foreground text-xs'>
                        Connect a Confluence account to continue.
                      </p>
                    </div>
                  ) : (
                    <div className='p-4 text-center'>
                      <p className='font-medium text-sm'>No pages found.</p>
                      <p className='text-muted-foreground text-xs'>
                        Try a different search or account.
                      </p>
                    </div>
                  )}
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
                          <ConfluenceIcon className='h-4 w-4' />
                          <span className='font-normal'>{cred.name}</span>
                        </div>
                        {cred.id === selectedCredentialId && <Check className='ml-auto h-4 w-4' />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {/* Files list */}
                {files.length > 0 && (
                  <CommandGroup>
                    <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>
                      Pages
                    </div>
                    {files.map((file) => (
                      <CommandItem
                        key={file.id}
                        value={`file-${file.id}-${file.name}`}
                        onSelect={() => handleSelectFile(file)}
                      >
                        <div className='flex items-center gap-2 overflow-hidden'>
                          <ConfluenceIcon className='h-4 w-4' />
                          <span className='truncate font-normal'>{file.name}</span>
                        </div>
                        {file.id === selectedFileId && <Check className='ml-auto h-4 w-4' />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {/* Connect account option - only show if no credentials */}
                {credentials.length === 0 && (
                  <CommandGroup>
                    <CommandItem onSelect={handleAddCredential}>
                      <div className='flex items-center gap-2 text-primary'>
                        <ConfluenceIcon className='h-4 w-4' />
                        <span>Connect Confluence account</span>
                      </div>
                    </CommandItem>
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* File preview */}
        {showPreview && selectedFile && (
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
                <ConfluenceIcon className='h-4 w-4' />
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
                    <span>Open in Confluence</span>
                    <ExternalLink className='h-3 w-3' />
                  </a>
                ) : (
                  <></>
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
          toolName='Confluence'
          requiredScopes={requiredScopes}
          serviceId={getServiceId()}
        />
      )}
    </>
  )
}
