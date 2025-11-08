'use client'

import { useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  ArrowLeft,
  Award,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Brain,
  Briefcase,
  Calculator,
  ChevronDown,
  Clock,
  Cloud,
  Code,
  Cpu,
  CreditCard,
  Database,
  DollarSign,
  Eye,
  FileText,
  Folder,
  Globe,
  HeadphonesIcon,
  Layers,
  Lightbulb,
  LineChart,
  Linkedin,
  Mail,
  Megaphone,
  MessageSquare,
  NotebookPen,
  Phone,
  Play,
  Search,
  Server,
  Settings,
  ShoppingCart,
  Star,
  Target,
  TrendingUp,
  Twitter,
  User,
  Users,
  Workflow,
  Wrench,
  Zap,
} from 'lucide-react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import type { CredentialRequirement } from '@/lib/workflows/credential-extractor'
import type { Template } from '@/app/templates/templates'
import { WorkflowPreview } from '@/app/workspace/[workspaceId]/w/components/workflow-preview/workflow-preview'
import { getBlock } from '@/blocks/registry'

const logger = createLogger('TemplateDetails')

// Icon mapping
const iconMap = {
  FileText,
  NotebookPen,
  BookOpen,
  BarChart3,
  LineChart,
  TrendingUp,
  Target,
  Database,
  Server,
  Cloud,
  Folder,
  Megaphone,
  Mail,
  MessageSquare,
  Phone,
  Bell,
  DollarSign,
  CreditCard,
  Calculator,
  ShoppingCart,
  Briefcase,
  HeadphonesIcon,
  Users,
  Settings,
  Wrench,
  Bot,
  Brain,
  Cpu,
  Code,
  Zap,
  Workflow,
  Search,
  Play,
  Layers,
  Lightbulb,
  Globe,
  Award,
}

export default function TemplateDetails() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const params = useParams()
  const templateId = params?.id as string

  const [template, setTemplate] = useState<Template | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
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
        console.error('Error fetching template:', error)
      } finally {
        setLoading(false)
      }
    }

    const fetchCurrentUser = async () => {
      try {
        const response = await fetch('/api/auth/get-session')
        if (response.ok) {
          const data = await response.json()
          setCurrentUserId(data.user?.id || null)
        }
      } catch (error) {
        console.error('Error fetching session:', error)
      }
    }

    const fetchUserOrganizations = async () => {
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
        console.error('Error fetching organizations:', error)
      }
    }

    const fetchSuperUserStatus = async () => {
      try {
        const response = await fetch('/api/user/super-user')
        if (response.ok) {
          const data = await response.json()
          setIsSuperUser(data.isSuperUser || false)
        }
      } catch (error) {
        console.error('Error fetching super user status:', error)
      }
    }

    fetchTemplate()
    fetchCurrentUser()
    fetchSuperUserStatus()
    fetchUserOrganizations()
  }, [templateId])

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
        console.error('Error fetching workspaces:', error)
      } finally {
        setIsLoadingWorkspaces(false)
      }
    }

    fetchWorkspaces()
  }, [currentUserId])

  // Clean up URL when returning from login
  useEffect(() => {
    if (template && searchParams?.get('use') === 'true' && currentUserId) {
      router.replace(`/templates/${template.id}`)
    }
  }, [searchParams, currentUserId, template, router])

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
          <p className='text-muted-foreground'>Loading template...</p>
        </div>
      </div>
    )
  }

  if (!template) {
    return (
      <div className='flex h-screen items-center justify-center'>
        <div className='text-center'>
          <h1 className='mb-4 font-bold text-2xl'>Template Not Found</h1>
          <p className='text-muted-foreground'>The template you're looking for doesn't exist.</p>
        </div>
      </div>
    )
  }

  const renderWorkflowPreview = () => {
    if (!template.state) {
      return (
        <div className='flex h-full items-center justify-center text-center'>
          <div className='text-muted-foreground'>
            <div className='mb-2 font-medium text-lg'>⚠️ No Workflow Data</div>
            <div className='text-sm'>This template doesn't contain workflow state data.</div>
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
      console.error('Error rendering workflow preview:', error)
      return (
        <div className='flex h-full items-center justify-center text-center'>
          <div className='text-muted-foreground'>
            <div className='mb-2 font-medium text-lg'>⚠️ Preview Error</div>
            <div className='text-sm'>Unable to render workflow preview</div>
          </div>
        </div>
      )
    }
  }

  const handleBack = () => {
    router.push('/templates')
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
      const callbackUrl = encodeURIComponent(`/templates/${template.id}`)
      router.push(`/login?callbackUrl=${callbackUrl}`)
      return
    }
    setShowWorkspaceSelectorForUse(true)
  }

  const handleEditTemplate = async () => {
    if (!currentUserId || !template) return

    // Check if workflow exists and user has access
    if (template.workflowId) {
      setIsEditing(true)
      try {
        const checkResponse = await fetch(`/api/workflows/${template.workflowId}`)

        if (checkResponse.status === 403) {
          // User doesn't have access to the workspace
          // This shouldn't happen if button is properly disabled, but handle it gracefully
          alert("You don't have access to the workspace containing this template")
          return
        }

        if (checkResponse.ok) {
          // Workflow exists and user has access, get its workspace and navigate to it
          const result = await checkResponse.json()
          const workspaceId = result.data?.workspaceId
          if (workspaceId) {
            // Use window.location to ensure a full page load with fresh data
            // This avoids race conditions with client-side navigation
            window.location.href = `/workspace/${workspaceId}/w/${template.workflowId}`
            return
          }
        }
      } catch (error) {
        logger.error('Error checking workflow:', error)
      } finally {
        setIsEditing(false)
      }
    }

    // Workflow doesn't exist or was deleted - show workspace selector
    setShowWorkspaceSelectorForEdit(true)
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
        router.push('/templates')
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
        router.push('/templates')
      }
    } catch (error) {
      logger.error('Error rejecting template:', error)
    } finally {
      setIsRejecting(false)
    }
  }

  return (
    <TooltipProvider delayDuration={100} skipDelayDuration={0}>
      <div className='flex min-h-screen flex-col'>
        {/* Header */}
        <div className='border-b bg-background p-6'>
          <div className='mx-auto max-w-7xl'>
            {/* Back button */}
            <button
              onClick={handleBack}
              className='mb-6 flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground'
            >
              <ArrowLeft className='h-4 w-4' />
              <span className='text-sm'>Back to templates</span>
            </button>

            {/* Template header */}
            <div className='flex items-start justify-between'>
              <div className='flex items-start gap-4'>
                {/* Icon */}

                {/* Title and description */}
                <div>
                  <h1 className='font-bold text-3xl text-foreground'>{template.name}</h1>
                  {template.details?.tagline && (
                    <p className='mt-2 max-w-3xl text-lg text-muted-foreground'>
                      {template.details.tagline}
                    </p>
                  )}
                  {/* Tags */}
                  {template.tags && template.tags.length > 0 && (
                    <div className='mt-3 flex flex-wrap gap-2'>
                      {template.tags.map((tag, index) => (
                        <Badge
                          key={index}
                          variant='secondary'
                          className='border-0 bg-muted/60 px-2.5 py-0.5 text-sm hover:bg-muted/80'
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className='flex items-center gap-3'>
                {/* Super user approve/reject buttons for pending templates */}
                {isSuperUser && template.status === 'pending' && (
                  <>
                    <Button
                      onClick={handleApprove}
                      disabled={isApproving}
                      className='bg-green-600 text-white hover:bg-green-700'
                    >
                      {isApproving ? 'Approving...' : 'Approve'}
                    </Button>
                    <Button
                      onClick={handleReject}
                      disabled={isRejecting}
                      variant='outline'
                      className='border-red-600 text-red-600 hover:bg-red-50'
                    >
                      {isRejecting ? 'Rejecting...' : 'Reject'}
                    </Button>
                  </>
                )}

                {/* Star button - only for logged-in non-owners and non-pending templates */}
                {currentUserId && !canEditTemplate && template.status !== 'pending' && (
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={handleStarToggle}
                    disabled={isStarring}
                    className={cn(
                      'transition-colors',
                      isStarred &&
                        'border-yellow-200 bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                    )}
                  >
                    <Star className={cn('mr-2 h-4 w-4', isStarred && 'fill-current')} />
                    {starCount}
                  </Button>
                )}

                {/* Edit button - for template owners (approved or pending) */}
                {canEditTemplate && currentUserId && (
                  <>
                    {template.workflowId && !showWorkspaceSelectorForEdit ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>
                              <Button
                                onClick={handleEditTemplate}
                                disabled={isEditing || hasWorkspaceAccess === false}
                                className={
                                  hasWorkspaceAccess === false
                                    ? 'cursor-not-allowed opacity-50'
                                    : 'bg-blue-600 text-white hover:bg-blue-700'
                                }
                              >
                                {isEditing ? 'Opening...' : 'Edit Template'}
                              </Button>
                            </span>
                          </TooltipTrigger>
                          {hasWorkspaceAccess === false && (
                            <TooltipContent>
                              <p>Don't have access to workspace to edit template</p>
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <DropdownMenu
                        open={showWorkspaceSelectorForEdit}
                        onOpenChange={setShowWorkspaceSelectorForEdit}
                      >
                        <DropdownMenuTrigger asChild>
                          <Button
                            onClick={() =>
                              !template.workflowId && setShowWorkspaceSelectorForEdit(true)
                            }
                            disabled={isUsing || isLoadingWorkspaces}
                            className='bg-blue-600 text-white hover:bg-blue-700'
                          >
                            {isUsing
                              ? 'Importing...'
                              : isLoadingWorkspaces
                                ? 'Loading...'
                                : 'Edit Template'}
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
                        onClick={() => {
                          const callbackUrl = encodeURIComponent(`/templates/${template.id}`)
                          router.push(`/login?callbackUrl=${callbackUrl}`)
                        }}
                        className='bg-purple-600 text-white hover:bg-purple-700'
                      >
                        Sign in to use
                      </Button>
                    ) : (
                      <DropdownMenu
                        open={showWorkspaceSelectorForUse}
                        onOpenChange={setShowWorkspaceSelectorForUse}
                      >
                        <DropdownMenuTrigger asChild>
                          <Button
                            onClick={() => setShowWorkspaceSelectorForUse(true)}
                            disabled={isUsing || isLoadingWorkspaces}
                            className='bg-purple-600 text-white hover:bg-purple-700'
                          >
                            {isUsing
                              ? 'Creating...'
                              : isLoadingWorkspaces
                                ? 'Loading...'
                                : 'Use this template'}
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

            {/* Tags */}
            <div className='mt-6 flex items-center gap-3 text-muted-foreground text-sm'>
              {/* Views */}
              <div className='flex items-center gap-1 rounded-full bg-secondary px-3 py-1'>
                <Eye className='h-3 w-3' />
                <span>{template.views} views</span>
              </div>

              {/* Stars */}
              <div className='flex items-center gap-1 rounded-full bg-secondary px-3 py-1'>
                <Star className='h-3 w-3' />
                <span>{starCount} stars</span>
              </div>

              {/* Author */}
              <div className='flex items-center gap-1 rounded-full bg-secondary px-3 py-1'>
                <User className='h-3 w-3' />
                <span>by {template.creator?.name || 'Unknown'}</span>
              </div>

              {/* Author Type - show if organization */}
              {template.creator?.referenceType === 'organization' && (
                <div className='flex items-center gap-1 rounded-full bg-secondary px-3 py-1'>
                  <Users className='h-3 w-3' />
                  <span>Organization</span>
                </div>
              )}

              {/* Last Updated */}
              {template.updatedAt && (
                <div className='flex items-center gap-1 rounded-full bg-secondary px-3 py-1'>
                  <Clock className='h-3 w-3' />
                  <span>
                    Last updated{' '}
                    {formatDistanceToNow(new Date(template.updatedAt), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Workflow preview */}
        <div className='flex-1 p-6'>
          <div className='mx-auto max-w-7xl'>
            <h2 className='mb-4 font-semibold text-xl'>Workflow Preview</h2>
            <div className='h-[600px] w-full'>{renderWorkflowPreview()}</div>

            {Array.isArray(template.requiredCredentials) &&
              template.requiredCredentials.length > 0 && (
                <div className='mt-8'>
                  <h3 className='mb-3 font-semibold text-lg'>Credentials Needed</h3>
                  <ul className='list-disc space-y-1 pl-6 text-muted-foreground text-sm'>
                    {template.requiredCredentials.map(
                      (cred: CredentialRequirement, idx: number) => {
                        // Get block name from registry or format blockType
                        const blockName =
                          getBlock(cred.blockType)?.name ||
                          cred.blockType.charAt(0).toUpperCase() + cred.blockType.slice(1)
                        const alreadyHasBlock = cred.label
                          .toLowerCase()
                          .includes(` for ${blockName.toLowerCase()}`)
                        const text = alreadyHasBlock ? cred.label : `${cred.label} for ${blockName}`
                        return <li key={idx}>{text}</li>
                      }
                    )}
                  </ul>
                </div>
              )}

            {/* About this Workflow */}
            {template.details?.about && (
              <div className='mt-8'>
                <h3 className='mb-3 font-semibold text-lg'>About this Workflow</h3>
                <div className='prose prose-sm max-w-none dark:prose-invert'>
                  <ReactMarkdown>{template.details.about}</ReactMarkdown>
                </div>
              </div>
            )}

            {/* Creator Profile */}
            {template.creator && (
              <div className='mt-8'>
                <h3 className='mb-4 font-semibold text-lg'>About the Creator</h3>
                <div className='rounded-lg border bg-card p-6'>
                  <div className='flex items-start gap-4'>
                    {/* Profile Picture */}
                    <div className='flex-shrink-0'>
                      {template.creator.profileImageUrl ? (
                        <div className='relative h-20 w-20 overflow-hidden rounded-full'>
                          <img
                            src={template.creator.profileImageUrl}
                            alt={template.creator.name}
                            className='h-full w-full object-cover'
                          />
                        </div>
                      ) : (
                        <div className='flex h-20 w-20 items-center justify-center rounded-full bg-[#802FFF]'>
                          <User className='h-10 w-10 text-white' />
                        </div>
                      )}
                    </div>

                    {/* Creator Info */}
                    <div className='flex-1'>
                      <h4 className='font-semibold text-lg'>{template.creator.name}</h4>
                      {template.creator.about && (
                        <p className='mt-2 text-muted-foreground text-sm leading-relaxed'>
                          {template.creator.about}
                        </p>
                      )}

                      {/* Social Links */}
                      {(template.creator.xUrl ||
                        template.creator.linkedinUrl ||
                        template.creator.websiteUrl ||
                        template.creator.contactEmail) && (
                        <div className='mt-4 flex flex-wrap gap-3'>
                          {template.creator.xUrl && (
                            <a
                              href={template.creator.xUrl}
                              target='_blank'
                              rel='noopener noreferrer'
                              className='inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground'
                            >
                              <Twitter className='h-4 w-4' />
                              <span>X</span>
                            </a>
                          )}
                          {template.creator.linkedinUrl && (
                            <a
                              href={template.creator.linkedinUrl}
                              target='_blank'
                              rel='noopener noreferrer'
                              className='inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground'
                            >
                              <Linkedin className='h-4 w-4' />
                              <span>LinkedIn</span>
                            </a>
                          )}
                          {template.creator.websiteUrl && (
                            <a
                              href={template.creator.websiteUrl}
                              target='_blank'
                              rel='noopener noreferrer'
                              className='inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground'
                            >
                              <Globe className='h-4 w-4' />
                              <span>Website</span>
                            </a>
                          )}
                          {template.creator.contactEmail && (
                            <a
                              href={`mailto:${template.creator.contactEmail}`}
                              className='inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground'
                            >
                              <Mail className='h-4 w-4' />
                              <span>Contact</span>
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
