'use client'

import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { HelpCircle, Info, Trash, X } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
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
import { Notice } from '@/components/ui/notice'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import {
  CATEGORIES,
  getCategoryColor,
  getCategoryIcon,
  getCategoryLabel,
} from '@/app/w/templates/constants/categories'
import { useNotificationStore } from '@/stores/notifications/store'
import { getWorkflowWithValues } from '@/stores/workflows'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('MarketplaceModal')

/**
 * Comprehensive sanitization of sensitive data from workflow state before publishing
 * Removes API keys, tokens, passwords, credentials, and environment variable references
 */
const sanitizeWorkflowData = (workflowData: any) => {
  if (!workflowData) return workflowData

  const sanitizedData = JSON.parse(JSON.stringify(workflowData))
  let sanitizedCount = 0

  // Comprehensive patterns for sensitive field detection
  const sensitivePatterns = [
    // API keys and tokens
    /^apikey$/i,
    /api[_-]?key/i,
    /^token$/i,
    /[_-]?token$/i,
    /^bot[_-]?token$/i,
    /^access[_-]?token$/i,
    /^auth[_-]?token$/i,

    // Credentials and secrets
    /^password$/i,
    /^secret$/i,
    /[_-]?secret$/i,
    /^credential/i,
    /^private[_-]?key$/i,

    // AWS and cloud credentials
    /^access[_-]?key[_-]?id$/i,
    /^secret[_-]?access[_-]?key$/i,
    /^session[_-]?token$/i,

    // Email and personal info
    /^email$/i,
    /^username$/i,
    /^user[_-]?id$/i,
    /^phone$/i,

    // Provider-specific patterns
    /^openai/i,
    /^anthropic/i,
    /^google/i,
    /^discord/i,
    /^telegram/i,
    /^slack/i,
    /^github/i,
  ]

  // Helper function to check if a field name matches sensitive patterns
  const isSensitiveField = (fieldName: string): boolean => {
    return sensitivePatterns.some((pattern) => pattern.test(fieldName))
  }

  // Helper function to recursively sanitize any object
  const sanitizeObject = (obj: any, path = ''): any => {
    if (!obj || typeof obj !== 'object') return obj

    if (Array.isArray(obj)) {
      return obj.map((item, index) => sanitizeObject(item, `${path}[${index}]`))
    }

    const sanitized = { ...obj }

    Object.keys(sanitized).forEach((key) => {
      const currentPath = path ? `${path}.${key}` : key

      if (isSensitiveField(key)) {
        logger.info(`Sanitizing sensitive field: ${currentPath}`)
        sanitized[key] = ''
        sanitizedCount++
      } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
        sanitized[key] = sanitizeObject(sanitized[key], currentPath)
      } else if (typeof sanitized[key] === 'string') {
        // Check for environment variable references and remove them
        const envVarPattern = /<env\.[\w_]+>/g
        if (envVarPattern.test(sanitized[key])) {
          logger.info(`Sanitizing environment variable reference: ${currentPath}`)
          sanitized[key] = sanitized[key].replace(envVarPattern, '')
          sanitizedCount++
        }
      }
    })

    return sanitized
  }

  // Get all blocks from the registry to check password fields
  const getPasswordFields = (): Set<string> => {
    const passwordFields = new Set<string>()

    try {
      // Import block configurations to identify password fields
      // This is more reliable than pattern matching
      const { getBlock } = require('@/blocks')

      if (sanitizedData.state?.blocks) {
        Object.values(sanitizedData.state.blocks).forEach((block: any) => {
          if (block.type) {
            try {
              const blockConfig = getBlock(block.type)
              if (blockConfig?.subBlocks) {
                blockConfig.subBlocks.forEach((subBlock: any) => {
                  if (subBlock.password === true) {
                    passwordFields.add(subBlock.id)
                  }
                })
              }
            } catch (error) {
              // Block type might not exist anymore, continue
            }
          }
        })
      }
    } catch (error) {
      logger.warn('Could not load block configurations for password field detection', error)
    }

    return passwordFields
  }

  // Get password fields from block configurations
  const passwordFields = getPasswordFields()

  // Handle workflow state format
  if (sanitizedData.state?.blocks) {
    Object.keys(sanitizedData.state.blocks).forEach((blockId) => {
      const block = sanitizedData.state.blocks[blockId]

      if (block.subBlocks) {
        // Sanitize subBlocks
        Object.keys(block.subBlocks).forEach((subBlockId) => {
          const subBlock = block.subBlocks[subBlockId]

          if (subBlock && typeof subBlock === 'object') {
            // Check if this is a known password field or matches sensitive patterns
            if (passwordFields.has(subBlockId) || isSensitiveField(subBlockId)) {
              logger.info(`Sanitizing sensitive subBlock: ${blockId}.${subBlockId}`)
              subBlock.value = ''
              sanitizedCount++
            } else if (subBlock.value && typeof subBlock.value === 'object') {
              // Recursively sanitize complex values
              subBlock.value = sanitizeObject(subBlock.value, `${blockId}.${subBlockId}.value`)
            } else if (typeof subBlock.value === 'string') {
              // Check for environment variable references
              const envVarPattern = /<env\.[\w_]+>/g
              if (envVarPattern.test(subBlock.value)) {
                logger.info(`Sanitizing env var in subBlock: ${blockId}.${subBlockId}`)
                subBlock.value = subBlock.value.replace(envVarPattern, '')
                sanitizedCount++
              }
            }
          }
        })
      }

      // Sanitize block-level data
      if (block.data) {
        block.data = sanitizeObject(block.data, `${blockId}.data`)
      }

      // Sanitize any other block properties that might contain sensitive data
      if (block.outputs) {
        block.outputs = sanitizeObject(block.outputs, `${blockId}.outputs`)
      }
    })
  }

  // Sanitize any other top-level properties
  Object.keys(sanitizedData).forEach((key) => {
    if (key !== 'state') {
      sanitizedData[key] = sanitizeObject(sanitizedData[key], key)
    }
  })

  logger.info(`Sanitized ${sanitizedCount} sensitive fields from workflow data`)
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
  shortDescription: z
    .string()
    .min(10, 'Short description must be at least 10 characters')
    .max(60, 'Short description cannot exceed 60 characters'),
  longDescription: z
    .string()
    .min(20, 'Long description must be at least 20 characters')
    .max(300, 'Long description cannot exceed 300 characters'),
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
  shortDescription: 'A brief summary that appears in search results and workflow cards.',
  longDescription:
    'A detailed description explaining what your workflow does, how it works, and how it can help users.',
}

interface MarketplaceInfo {
  id: string
  name: string
  short_description: string
  long_description: string
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
      shortDescription: '',
      longDescription: '',
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
        const response = await fetch(`/api/templates/workflows?templateId=${marketplaceData.id}`)

        if (!response.ok) {
          // If the template is not found (404), it means it was unpublished
          if (response.status === 404) {
            logger.warn(
              'Template not found in marketplace, removing marketplace data from workflow',
              {
                templateId: marketplaceData.id,
                workflowId: activeWorkflowId,
              }
            )

            // Remove marketplace data from workflow since template no longer exists
            updateWorkflow(activeWorkflowId, {
              marketplaceData: null,
            })

            // Close the modal since the workflow is no longer published
            onOpenChange(false)

            // Notify user that the template was unpublished
            addNotification(
              'info',
              'This workflow is no longer published to the marketplace',
              activeWorkflowId
            )
            return
          }

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
  }, [open, activeWorkflowId, addNotification, updateWorkflow, onOpenChange])

  // Update form values when the active workflow changes or modal opens
  useEffect(() => {
    if (open && activeWorkflowId && workflows[activeWorkflowId] && !isPublished()) {
      const workflow = workflows[activeWorkflowId]
      form.setValue('name', workflow.name)
      form.setValue('shortDescription', workflow.description || '')
      form.setValue('longDescription', '')
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

      const response = await fetch('/api/templates/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflowId: activeWorkflowId,
          name: data.name,
          shortDescription: data.shortDescription,
          longDescription: data.longDescription,
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

      const response = await fetch(`/api/templates/${marketplaceData.id}/unpublish`, {
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
    <div className='flex items-center gap-1.5'>
      <FormLabel>{name}</FormLabel>
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle className='h-4 w-4 cursor-help text-muted-foreground' />
        </TooltipTrigger>
        <TooltipContent side='top' className='max-w-[300px] p-3'>
          <p className='text-sm'>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )

  // Render marketplace information for published workflows
  const renderMarketplaceInfo = () => {
    if (isLoading) {
      return (
        <div className='flex items-center justify-center py-12'>
          <LoadingAgent size='md' />
        </div>
      )
    }

    if (!marketplaceInfo) {
      return (
        <div className='flex items-center justify-center py-12 text-muted-foreground'>
          <div className='flex flex-col items-center gap-2'>
            <Info className='h-5 w-5' />
            <p className='text-sm'>No marketplace information available</p>
          </div>
        </div>
      )
    }

    return (
      <div className='space-y-5 px-1'>
        {/* Header section with title and stats */}
        <div className='space-y-2.5'>
          <div className='flex items-start justify-between'>
            <h3 className='font-medium text-xl leading-tight'>{marketplaceInfo.name}</h3>
          </div>
          <p className='text-muted-foreground text-sm'>{marketplaceInfo.short_description}</p>
          {marketplaceInfo.long_description && (
            <div className='space-y-1.5'>
              <Label className='text-muted-foreground text-xs'>Detailed Description</Label>
              <p className='text-foreground text-sm leading-relaxed'>
                {marketplaceInfo.long_description}
              </p>
            </div>
          )}
        </div>

        {/* Category and Author Info */}
        <div className='flex items-center gap-6'>
          <div className='space-y-1.5'>
            <Label className='text-muted-foreground text-xs'>Category</Label>
            <div
              className='flex items-center gap-1.5 rounded-md px-2.5 py-1'
              style={{
                backgroundColor: `${getCategoryColor(marketplaceInfo.category)}15`,
                color: getCategoryColor(marketplaceInfo.category),
              }}
            >
              {getCategoryIcon(marketplaceInfo.category)}
              <span className='font-medium text-sm'>
                {getCategoryLabel(marketplaceInfo.category)}
              </span>
            </div>
          </div>
          <div className='space-y-1.5'>
            <Label className='text-muted-foreground text-xs'>Author</Label>
            <div className='flex items-center font-medium text-sm'>
              {marketplaceInfo.authorName}
            </div>
          </div>
        </div>

        {/* Action buttons - Only show unpublish if owner */}
        {isOwner() && (
          <div className='flex justify-end gap-2 pt-2'>
            <Button
              type='button'
              variant='destructive'
              onClick={handleUnpublish}
              disabled={isUnpublishing}
              className='gap-2'
            >
              {isUnpublishing ? (
                <div className='mr-2 h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
              ) : (
                <Trash className='mr-2 h-4 w-4' />
              )}
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
      <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
        <Notice variant='warning' title='Security'>
          API keys and environment variables will be automatically removed.
        </Notice>

        <FormField
          control={form.control}
          name='name'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Workflow Name</FormLabel>
              <FormControl>
                <Input placeholder='Enter workflow name' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='shortDescription'
          render={({ field }) => (
            <FormItem>
              <LabelWithTooltip name='Short Description' tooltip={TOOLTIPS.shortDescription} />
              <FormControl>
                <Textarea
                  placeholder='Enter a brief summary of your workflow'
                  className='min-h-24'
                  maxLength={60}
                  {...field}
                />
              </FormControl>
              <div className='flex items-center justify-between text-xs'>
                <FormMessage />
                <span
                  className={`${field.value?.length >= 60 ? 'text-red-500' : 'text-muted-foreground'}`}
                >
                  {field.value?.length || 0}/60 characters
                </span>
              </div>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='longDescription'
          render={({ field }) => (
            <FormItem>
              <LabelWithTooltip name='Long Description' tooltip={TOOLTIPS.longDescription} />
              <FormControl>
                <Textarea
                  placeholder='Enter a detailed description of your workflow'
                  className='min-h-24'
                  maxLength={300}
                  {...field}
                />
              </FormControl>
              <div className='flex items-center justify-between text-xs'>
                <FormMessage />
                <span
                  className={`${field.value?.length >= 300 ? 'text-red-500' : 'text-muted-foreground'}`}
                >
                  {field.value?.length || 0}/300 characters
                </span>
              </div>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='category'
          render={({ field }) => (
            <FormItem>
              <LabelWithTooltip name='Category' tooltip={TOOLTIPS.category} />
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder='Select a category' />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {CATEGORIES.map((category) => (
                    <SelectItem
                      key={category.value}
                      value={category.value}
                      className='flex items-center'
                    >
                      <div className='flex items-center'>
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
          name='authorName'
          render={({ field }) => (
            <FormItem>
              <LabelWithTooltip name='Author Name' tooltip={TOOLTIPS.authorName} />
              <FormControl>
                <Input placeholder='Enter author name' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className='flex justify-between gap-2'>
          <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type='submit'
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
      <DialogContent className='flex flex-col gap-0 p-0 sm:max-w-[600px]' hideCloseButton>
        <DialogHeader className='border-b px-6 py-4'>
          <div className='flex items-center justify-between'>
            <DialogTitle className='font-medium text-lg'>
              {isPublished() ? 'Marketplace Information' : 'Publish to Marketplace'}
            </DialogTitle>
            <Button
              variant='ghost'
              size='icon'
              className='h-8 w-8 p-0'
              onClick={() => onOpenChange(false)}
            >
              <X className='h-4 w-4' />
              <span className='sr-only'>Close</span>
            </Button>
          </div>
        </DialogHeader>

        <div className='overflow-y-auto px-6 pt-4 pb-6'>
          {isPublished() ? renderMarketplaceInfo() : renderPublishForm()}
        </div>
      </DialogContent>
    </Dialog>
  )
}
