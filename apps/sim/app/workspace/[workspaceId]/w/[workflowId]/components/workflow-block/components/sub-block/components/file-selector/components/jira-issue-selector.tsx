'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ExternalLink, RefreshCw, X } from 'lucide-react'
import { JiraIcon } from '@/components/icons'
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
import { Logger } from '@/lib/logs/console-logger'
import {
  type Credential,
  getProviderIdFromServiceId,
  getServiceIdFromScopes,
  type OAuthProvider,
} from '@/lib/oauth'
import { OAuthRequiredModal } from '../../credential-selector/components/oauth-required-modal'

const logger = new Logger('jira_issue_selector')

export interface JiraIssueInfo {
  id: string
  name: string
  mimeType: string
  webViewLink?: string
  modifiedTime?: string
  spaceId?: string
  url?: string
}

interface JiraIssueSelectorProps {
  value: string
  onChange: (value: string, issueInfo?: JiraIssueInfo) => void
  provider: OAuthProvider
  requiredScopes?: string[]
  label?: string
  disabled?: boolean
  serviceId?: string
  domain: string
  showPreview?: boolean
  onIssueInfoChange?: (issueInfo: JiraIssueInfo | null) => void
  projectId?: string
}

export function JiraIssueSelector({
  value,
  onChange,
  provider,
  requiredScopes = [],
  label = 'Select Jira issue',
  disabled = false,
  serviceId,
  domain,
  showPreview = true,
  onIssueInfoChange,
  projectId,
}: JiraIssueSelectorProps) {
  const [open, setOpen] = useState(false)
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [issues, setIssues] = useState<JiraIssueInfo[]>([])
  const [selectedCredentialId, setSelectedCredentialId] = useState<string>('')
  const [selectedIssueId, setSelectedIssueId] = useState(value)
  const [selectedIssue, setSelectedIssue] = useState<JiraIssueInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const initialFetchRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [cloudId, setCloudId] = useState<string | null>(null)

  // Handle search with debounce
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handleSearch = (value: string) => {
    // Clear any existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    // Set a new timeout
    searchTimeoutRef.current = setTimeout(() => {
      if (value.length >= 1) {
        // Changed from > 2 to >= 1 to be more responsive
        fetchIssues(value)
      } else {
        setIssues([]) // Clear issues if search is empty
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
      logger.error('Error fetching credentials:', error)
    } finally {
      setIsLoading(false)
    }
  }, [provider, getProviderId, selectedCredentialId])

  // Fetch issue info when we have a selected issue ID
  const fetchIssueInfo = useCallback(
    async (issueId: string) => {
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

        if (!accessToken) {
          throw new Error('No access token received')
        }

        // Use the access token to fetch the issue info
        const response = await fetch('/api/tools/jira/issue', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            domain,
            accessToken,
            issueId,
            cloudId,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          logger.error('Failed to fetch issue info:', errorData)
          throw new Error(errorData.error || 'Failed to fetch issue info')
        }

        const data = await response.json()
        if (data.cloudId) {
          logger.info('Using cloud ID:', data.cloudId)
          setCloudId(data.cloudId)
        }

        if (data.issue) {
          logger.info('Successfully fetched issue:', data.issue.name)
          setSelectedIssue(data.issue)
          onIssueInfoChange?.(data.issue)
        } else {
          logger.warn('No issue data received in response')
          setSelectedIssue(null)
          onIssueInfoChange?.(null)
        }
      } catch (error) {
        logger.error('Error fetching issue info:', error)
        setError((error as Error).message)
        // Clear selection on error to prevent infinite retry loops
        setSelectedIssue(null)
        onIssueInfoChange?.(null)
      } finally {
        setIsLoading(false)
      }
    },
    [selectedCredentialId, domain, onIssueInfoChange, cloudId]
  )

  // Fetch issues from Jira
  const fetchIssues = useCallback(
    async (searchQuery?: string) => {
      if (!selectedCredentialId || !domain) return

      // Validate domain format
      const trimmedDomain = domain.trim().toLowerCase()
      if (!trimmedDomain.includes('.')) {
        setError(
          'Invalid domain format. Please provide the full domain (e.g., your-site.atlassian.net)'
        )
        setIssues([])
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
          logger.error('Access token error:', errorData)

          // If there's a token error, we might need to reconnect the account
          setError('Authentication failed. Please reconnect your Jira account.')
          setIsLoading(false)
          return
        }

        const tokenData = await tokenResponse.json()
        const accessToken = tokenData.accessToken

        if (!accessToken) {
          logger.error('No access token returned')
          setError('Authentication failed. Please reconnect your Jira account.')
          setIsLoading(false)
          return
        }

        // Build query parameters for the issues endpoint
        const queryParams = new URLSearchParams({
          domain,
          accessToken,
          ...(projectId && { projectId }),
          ...(searchQuery && { query: searchQuery }),
          ...(cloudId && { cloudId }),
        })

        const response = await fetch(`/api/tools/jira/issues?${queryParams.toString()}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        })

        if (!response.ok) {
          const errorData = await response.json()
          logger.error('Jira API error:', errorData)
          throw new Error(errorData.error || 'Failed to fetch issues')
        }

        const data = await response.json()

        if (data.cloudId) {
          setCloudId(data.cloudId)
        }

        // Process the issue picker results
        let foundIssues: JiraIssueInfo[] = []

        // Handle the sections returned by the issue picker API
        if (data.sections) {
          // Combine issues from all sections
          data.sections.forEach((section: any) => {
            if (section.issues && section.issues.length > 0) {
              const sectionIssues = section.issues.map((issue: any) => ({
                id: issue.key,
                name: issue.summary || issue.summaryText || issue.key,
                mimeType: 'jira/issue',
                url: `https://${domain}/browse/${issue.key}`,
                webViewLink: `https://${domain}/browse/${issue.key}`,
              }))
              foundIssues = [...foundIssues, ...sectionIssues]
            }
          })
        }

        logger.info(`Received ${foundIssues.length} issues from API`)
        setIssues(foundIssues)

        // If we have a selected issue ID, find the issue info
        if (selectedIssueId) {
          const issueInfo = foundIssues.find((issue: JiraIssueInfo) => issue.id === selectedIssueId)
          if (issueInfo) {
            setSelectedIssue(issueInfo)
            onIssueInfoChange?.(issueInfo)
          } else if (!searchQuery && selectedIssueId) {
            // If we can't find the issue in the list, try to fetch it directly
            fetchIssueInfo(selectedIssueId)
          }
        }
      } catch (error) {
        logger.error('Error fetching issues:', error)
        setError((error as Error).message)
        setIssues([])
      } finally {
        setIsLoading(false)
      }
    },
    [
      selectedCredentialId,
      domain,
      selectedIssueId,
      onIssueInfoChange,
      fetchIssueInfo,
      cloudId,
      projectId,
    ]
  )

  // Fetch credentials on initial mount
  useEffect(() => {
    if (!initialFetchRef.current) {
      fetchCredentials()
      initialFetchRef.current = true
    }
  }, [fetchCredentials])

  // Handle open change
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)

    // Only fetch recent/default issues when opening the dropdown
    if (isOpen && selectedCredentialId && domain && domain.includes('.')) {
      fetchIssues('') // Pass empty string to get recent or default issues
    }
  }

  // Fetch selected issue metadata once credentials are ready or changed
  useEffect(() => {
    if (
      value &&
      selectedCredentialId &&
      domain &&
      domain.includes('.') &&
      (!selectedIssue || selectedIssue.id !== value)
    ) {
      fetchIssueInfo(value)
    }
  }, [value, selectedCredentialId, selectedIssue, domain, fetchIssueInfo])

  // Keep internal selectedIssueId in sync with the value prop
  useEffect(() => {
    if (value !== selectedIssueId) {
      setSelectedIssueId(value)
    }
  }, [value])

  // Handle issue selection
  const handleSelectIssue = (issue: JiraIssueInfo) => {
    setSelectedIssueId(issue.id)
    setSelectedIssue(issue)
    onChange(issue.id, issue)
    onIssueInfoChange?.(issue)
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
    setSelectedIssueId('')
    setSelectedIssue(null)
    setError(null) // Clear any existing errors
    onChange('', undefined)
    onIssueInfoChange?.(null)
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
                {selectedIssue ? (
                  <>
                    <JiraIcon className='h-4 w-4' />
                    <span className='truncate font-normal'>{selectedIssue.name}</span>
                  </>
                ) : (
                  <>
                    <JiraIcon className='h-4 w-4' />
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
                  <JiraIcon className='h-4 w-4' />
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
              <CommandInput placeholder='Search issues...' onValueChange={handleSearch} />
              <CommandList>
                <CommandEmpty>
                  {isLoading ? (
                    <div className='flex items-center justify-center p-4'>
                      <RefreshCw className='h-4 w-4 animate-spin' />
                      <span className='ml-2'>Loading issues...</span>
                    </div>
                  ) : error ? (
                    <div className='p-4 text-center'>
                      <p className='text-destructive text-sm'>{error}</p>
                    </div>
                  ) : credentials.length === 0 ? (
                    <div className='p-4 text-center'>
                      <p className='font-medium text-sm'>No accounts connected.</p>
                      <p className='text-muted-foreground text-xs'>
                        Connect a Jira account to continue.
                      </p>
                    </div>
                  ) : (
                    <div className='p-4 text-center'>
                      <p className='font-medium text-sm'>No issues found.</p>
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
                          <JiraIcon className='h-4 w-4' />
                          <span className='font-normal'>{cred.name}</span>
                        </div>
                        {cred.id === selectedCredentialId && <Check className='ml-auto h-4 w-4' />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {/* Issues list */}
                {issues.length > 0 && (
                  <CommandGroup>
                    <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>
                      Issues
                    </div>
                    {issues.map((issue) => (
                      <CommandItem
                        key={issue.id}
                        value={`issue-${issue.id}-${issue.name}`}
                        onSelect={() => handleSelectIssue(issue)}
                      >
                        <div className='flex items-center gap-2 overflow-hidden'>
                          <JiraIcon className='h-4 w-4' />
                          <span className='truncate font-normal'>{issue.name}</span>
                        </div>
                        {issue.id === selectedIssueId && <Check className='ml-auto h-4 w-4' />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {/* Connect account option - only show if no credentials */}
                {credentials.length === 0 && (
                  <CommandGroup>
                    <CommandItem onSelect={handleAddCredential}>
                      <div className='flex items-center gap-2 text-primary'>
                        <JiraIcon className='h-4 w-4' />
                        <span>Connect Jira account</span>
                      </div>
                    </CommandItem>
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Issue preview */}
        {showPreview && selectedIssue && (
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
                <JiraIcon className='h-4 w-4' />
              </div>
              <div className='min-w-0 flex-1 overflow-hidden'>
                <div className='flex items-center gap-2'>
                  <h4 className='truncate font-medium text-xs'>{selectedIssue.name}</h4>
                  {selectedIssue.modifiedTime && (
                    <span className='whitespace-nowrap text-muted-foreground text-xs'>
                      {new Date(selectedIssue.modifiedTime).toLocaleDateString()}
                    </span>
                  )}
                </div>
                {selectedIssue.webViewLink ? (
                  <a
                    href={selectedIssue.webViewLink}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='flex items-center gap-1 text-primary text-xs hover:underline'
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>Open in Jira</span>
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
          toolName='Jira'
          requiredScopes={requiredScopes}
          serviceId={getServiceId()}
        />
      )}
    </>
  )
}
