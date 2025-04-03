'use client'

import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { formatDistanceToNow } from 'date-fns'
import {
  Atom,
  BotMessageSquare,
  Brain,
  BrainCircuit,
  ChartBar,
  Code,
  Database,
  Eye,
  HelpCircle,
  Info,
  LineChart,
  MailIcon,
  NotebookPen,
  Store,
  TimerIcon,
  Trash,
  X,
} from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingAgent } from '@/components/ui/loading-agent'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { useNotificationStore } from '@/stores/notifications/store'
import { getWorkflowWithValues } from '@/stores/workflows'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import {
  CATEGORIES,
  getCategoryColor,
  getCategoryIcon,
  getCategoryLabel,
} from '@/app/w/marketplace/constants/categories'

const logger = createLogger('MarketplaceModal')

/**
 * Sanitizes sensitive data from workflow state before publishing
 * Removes API keys, tokens, and environment variable references
 */
const sanitizeWorkflowData = (workflowData: any) => {
  if (!workflowData) return workflowData

  const sanitizedData = JSON.parse(JSON.stringify(workflowData))
  let sanitizedCount = 0

  // Handle workflow state format
  if (sanitizedData.state?.blocks) {
    Object.values(sanitizedData.state.blocks).forEach((block: any) => {
      if (block.subBlocks) {
        // Check for sensitive fields in subBlocks
        Object.entries(block.subBlocks).forEach(([key, subBlock]: [string, any]) => {
          // Check for API key related fields in any block type
          const isSensitiveField =
            key.toLowerCase() === 'apikey' || key.toLowerCase().includes('api_key')

          if (isSensitiveField && subBlock.value) {
            subBlock.value = ''
            sanitizedCount++
          }
        })
      }
    })
  }

  logger.info(`Sanitized ${sanitizedCount} API keys from workflow data`)
  return sanitizedData
}

interface MarketplaceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Form schema for validation
const marketplaceFormSchema = z.object({
  name: z
    .string()
    .min(3, 'Name must be at least 3 characters')
    .max(50, 'Name cannot exceed 50 characters'),
  description: z
    .string()
    .min(10, 'Description must be at least 10 characters')
    .max(500, 'Description cannot exceed 500 characters'),
  category: z.string().min(1, 'Please select a category'),
  authorName: z
    .string()
    .min(2, 'Author name must be at least 2 characters')
    .max(50, 'Author name cannot exceed 50 characters'),
})

type MarketplaceFormValues = z.infer<typeof marketplaceFormSchema>

// Tooltip texts
const TOOLTIPS = {
  category: 'Categorizing your workflow helps users find it more easily.',
  authorName: 'The name you want to publish under (defaults to your account name if left empty).',
}

interface MarketplaceInfo {
  id: string
  name: string
  description: string
  category: string
  authorName: string
  views: number
  createdAt: string
  updatedAt: string
}

export function MarketplaceModal({ open, onOpenChange }: MarketplaceModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUnpublishing, setIsUnpublishing] = useState(false)
  const [marketplaceInfo, setMarketplaceInfo] = useState<MarketplaceInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const { addNotification } = useNotificationStore()
  const { activeWorkflowId, workflows, updateWorkflow } = useWorkflowRegistry()

  // Get marketplace data from the registry
  const getMarketplaceData = () => {
    if (!activeWorkflowId || !workflows[activeWorkflowId]) return null
    return workflows[activeWorkflowId].marketplaceData
  }

  // Check if workflow is published to marketplace
  const isPublished = () => {
    return !!getMarketplaceData()
  }

  // Check if the current user is the owner of the published workflow
  const isOwner = () => {
    const marketplaceData = getMarketplaceData()
    return marketplaceData?.status === 'owner'
  }

  // Initialize form with react-hook-form
  const form = useForm<MarketplaceFormValues>({
    resolver: zodResolver(marketplaceFormSchema),
    defaultValues: {
      name: '',
      description: '',
      category: 'marketing',
      authorName: '',
    },
  })

  // Fetch marketplace information when the modal opens and the workflow is published
  useEffect(() => {
    async function fetchMarketplaceInfo() {
      if (!open || !activeWorkflowId || !isPublished()) {
        setMarketplaceInfo(null)
        return
      }

      try {
        setIsLoading(true)

        // Get marketplace ID from the workflow's marketplaceData
        const marketplaceData = getMarketplaceData()
        if (!marketplaceData?.id) {
          throw new Error('No marketplace ID found in workflow data')
        }

        // Use the marketplace ID to fetch details instead of workflow ID
        const response = await fetch(
          `/api/marketplace/workflows?marketplaceId=${marketplaceData.id}`
        )

        if (!response.ok) {
          throw new Error('Failed to fetch marketplace information')
        }

        // The API returns the data directly without wrapping
        const marketplaceEntry = await response.json()
        setMarketplaceInfo(marketplaceEntry)
      } catch (error) {
        console.error('Error fetching marketplace info:', error)
        addNotification('error', 'Failed to fetch marketplace information', activeWorkflowId)
      } finally {
        setIsLoading(false)
      }
    }

    fetchMarketplaceInfo()
  }, [open, activeWorkflowId, addNotification])

  // Update form values when the active workflow changes or modal opens
  useEffect(() => {
    if (open && activeWorkflowId && workflows[activeWorkflowId] && !isPublished()) {
      const workflow = workflows[activeWorkflowId]
      form.setValue('name', workflow.name)
      form.setValue('description', workflow.description || '')
    }
  }, [open, activeWorkflowId, workflows, form])

  // Listen for the custom event to open the marketplace modal
  useEffect(() => {
    const handleOpenMarketplace = () => {
      onOpenChange(true)
    }

    // Add event listener
    window.addEventListener('open-marketplace', handleOpenMarketplace as EventListener)

    // Clean up
    return () => {
      window.removeEventListener('open-marketplace', handleOpenMarketplace as EventListener)
    }
  }, [onOpenChange])

  const onSubmit = async (data: MarketplaceFormValues) => {
    if (!activeWorkflowId) {
      addNotification('error', 'No active workflow to publish', null)
      return
    }

    try {
      setIsSubmitting(true)

      // Get the complete workflow state client-side
      const workflowData = getWorkflowWithValues(activeWorkflowId)
      if (!workflowData) {
        addNotification('error', 'Failed to retrieve workflow state', activeWorkflowId)
        return
      }

      // Sanitize the workflow data
      const sanitizedWorkflowData = sanitizeWorkflowData(workflowData)
      logger.info('Publishing sanitized workflow to marketplace', {
        workflowId: activeWorkflowId,
        workflowName: data.name,
        category: data.category,
      })

      const response = await fetch('/api/marketplace/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflowId: activeWorkflowId,
          name: data.name,
          description: data.description,
          category: data.category,
          authorName: data.authorName,
          workflowState: sanitizedWorkflowData.state,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to publish workflow')
      }

      // Get the marketplace ID from the response
      const responseData = await response.json()
      const marketplaceId = responseData.data.id

      // Update the marketplace data in the workflow registry
      updateWorkflow(activeWorkflowId, {
        marketplaceData: { id: marketplaceId, status: 'owner' },
      })

      // Add a marketplace notification with detailed information
      addNotification(
        'marketplace',
        `"${data.name}" successfully published to marketplace`,
        activeWorkflowId
      )

      // Close the modal after successful submission
      onOpenChange(false)
    } catch (error: any) {
      console.error('Error publishing workflow:', error)
      addNotification('error', `Failed to publish workflow: ${error.message}`, activeWorkflowId)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleUnpublish = async () => {
    if (!activeWorkflowId) {
      addNotification('error', 'No active workflow to unpublish', null)
      return
    }

    try {
      setIsUnpublishing(true)

      // Get marketplace ID from the workflow's marketplaceData
      const marketplaceData = getMarketplaceData()
      if (!marketplaceData?.id) {
        throw new Error('No marketplace ID found in workflow data')
      }

      logger.info('Attempting to unpublish marketplace entry', {
        marketplaceId: marketplaceData.id,
        workflowId: activeWorkflowId,
        status: marketplaceData.status,
      })

      const response = await fetch(`/api/marketplace/${marketplaceData.id}/unpublish`, {
        method: 'POST',
      })

      if (!response.ok) {
        const errorData = await response.json()
        logger.error('Error response from unpublish endpoint', {
          status: response.status,
          data: errorData,
        })
        throw new Error(errorData.error || 'Failed to unpublish workflow')
      }

      logger.info('Successfully unpublished workflow from marketplace', {
        marketplaceId: marketplaceData.id,
        workflowId: activeWorkflowId,
      })

      // First close the modal to prevent any flashing
      onOpenChange(false)

      // Then update the workflow state after modal is closed
      setTimeout(() => {
        // Remove the marketplace data from the workflow registry
        updateWorkflow(activeWorkflowId, {
          marketplaceData: null,
        })
      }, 100)
    } catch (error: any) {
      console.error('Error unpublishing workflow:', error)
      addNotification('error', `Failed to unpublish workflow: ${error.message}`, activeWorkflowId)
    } finally {
      setIsUnpublishing(false)
    }
  }

  const LabelWithTooltip = ({ name, tooltip }: { name: string; tooltip: string }) => (
    <div className="flex items-center gap-1.5">
      <FormLabel>{name}</FormLabel>
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[300px] p-3">
          <p className="text-sm">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )

  // Render marketplace information for published workflows
  const renderMarketplaceInfo = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <LoadingAgent size="md" />
        </div>
      )
    }

    if (!marketplaceInfo) {
      return (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <div className="flex flex-col items-center gap-2">
            <Info className="h-5 w-5" />
            <p className="text-sm">No marketplace information available</p>
          </div>
        </div>
      )
    }

    return (
      <div className="space-y-5 px-1">
        {/* Header section with title and stats */}
        <div className="space-y-2.5">
          <div className="flex items-start justify-between">
            <h3 className="text-xl font-medium leading-tight">{marketplaceInfo.name}</h3>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 rounded-md px-2 py-1">
                <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">
                  {marketplaceInfo.views}
                </span>
              </div>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{marketplaceInfo.description}</p>
        </div>

        {/* Category and Author Info */}
        <div className="flex items-center gap-6">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Category</Label>
            <div
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1"
              style={{
                backgroundColor: `${getCategoryColor(marketplaceInfo.category)}15`,
                color: getCategoryColor(marketplaceInfo.category),
              }}
            >
              {getCategoryIcon(marketplaceInfo.category)}
              <span className="text-sm font-medium">
                {getCategoryLabel(marketplaceInfo.category)}
              </span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Author</Label>
            <div className="flex items-center text-sm font-medium">
              {marketplaceInfo.authorName}
            </div>
          </div>
        </div>

        {/* Action buttons - Only show unpublish if owner */}
        {isOwner() && (
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="destructive"
              onClick={handleUnpublish}
              disabled={isUnpublishing}
              className="gap-2"
            >
              {isUnpublishing ? 'Unpublishing...' : 'Unpublish'}
            </Button>
          </div>
        )}
      </div>
    )
  }

  // Render publish form for unpublished workflows
  const renderPublishForm = () => (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="mb-4 rounded-md bg-amber-50 p-3 border border-amber-200">
          <p className="text-sm text-amber-800">
            <span className="font-medium text-amber-800">Security:</span> API keys and environment
            variables will be automatically removed before publishing.
          </p>
        </div>

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Workflow Name</FormLabel>
              <FormControl>
                <Input placeholder="Enter workflow name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Describe what your workflow does and how it can help others"
                  className="min-h-24"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem>
              <LabelWithTooltip name="Category" tooltip={TOOLTIPS.category} />
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {CATEGORIES.map((category) => (
                    <SelectItem
                      key={category.value}
                      value={category.value}
                      className="flex items-center"
                    >
                      <div className="flex items-center">
                        {category.icon}
                        {category.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="authorName"
          render={({ field }) => (
            <FormItem>
              <LabelWithTooltip name="Author Name" tooltip={TOOLTIPS.authorName} />
              <FormControl>
                <Input placeholder="Enter author name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-between gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            className={cn(
              // Base styles
              'gap-2 font-medium',
              // Brand color with hover states
              'bg-[#802FFF] hover:bg-[#7028E6]',
              // Hover effect with brand color
              'shadow-[0_0_0_0_#802FFF] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
              // Text color and transitions
              'text-white transition-all duration-200',
              // Running state animation
              isSubmitting &&
                'relative after:absolute after:inset-0 after:animate-pulse after:bg-white/20',
              // Disabled state
              'disabled:opacity-50 disabled:hover:bg-[#802FFF] disabled:hover:shadow-none'
            )}
          >
            {isSubmitting ? 'Publishing...' : 'Publish Workflow'}
          </Button>
        </div>
      </form>
    </Form>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] flex flex-col p-0 gap-0" hideCloseButton>
        <DialogHeader className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-medium">
              {isPublished() ? 'Marketplace Information' : 'Publish to Marketplace'}
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 p-0"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
        </DialogHeader>

        <div className="pt-4 px-6 pb-6 overflow-y-auto">
          {isPublished() ? renderMarketplaceInfo() : renderPublishForm()}
        </div>
      </DialogContent>
    </Dialog>
  )
}
