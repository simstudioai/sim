'use client'

import { useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  ArrowLeft,
  ChartNoAxesColumn,
  ChevronDown,
  Globe,
  Linkedin,
  Mail,
  Star,
  User,
} from 'lucide-react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import { Button } from '@/components/emcn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import type { CredentialRequirement } from '@/lib/workflows/credential-extractor'
import type { Template } from '@/app/templates/templates'
import { WorkflowPreview } from '@/app/workspace/[workspaceId]/w/components/workflow-preview/workflow-preview'
import { getBlock } from '@/blocks/registry'

const logger = createLogger('TemplateDetails')

interface TemplateDetailsProps {
  isWorkspaceContext?: boolean
}

export default function TemplateDetails({ isWorkspaceContext = false }: TemplateDetailsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const params = useParams()
  const templateId = params?.id as string
  const workspaceId = isWorkspaceContext ? (params?.workspaceId as string) : null
  const { data: session } = useSession()

  const [template, setTemplate] = useState<Template | null>(null)
  const [currentUserOrgs, setCurrentUserOrgs] = useState<string[]>([])
  const [currentUserOrgRoles, setCurrentUserOrgRoles] = useState<
    Array<{ organizationId: string; role: string }>
  >([])
  const [isSuperUser, setIsSuperUser] = useState(false)
  const [loading, setLoading] = useState(true)
  const [isStarred, setIsStarred] = useState(false)
  const [starCount, setStarCount] = useState(0)
  const [isStarring, setIsStarring] = useState(false)
  const [isUsing, setIsUsing] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [isRejecting, setIsRejecting] = useState(false)
  const [hasWorkspaceAccess, setHasWorkspaceAccess] = useState<boolean | null>(null)
  const [workspaces, setWorkspaces] = useState<
    Array<{ id: string; name: string; permissions: string }>
  >([])
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(false)
  const [showWorkspaceSelectorForEdit, setShowWorkspaceSelectorForEdit] = useState(false)
  const [showWorkspaceSelectorForUse, setShowWorkspaceSelectorForUse] = useState(false)

  const currentUserId = session?.user?.id || null

  // Fetch template data on client side
  useEffect(() => {
    if (!templateId) {
      setLoading(false)
      return
    }

    const fetchTemplate = async () => {
      try {
        const response = await fetch(`/api/templates/${templateId}`)
        if (response.ok) {
          const data = await response.json()
          setTemplate(data.data)
          setIsStarred(data.data.isStarred || false)
          setStarCount(data.data.stars || 0)
        }
      } catch (error) {
        logger.error('Error fetching template:', error)
      } finally {
        setLoading(false)
      }
    }

    const fetchUserOrganizations = async () => {
      if (!currentUserId) return

      try {
        const response = await fetch('/api/organizations')
        if (response.ok) {
          const data = await response.json()
          const orgs = data.organizations || []
          const orgIds = orgs.map((org: any) => org.id)
          const orgRoles = orgs.map((org: any) => ({
            organizationId: org.id,
            role: org.role,
          }))
          setCurrentUserOrgs(orgIds)
          setCurrentUserOrgRoles(orgRoles)
        }
      } catch (error) {
        logger.error('Error fetching organizations:', error)
      }
    }

    const fetchSuperUserStatus = async () => {
      if (!currentUserId) return

      try {
        const response = await fetch('/api/user/super-user')
        if (response.ok) {
          const data = await response.json()
          setIsSuperUser(data.isSuperUser || false)
        }
      } catch (error) {
        logger.error('Error fetching super user status:', error)
      }
    }

    fetchTemplate()
    fetchSuperUserStatus()
    fetchUserOrganizations()
  }, [templateId, currentUserId])

  // Fetch workspaces when user is logged in
  useEffect(() => {
    if (!currentUserId) return

    const fetchWorkspaces = async () => {
      try {
        setIsLoadingWorkspaces(true)
        const response = await fetch('/api/workspaces')
        if (response.ok) {
          const data = await response.json()
          // Filter workspaces where user has write/admin permissions
          const availableWorkspaces = data.workspaces
            .filter((ws: any) => ws.permissions === 'write' || ws.permissions === 'admin')
            .map((ws: any) => ({
              id: ws.id,
              name: ws.name,
              permissions: ws.permissions,
            }))
          setWorkspaces(availableWorkspaces)
        }
      } catch (error) {
        logger.error('Error fetching workspaces:', error)
      } finally {
        setIsLoadingWorkspaces(false)
      }
    }

    fetchWorkspaces()
  }, [currentUserId])

  // Clean up URL when returning from login
  useEffect(() => {
    if (template && searchParams?.get('use') === 'true' && currentUserId) {
      if (isWorkspaceContext && workspaceId) {
        handleWorkspaceSelectForUse(workspaceId)
        router.replace(`/workspace/${workspaceId}/templates/${template.id}`)
      } else {
        router.replace(`/templates/${template.id}`)
      }
    }
  }, [searchParams, currentUserId, template, isWorkspaceContext, workspaceId, router])

  // Check if user can edit template
  const canEditTemplate = (() => {
    if (!currentUserId || !template?.creator) return false

    // For user creator profiles: must be the user themselves
    if (template.creator.referenceType === 'user') {
      return template.creator.referenceId === currentUserId
    }

    // For organization creator profiles:
    if (template.creator.referenceType === 'organization' && template.creator.referenceId) {
      const isOrgMember = currentUserOrgs.includes(template.creator.referenceId)

      // If template has a connected workflow, any org member with workspace access can edit
      if (template.workflowId) {
        return isOrgMember
      }

      // If template is orphaned, only admin/owner can edit
      // We need to check the user's role in the organization
      const orgMembership = currentUserOrgRoles.find(
        (org) => org.organizationId === template.creator?.referenceId
      )
      const isAdminOrOwner = orgMembership?.role === 'admin' || orgMembership?.role === 'owner'

      return isOrgMember && isAdminOrOwner
    }

    return false
  })()

  // Check workspace access for connected workflow
  useEffect(() => {
    const checkWorkspaceAccess = async () => {
      if (!template?.workflowId || !currentUserId || !canEditTemplate) {
        setHasWorkspaceAccess(null)
        return
      }

      try {
        const checkResponse = await fetch(`/api/workflows/${template.workflowId}`)
        if (checkResponse.status === 403) {
          setHasWorkspaceAccess(false)
        } else if (checkResponse.ok) {
          setHasWorkspaceAccess(true)
        } else {
          // Workflow doesn't exist
          setHasWorkspaceAccess(null)
        }
      } catch (error) {
        logger.error('Error checking workspace access:', error)
        setHasWorkspaceAccess(null)
      }
    }

    checkWorkspaceAccess()
  }, [template?.workflowId, currentUserId, canEditTemplate])

  if (loading) {
    return (
      <div className='flex h-screen items-center justify-center'>
        <div className='text-center'>
          <p className='font-sans text-muted-foreground text-sm'>Loading template...</p>
        </div>
      </div>
    )
  }

  if (!template) {
    return (
      <div className='flex h-screen items-center justify-center'>
        <div className='text-center'>
          <h1 className='mb-4 font-sans font-semibold text-2xl'>Template Not Found</h1>
          <p className='font-sans text-muted-foreground text-sm'>
            The template you're looking for doesn't exist.
          </p>
        </div>
      </div>
    )
  }

  const renderWorkflowPreview = () => {
    if (!template.state) {
      return (
        <div className='flex h-full items-center justify-center text-center'>
          <div className='text-muted-foreground'>
            <div className='mb-2 font-medium font-sans text-lg'>⚠️ No Workflow Data</div>
            <div className='font-sans text-sm'>
              This template doesn't contain workflow state data.
            </div>
          </div>
        </div>
      )
    }

    try {
      return (
        <WorkflowPreview
          workflowState={template.state}
          showSubBlocks={true}
          height='100%'
          width='100%'
          isPannable={true}
          defaultPosition={{ x: 0, y: 0 }}
          defaultZoom={1}
        />
      )
    } catch (error) {
      logger.error('Error rendering workflow preview:', error)
      return (
        <div className='flex h-full items-center justify-center text-center'>
          <div className='text-muted-foreground'>
            <div className='mb-2 font-medium font-sans text-lg'>⚠️ Preview Error</div>
            <div className='font-sans text-sm'>Unable to render workflow preview</div>
          </div>
        </div>
      )
    }
  }

  const handleBack = () => {
    if (isWorkspaceContext) {
      router.back()
    } else {
      router.push('/templates')
    }
  }
  /**
   * Intercepts wheel events over the workflow preview so that the page handles scrolling
   * instead of the underlying canvas. We stop propagation in the capture phase to prevent
   * React Flow from consuming the event, but intentionally avoid preventDefault so the
   * browser can perform its normal scroll behavior.
   *
   * We allow zoom gestures (Ctrl/Cmd + wheel) to pass through unmodified.
   *
   * @param event - The wheel event fired when the user scrolls over the preview area.
   */
  const handleCanvasWheelCapture = (event: React.WheelEvent<HTMLDivElement>) => {
    // Allow pinch/zoom gestures (e.g., ctrl/cmd + wheel) to continue to the canvas.
    if (event.ctrlKey || event.metaKey) {
      return
    }

    // Prevent React Flow from handling the wheel; let the page scroll naturally.
    event.stopPropagation()
  }

  const handleStarToggle = async () => {
    if (isStarring || !currentUserId) return

    setIsStarring(true)
    try {
      const method = isStarred ? 'DELETE' : 'POST'
      const response = await fetch(`/api/templates/${template.id}/star`, { method })

      if (response.ok) {
        setIsStarred(!isStarred)
        setStarCount((prev) => (isStarred ? prev - 1 : prev + 1))
      }
    } catch (error) {
      logger.error('Error toggling star:', error)
    } finally {
      setIsStarring(false)
    }
  }

  const handleUseTemplate = () => {
    if (!currentUserId) {
      const callbackUrl =
        isWorkspaceContext && workspaceId
          ? encodeURIComponent(`/workspace/${workspaceId}/templates/${template.id}?use=true`)
          : encodeURIComponent(`/templates/${template.id}`)
      router.push(`/login?callbackUrl=${callbackUrl}`)
      return
    }

    // In workspace context, use current workspace directly
    if (isWorkspaceContext && workspaceId) {
      handleWorkspaceSelectForUse(workspaceId)
    } else {
      setShowWorkspaceSelectorForUse(true)
    }
  }

  const handleEditTemplate = async () => {
    if (!currentUserId || !template) return

    // In workspace context with existing workflow, navigate directly
    if (isWorkspaceContext && workspaceId && template.workflowId) {
      setIsEditing(true)
      try {
        const checkResponse = await fetch(`/api/workflows/${template.workflowId}`)

        if (checkResponse.ok) {
          router.push(`/workspace/${workspaceId}/w/${template.workflowId}`)
          return
        }
      } catch (error) {
        logger.error('Error checking workflow:', error)
      } finally {
        setIsEditing(false)
      }
      // If workflow doesn't exist, fall through to workspace selector
    }

    // Check if workflow exists and user has access (global context)
    if (template.workflowId && !isWorkspaceContext) {
      setIsEditing(true)
      try {
        const checkResponse = await fetch(`/api/workflows/${template.workflowId}`)

        if (checkResponse.status === 403) {
          alert("You don't have access to the workspace containing this template")
          return
        }

        if (checkResponse.ok) {
          const result = await checkResponse.json()
          const templateWorkspaceId = result.data?.workspaceId
          if (templateWorkspaceId) {
            window.location.href = `/workspace/${templateWorkspaceId}/w/${template.workflowId}`
            return
          }
        }
      } catch (error) {
        logger.error('Error checking workflow:', error)
      } finally {
        setIsEditing(false)
      }
    }

    // Workflow doesn't exist - show workspace selector or use current workspace
    if (isWorkspaceContext && workspaceId) {
      handleWorkspaceSelectForEdit(workspaceId)
    } else {
      setShowWorkspaceSelectorForEdit(true)
    }
  }

  const handleWorkspaceSelectForUse = async (workspaceId: string) => {
    if (isUsing || !template) return

    setIsUsing(true)
    setShowWorkspaceSelectorForUse(false)
    try {
      const response = await fetch(`/api/templates/${template.id}/use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })

      if (!response.ok) {
        throw new Error('Failed to use template')
      }

      const { workflowId } = await response.json()

      // Navigate to the new workflow with full page load
      window.location.href = `/workspace/${workspaceId}/w/${workflowId}`
    } catch (error) {
      logger.error('Error using template:', error)
    } finally {
      setIsUsing(false)
    }
  }

  const handleWorkspaceSelectForEdit = async (workspaceId: string) => {
    if (isUsing || !template) return

    setIsUsing(true)
    setShowWorkspaceSelectorForEdit(false)
    try {
      // Import template as a new workflow and connect it to the template
      const response = await fetch(`/api/templates/${template.id}/use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, connectToTemplate: true }),
      })

      if (!response.ok) {
        throw new Error('Failed to import template for editing')
      }

      const { workflowId } = await response.json()

      // Navigate to the new workflow with full page load
      window.location.href = `/workspace/${workspaceId}/w/${workflowId}`
    } catch (error) {
      logger.error('Error importing template for editing:', error)
    } finally {
      setIsUsing(false)
    }
  }

  const handleApprove = async () => {
    if (isApproving || !template) return

    setIsApproving(true)
    try {
      const response = await fetch(`/api/templates/${template.id}/approve`, {
        method: 'POST',
      })

      if (response.ok) {
        // Update template status optimistically
        setTemplate({ ...template, status: 'approved' })
        // Redirect back to templates page after approval
        if (isWorkspaceContext && workspaceId) {
          router.push(`/workspace/${workspaceId}/templates`)
        } else {
          router.push('/templates')
        }
      }
    } catch (error) {
      logger.error('Error approving template:', error)
    } finally {
      setIsApproving(false)
    }
  }

  const handleReject = async () => {
    if (isRejecting || !template) return

    setIsRejecting(true)
    try {
      const response = await fetch(`/api/templates/${template.id}/reject`, {
        method: 'POST',
      })

      if (response.ok) {
        // Update template status optimistically
        setTemplate({ ...template, status: 'rejected' })
        // Redirect back to templates page after rejection
        if (isWorkspaceContext && workspaceId) {
          router.push(`/workspace/${workspaceId}/templates`)
        } else {
          router.push('/templates')
        }
      }
    } catch (error) {
      logger.error('Error rejecting template:', error)
    } finally {
      setIsRejecting(false)
    }
  }

  return (
    <div className={cn('flex min-h-screen flex-col', isWorkspaceContext && 'pl-64')}>
      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-auto px-[24px] pt-[24px] pb-[24px]'>
          {/* Top bar with back button */}
          <div className='flex items-center justify-between'>
            {/* Back button */}
            <button
              onClick={handleBack}
              className='flex items-center gap-[6px] font-medium text-[#ADADAD] text-[14px] transition-colors hover:text-white'
            >
              <ArrowLeft className='h-[14px] w-[14px]' />
              <span>Back</span>
            </button>
          </div>

          {/* Template name and action buttons */}
          <div className='mt-[24px] flex items-center justify-between'>
            <h1 className='font-medium text-[18px]'>{template.name}</h1>

            {/* Action buttons */}
            <div className='flex items-center gap-[8px]'>
              {/* Approve/Reject buttons for super users */}
              {isSuperUser && template.status === 'pending' && (
                <>
                  <Button
                    variant='active'
                    onClick={handleApprove}
                    disabled={isApproving}
                    className='h-[32px] rounded-[6px]'
                  >
                    {isApproving ? 'Approving...' : 'Approve'}
                  </Button>
                  <Button
                    variant='active'
                    onClick={handleReject}
                    disabled={isRejecting}
                    className='h-[32px] rounded-[6px]'
                  >
                    {isRejecting ? 'Rejecting...' : 'Reject'}
                  </Button>
                </>
              )}

              {/* Edit button - for template owners */}
              {canEditTemplate && currentUserId && (
                <>
                  {(isWorkspaceContext || template.workflowId) && !showWorkspaceSelectorForEdit ? (
                    <Button
                      variant='active'
                      onClick={handleEditTemplate}
                      disabled={isEditing || (!isWorkspaceContext && hasWorkspaceAccess === false)}
                      className='h-[32px] rounded-[6px]'
                    >
                      {isEditing ? 'Opening...' : 'Edit'}
                    </Button>
                  ) : (
                    <DropdownMenu
                      open={showWorkspaceSelectorForEdit}
                      onOpenChange={setShowWorkspaceSelectorForEdit}
                    >
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant='active'
                          onClick={() => setShowWorkspaceSelectorForEdit(true)}
                          disabled={isUsing || isLoadingWorkspaces}
                          className='h-[32px] rounded-[6px]'
                        >
                          {isUsing ? 'Importing...' : isLoadingWorkspaces ? 'Loading...' : 'Edit'}
                          <ChevronDown className='ml-2 h-4 w-4' />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end' className='w-56'>
                        {workspaces.length === 0 ? (
                          <DropdownMenuItem disabled className='text-muted-foreground text-sm'>
                            No workspaces with write access
                          </DropdownMenuItem>
                        ) : (
                          workspaces.map((workspace) => (
                            <DropdownMenuItem
                              key={workspace.id}
                              onClick={() => handleWorkspaceSelectForEdit(workspace.id)}
                              className='flex cursor-pointer items-center justify-between'
                            >
                              <div className='flex flex-col'>
                                <span className='font-medium text-sm'>{workspace.name}</span>
                                <span className='text-muted-foreground text-xs capitalize'>
                                  {workspace.permissions} access
                                </span>
                              </div>
                            </DropdownMenuItem>
                          ))
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </>
              )}

              {/* Use template button - only for approved templates and non-owners */}
              {template.status === 'approved' && !canEditTemplate && (
                <>
                  {!currentUserId ? (
                    <Button
                      variant='active'
                      onClick={() => {
                        const callbackUrl =
                          isWorkspaceContext && workspaceId
                            ? encodeURIComponent(
                                `/workspace/${workspaceId}/templates/${template.id}?use=true`
                              )
                            : encodeURIComponent(`/templates/${template.id}`)
                        router.push(`/login?callbackUrl=${callbackUrl}`)
                      }}
                      className='h-[32px] rounded-[6px]'
                    >
                      Sign in to use
                    </Button>
                  ) : isWorkspaceContext ? (
                    <Button
                      variant='primary'
                      onClick={handleUseTemplate}
                      disabled={isUsing}
                      className='!text-[#FFFFFF] h-[32px] rounded-[6px] px-[12px] text-[14px]'
                    >
                      {isUsing ? 'Creating...' : 'Use template'}
                    </Button>
                  ) : (
                    <DropdownMenu
                      open={showWorkspaceSelectorForUse}
                      onOpenChange={setShowWorkspaceSelectorForUse}
                    >
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant='primary'
                          onClick={() => setShowWorkspaceSelectorForUse(true)}
                          disabled={isUsing || isLoadingWorkspaces}
                          className='h-[32px] rounded-[6px] px-[16px] text-[#FFFFFF] text-[14px]'
                        >
                          {isUsing ? 'Creating...' : isLoadingWorkspaces ? 'Loading...' : 'Use'}
                          <ChevronDown className='ml-2 h-4 w-4' />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end' className='w-56'>
                        {workspaces.length === 0 ? (
                          <DropdownMenuItem disabled className='text-muted-foreground text-sm'>
                            No workspaces with write access
                          </DropdownMenuItem>
                        ) : (
                          workspaces.map((workspace) => (
                            <DropdownMenuItem
                              key={workspace.id}
                              onClick={() => handleWorkspaceSelectForUse(workspace.id)}
                              className='flex cursor-pointer items-center justify-between'
                            >
                              <div className='flex flex-col'>
                                <span className='font-medium text-sm'>{workspace.name}</span>
                                <span className='text-muted-foreground text-xs capitalize'>
                                  {workspace.permissions} access
                                </span>
                              </div>
                            </DropdownMenuItem>
                          ))
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Template tagline */}
          {template.details?.tagline && (
            <p className='mt-[4px] font-medium text-[#888888] text-[14px]'>
              {template.details.tagline}
            </p>
          )}

          {/* Creator and stats row */}
          <div className='mt-[16px] flex items-center gap-[8px]'>
            {/* Star icon and count */}
            <Star
              onClick={handleStarToggle}
              className={cn(
                'h-[14px] w-[14px] cursor-pointer transition-colors',
                isStarred ? 'fill-yellow-500 text-yellow-500' : 'text-[#888888]',
                isStarring && 'opacity-50'
              )}
            />
            <span className='font-medium text-[#888888] text-[14px]'>{starCount}</span>

            {/* Users icon and count */}
            <ChartNoAxesColumn className='h-[16px] w-[16px] text-[#888888]' />
            <span className='font-medium text-[#888888] text-[14px]'>{template.views}</span>

            {/* Vertical divider */}
            <div className='mx-[4px] mb-[-1.5px] h-[18px] w-[1.25px] rounded-full bg-[#3A3A3A]' />

            {/* Creator profile pic */}
            {template.creator?.profileImageUrl ? (
              <div className='h-[16px] w-[16px] flex-shrink-0 overflow-hidden rounded-full'>
                <img
                  src={template.creator.profileImageUrl}
                  alt={template.creator.name}
                  className='h-full w-full object-cover'
                />
              </div>
            ) : (
              <div className='flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center rounded-full bg-[#4A4A4A]'>
                <User className='h-[14px] w-[14px] text-[#888888]' />
              </div>
            )}
            {/* Creator name */}
            <span className='font-medium text-[#8B8B8B] text-[14px]'>
              {template.creator?.name || 'Unknown'}
            </span>
          </div>

          {/* Credentials needed */}
          {Array.isArray(template.requiredCredentials) &&
            template.requiredCredentials.length > 0 && (
              <p className='mt-[12px] font-medium text-[#888888] text-[12px]'>
                Credentials needed:{' '}
                {template.requiredCredentials
                  .map((cred: CredentialRequirement) => {
                    const blockName =
                      getBlock(cred.blockType)?.name ||
                      cred.blockType.charAt(0).toUpperCase() + cred.blockType.slice(1)
                    const alreadyHasBlock = cred.label
                      .toLowerCase()
                      .includes(` for ${blockName.toLowerCase()}`)
                    return alreadyHasBlock ? cred.label : `${cred.label} for ${blockName}`
                  })
                  .join(', ')}
              </p>
            )}

          {/* Canvas preview */}
          <div
            className='relative mt-[24px] h-[450px] w-full overflow-hidden rounded-[8px] border border-[var(--border)]'
            onWheelCapture={handleCanvasWheelCapture}
          >
            {renderWorkflowPreview()}

            {/* Last updated overlay */}
            {template.updatedAt && (
              <div className='pointer-events-none absolute right-[12px] bottom-[12px] rounded-[4px] bg-[var(--bg)]/80 px-[8px] py-[4px] backdrop-blur-sm'>
                <span className='font-medium text-[#8B8B8B] text-[12px]'>
                  Last updated{' '}
                  {formatDistanceToNow(new Date(template.updatedAt), {
                    addSuffix: true,
                  })}
                </span>
              </div>
            )}
          </div>

          {/* About this Workflow */}
          {template.details?.about && (
            <div className='mt-8'>
              <h3 className='mb-4 font-sans font-semibold text-base text-foreground'>
                About this Workflow
              </h3>
              <div className='max-w-none space-y-2'>
                <ReactMarkdown
                  components={{
                    p: ({ children }) => (
                      <p className='mb-2 font-sans text-muted-foreground text-sm leading-[1.4rem] last:mb-0'>
                        {children}
                      </p>
                    ),
                    h1: ({ children }) => (
                      <h1 className='mt-6 mb-3 font-sans font-semibold text-foreground text-xl first:mt-0'>
                        {children}
                      </h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className='mt-5 mb-2.5 font-sans font-semibold text-foreground text-lg first:mt-0'>
                        {children}
                      </h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className='mt-4 mb-2 font-sans font-semibold text-base text-foreground first:mt-0'>
                        {children}
                      </h3>
                    ),
                    h4: ({ children }) => (
                      <h4 className='mt-3 mb-2 font-sans font-semibold text-foreground text-sm first:mt-0'>
                        {children}
                      </h4>
                    ),
                    ul: ({ children }) => (
                      <ul className='my-2 ml-5 list-disc space-y-1.5 font-sans text-muted-foreground text-sm'>
                        {children}
                      </ul>
                    ),
                    ol: ({ children }) => (
                      <ol className='my-2 ml-5 list-decimal space-y-1.5 font-sans text-muted-foreground text-sm'>
                        {children}
                      </ol>
                    ),
                    li: ({ children }) => <li className='leading-[1.4rem]'>{children}</li>,
                    code: ({ inline, children }: any) =>
                      inline ? (
                        <code className='rounded bg-muted px-1.5 py-0.5 font-mono text-[#F59E0B] text-xs'>
                          {children}
                        </code>
                      ) : (
                        <code className='my-2 block overflow-x-auto rounded-md bg-muted p-3 font-mono text-foreground text-xs'>
                          {children}
                        </code>
                      ),
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='text-blue-600 underline-offset-2 transition-colors hover:text-blue-500 hover:underline dark:text-blue-400 dark:hover:text-blue-300'
                      >
                        {children}
                      </a>
                    ),
                    strong: ({ children }) => (
                      <strong className='font-sans font-semibold text-foreground'>
                        {children}
                      </strong>
                    ),
                    em: ({ children }) => <em className='text-muted-foreground'>{children}</em>,
                  }}
                >
                  {template.details.about}
                </ReactMarkdown>
              </div>
            </div>
          )}

          {/* About the Creator */}
          {template.creator &&
            (template.creator.details?.about ||
              template.creator.details?.xUrl ||
              template.creator.details?.linkedinUrl ||
              template.creator.details?.websiteUrl ||
              template.creator.details?.contactEmail) && (
              <div className='mt-8'>
                <h3 className='mb-4 font-sans font-semibold text-base text-foreground'>
                  About the Creator
                </h3>
                <div className='flex items-start gap-4'>
                  {/* Creator profile image */}
                  {template.creator.profileImageUrl ? (
                    <div className='h-[48px] w-[48px] flex-shrink-0 overflow-hidden rounded-full'>
                      <img
                        src={template.creator.profileImageUrl}
                        alt={template.creator.name}
                        className='h-full w-full object-cover'
                      />
                    </div>
                  ) : (
                    <div className='flex h-[48px] w-[48px] flex-shrink-0 items-center justify-center rounded-full bg-[#4A4A4A]'>
                      <User className='h-[24px] w-[24px] text-[#888888]' />
                    </div>
                  )}

                  {/* Creator details */}
                  <div className='flex-1'>
                    <div className='mb-[5px] flex items-center gap-3'>
                      <h4 className='font-sans font-semibold text-base text-foreground'>
                        {template.creator.name}
                      </h4>

                      {/* Social links */}
                      <div className='flex items-center gap-[12px]'>
                        {template.creator.details?.websiteUrl && (
                          <a
                            href={template.creator.details.websiteUrl}
                            target='_blank'
                            rel='noopener noreferrer'
                            className='flex items-center text-[#888888] transition-colors hover:text-[var(--text-primary)]'
                            aria-label='Website'
                          >
                            <Globe className='h-[14px] w-[14px]' />
                          </a>
                        )}
                        {template.creator.details?.xUrl && (
                          <a
                            href={template.creator.details.xUrl}
                            target='_blank'
                            rel='noopener noreferrer'
                            className='flex items-center text-[#888888] transition-colors hover:text-[var(--text-primary)]'
                            aria-label='X (Twitter)'
                          >
                            <svg
                              className='h-[14px] w-[14px]'
                              viewBox='0 0 24 24'
                              fill='currentColor'
                            >
                              <path d='M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z' />
                            </svg>
                          </a>
                        )}
                        {template.creator.details?.linkedinUrl && (
                          <a
                            href={template.creator.details.linkedinUrl}
                            target='_blank'
                            rel='noopener noreferrer'
                            className='flex items-center text-[#888888] transition-colors hover:text-[var(--text-primary)]'
                            aria-label='LinkedIn'
                          >
                            <Linkedin className='h-[14px] w-[14px]' />
                          </a>
                        )}
                        {template.creator.details?.contactEmail && (
                          <a
                            href={`mailto:${template.creator.details.contactEmail}`}
                            className='flex items-center text-[#888888] transition-colors hover:text-[var(--text-primary)]'
                            aria-label='Email'
                          >
                            <Mail className='h-[14px] w-[14px]' />
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Creator bio */}
                    {template.creator.details?.about && (
                      <div className='max-w-none'>
                        <ReactMarkdown
                          components={{
                            p: ({ children }) => (
                              <p className='mb-2 font-sans text-muted-foreground text-sm leading-[1.4rem] last:mb-0'>
                                {children}
                              </p>
                            ),
                            a: ({ href, children }) => (
                              <a
                                href={href}
                                target='_blank'
                                rel='noopener noreferrer'
                                className='text-blue-600 underline-offset-2 transition-colors hover:text-blue-500 hover:underline dark:text-blue-400 dark:hover:text-blue-300'
                              >
                                {children}
                              </a>
                            ),
                            strong: ({ children }) => (
                              <strong className='font-sans font-semibold text-foreground'>
                                {children}
                              </strong>
                            ),
                          }}
                        >
                          {template.creator.details.about}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  )
}
