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
import {
  Credential,
  getProviderIdFromServiceId,
  getServiceIdFromScopes,
  OAuthProvider,
} from '@/lib/oauth'
import { saveToStorage } from '@/stores/workflows/persistence'
import { OAuthRequiredModal } from '../../credential-selector/components/oauth-required-modal'
import { Logger } from '@/lib/logs/console-logger'

const logger = new Logger('jira_project_selector')

export interface JiraProjectInfo {
  id: string
  key: string
  name: string
  url?: string
  avatarUrl?: string
  description?: string
  projectTypeKey?: string
  simplified?: boolean
  style?: string
  isPrivate?: boolean
}

interface JiraProjectSelectorProps {
  value: string
  onChange: (value: string, projectInfo?: JiraProjectInfo) => void
  provider: OAuthProvider
  requiredScopes?: string[]
  label?: string
  disabled?: boolean
  serviceId?: string
  domain: string
  showPreview?: boolean
  onProjectInfoChange?: (projectInfo: JiraProjectInfo | null) => void
}

export function JiraProjectSelector({
  value,
  onChange,
  provider,
  requiredScopes = [],
  label = 'Select Jira project',
  disabled = false,
  serviceId,
  domain,
  showPreview = true,
  onProjectInfoChange,
}: JiraProjectSelectorProps) {
  const [open, setOpen] = useState(false)
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [projects, setProjects] = useState<JiraProjectInfo[]>([])
  const [selectedCredentialId, setSelectedCredentialId] = useState<string>('')
  const [selectedProjectId, setSelectedProjectId] = useState(value)
  const [selectedProject, setSelectedProject] = useState<JiraProjectInfo | null>(null)
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
        fetchProjects(value)
      } else {
        fetchProjects() // Fetch all projects if no search term
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

  // Fetch detailed project information
  const fetchProjectInfo = useCallback(
    async (projectId: string) => {
      if (!selectedCredentialId || !domain || !projectId) return

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
          setError('Authentication failed. Please reconnect your Jira account.')
          return
        }

        const tokenData = await tokenResponse.json()
        const accessToken = tokenData.accessToken

        if (!accessToken) {
          logger.error('No access token returned')
          setError('Authentication failed. Please reconnect your Jira account.')
          return
        }

        // Build query parameters for the project endpoint
        const queryParams = new URLSearchParams({
          domain,
          accessToken,
          projectId,
          ...(cloudId && { cloudId })
        })

        const response = await fetch(`/api/auth/oauth/jira/project?${queryParams.toString()}`)

        if (!response.ok) {
          const errorData = await response.json()
          logger.error('Jira API error:', errorData)
          throw new Error(errorData.error || 'Failed to fetch project details')
        }

        const projectInfo = await response.json()
        
        if (projectInfo.cloudId) {
          setCloudId(projectInfo.cloudId)
        }

        setSelectedProject(projectInfo)
        onProjectInfoChange?.(projectInfo)
      } catch (error) {
        logger.error('Error fetching project details:', error)
        setError((error as Error).message)
      } finally {
        setIsLoading(false)
      }
    },
    [selectedCredentialId, domain, onProjectInfoChange, cloudId]
  )

  // Fetch projects from Jira
  const fetchProjects = useCallback(
    async (searchQuery?: string) => {
      if (!selectedCredentialId || !domain) return

      // Validate domain format
      const trimmedDomain = domain.trim().toLowerCase()
      if (!trimmedDomain.includes('.')) {
        setError(
          'Invalid domain format. Please provide the full domain (e.g., your-site.atlassian.net)'
        )
        setProjects([])
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

        // Build query parameters for the projects endpoint
        const queryParams = new URLSearchParams({
          domain,
          accessToken,
          ...(searchQuery && { query: searchQuery }),
          ...(cloudId && { cloudId })
        })

        // Use the GET endpoint for project search
        const response = await fetch(`/api/auth/oauth/jira/projects?${queryParams.toString()}`)

        if (!response.ok) {
          const errorData = await response.json()
          logger.error('Jira API error:', errorData)
          throw new Error(errorData.error || 'Failed to fetch projects')
        }

        const data = await response.json()
        
        if (data.cloudId) {
          setCloudId(data.cloudId)
        }

        // Process the projects results
        const foundProjects = data.projects || []
        logger.info(`Received ${foundProjects.length} projects from API`)
        setProjects(foundProjects)

        // If we have a selected project ID, find the project info
        if (selectedProjectId) {
          const projectInfo = foundProjects.find(
            (project: JiraProjectInfo) => project.id === selectedProjectId
          )
          if (projectInfo) {
            setSelectedProject(projectInfo)
            onProjectInfoChange?.(projectInfo)
          } else if (!searchQuery && selectedProjectId) {
            // If we can't find the project in the list, try to fetch it directly
            fetchProjectInfo(selectedProjectId)
          }
        }
      } catch (error) {
        logger.error('Error fetching projects:', error)
        setError((error as Error).message)
        setProjects([])
      } finally {
        setIsLoading(false)
      }
    },
    [selectedCredentialId, domain, selectedProjectId, onProjectInfoChange, fetchProjectInfo, cloudId]
  )

  // Fetch credentials on initial mount
  useEffect(() => {
    if (!initialFetchRef.current) {
      fetchCredentials()
      initialFetchRef.current = true
    }
  }, [fetchCredentials])

  // Update selected project when value changes externally 
  useEffect(() => {
    if (value !== selectedProjectId) {
      setSelectedProjectId(value)

      // Only fetch project info if we have a valid value
      if (value && value.trim() !== '') {
        // Find project info if we have projects loaded
        if (projects.length > 0) {
          const projectInfo = projects.find((project) => project.id === value) || null
          setSelectedProject(projectInfo)
          onProjectInfoChange?.(projectInfo)
        } else if (!selectedProject && selectedCredentialId && domain && domain.includes('.')) {
          // If we don't have projects loaded yet but have a value, try to fetch the project info
          fetchProjectInfo(value)
        }
      } else {
        // If value is empty or undefined, clear the selection without triggering API calls
        setSelectedProject(null)
        onProjectInfoChange?.(null)
      }
    }
  }, [value, projects, selectedProject, selectedCredentialId, domain, onProjectInfoChange, fetchProjectInfo])

  // Handle open change
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
    if (isOpen && selectedCredentialId && domain && domain.includes('.')) {
      fetchProjects('') // Pass empty string to get all projects
    }
  }

  // Handle project selection
  const handleSelectProject = (project: JiraProjectInfo) => {
    setSelectedProjectId(project.id)
    setSelectedProject(project)
    onChange(project.id, project)
    onProjectInfoChange?.(project)
    setOpen(false)
  }

  // Handle adding a new credential
  const handleAddCredential = () => {
    const effectiveServiceId = getServiceId()
    const providerId = getProviderId()

    // Store information about the required connection
    saveToStorage<string>('pending_service_id', effectiveServiceId)
    saveToStorage<string[]>('pending_oauth_scopes', requiredScopes)
    saveToStorage<string>('pending_oauth_return_url', window.location.href)
    saveToStorage<string>('pending_oauth_provider_id', providerId)

    // Show the OAuth modal
    setShowOAuthModal(true)
    setOpen(false)
  }

  // Clear selection
  const handleClearSelection = () => {
    setSelectedProjectId('')
    setSelectedProject(null)
    setError(null)
    onChange('', undefined)
    onProjectInfoChange?.(null)
  }

  return (
    <>
      <div className="space-y-2">
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between"
              disabled={disabled || !domain}
            >
              {selectedProject ? (
                <div className="flex items-center gap-2 overflow-hidden">
                  <JiraIcon className="h-4 w-4" />
                  <span className="font-normal truncate">{selectedProject.name}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <JiraIcon className="h-4 w-4" />
                  <span className="text-muted-foreground">{label}</span>
                </div>
              )}
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-[300px]" align="start">
            {/* Current account indicator */}
            {selectedCredentialId && credentials.length > 0 && (
              <div className="px-3 py-2 border-b flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <JiraIcon className="h-4 w-4" />
                  <span className="text-xs text-muted-foreground">
                    {credentials.find((cred) => cred.id === selectedCredentialId)?.name ||
                      'Unknown'}
                  </span>
                </div>
                {credentials.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setOpen(true)}
                  >
                    Switch
                  </Button>
                )}
              </div>
            )}

            <Command>
              <CommandInput 
                placeholder="Search projects..." 
                onValueChange={handleSearch} 
              />
              <CommandList>
                <CommandEmpty>
                  {isLoading ? (
                    <div className="flex items-center justify-center p-4">
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span className="ml-2">Loading projects...</span>
                    </div>
                  ) : error ? (
                    <div className="p-4 text-center">
                      <p className="text-sm text-destructive">{error}</p>
                    </div>
                  ) : credentials.length === 0 ? (
                    <div className="p-4 text-center">
                      <p className="text-sm font-medium">No accounts connected.</p>
                      <p className="text-xs text-muted-foreground">
                        Connect a Jira account to continue.
                      </p>
                    </div>
                  ) : (
                    <div className="p-4 text-center">
                      <p className="text-sm font-medium">No projects found.</p>
                      <p className="text-xs text-muted-foreground">
                        Try a different search or account.
                      </p>
                    </div>
                  )}
                </CommandEmpty>

                {/* Account selection - only show if we have multiple accounts */}
                {credentials.length > 1 && (
                  <CommandGroup>
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      Switch Account
                    </div>
                    {credentials.map((cred) => (
                      <CommandItem
                        key={cred.id}
                        value={`account-${cred.id}`}
                        onSelect={() => setSelectedCredentialId(cred.id)}
                      >
                        <div className="flex items-center gap-2">
                          <JiraIcon className="h-4 w-4" />
                          <span className="font-normal">{cred.name}</span>
                        </div>
                        {cred.id === selectedCredentialId && <Check className="ml-auto h-4 w-4" />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {/* Projects list */}
                {projects.length > 0 && (
                  <CommandGroup>
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      Projects
                    </div>
                    {projects.map((project) => (
                      <CommandItem
                        key={project.id}
                        value={`project-${project.id}-${project.name}`}
                        onSelect={() => handleSelectProject(project)}
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          {project.avatarUrl ? (
                            <img
                              src={project.avatarUrl}
                              alt={project.name}
                              className="h-4 w-4 rounded"
                            />
                          ) : (
                            <JiraIcon className="h-4 w-4" />
                          )}
                          <span className="font-normal truncate">{project.name}</span>
                        </div>
                        {project.id === selectedProjectId && <Check className="ml-auto h-4 w-4" />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {/* Connect account option - only show if no credentials */}
                {credentials.length === 0 && (
                  <CommandGroup>
                    <CommandItem onSelect={handleAddCredential}>
                      <div className="flex items-center gap-2 text-primary">
                        <JiraIcon className="h-4 w-4" />
                        <span>Connect Jira account</span>
                      </div>
                    </CommandItem>
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Project preview */}
        {showPreview && selectedProject && (
          <div className="mt-2 rounded-md border border-muted bg-muted/10 p-2 relative">
            <div className="absolute top-2 right-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 hover:bg-muted"
                onClick={handleClearSelection}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
            <div className="flex items-center gap-3 pr-4">
              <div className="flex-shrink-0 flex items-center justify-center h-6 w-6 bg-muted/20 rounded">
                {selectedProject.avatarUrl ? (
                  <img
                    src={selectedProject.avatarUrl}
                    alt={selectedProject.name}
                    className="h-4 w-4 rounded"
                  />
                ) : (
                  <JiraIcon className="h-4 w-4" />
                )}
              </div>
              <div className="overflow-hidden flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-medium truncate">{selectedProject.name}</h4>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {selectedProject.key}
                  </span>
                </div>
                {selectedProject.url && (
                  <a
                    href={selectedProject.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>Open in Jira</span>
                    <ExternalLink className="h-3 w-3" />
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
          toolName="Jira"
          requiredScopes={requiredScopes}
          serviceId={getServiceId()}
        />
      )}
    </>
  )
}
