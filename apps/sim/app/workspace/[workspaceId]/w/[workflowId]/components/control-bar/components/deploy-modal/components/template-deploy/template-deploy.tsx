'use client'

import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { CheckCircle2, Loader2, Plus, Trash2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@/components/ui'
import { TagInput } from '@/components/ui/tag-input'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { WorkflowPreview } from '@/app/workspace/[workspaceId]/w/components/workflow-preview/workflow-preview'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('TemplateDeploy')

const templateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Max 100 characters'),
  tagline: z.string().max(500, 'Max 500 characters').optional(),
  about: z.string().optional(), // Markdown long description
  creatorId: z.string().optional(), // Creator profile ID
  tags: z.array(z.string()).max(10, 'Maximum 10 tags allowed').optional().default([]),
})

type TemplateFormData = z.infer<typeof templateSchema>

interface CreatorOption {
  id: string
  name: string
  referenceType: 'user' | 'organization'
  referenceId: string
}

interface TemplateDeployProps {
  workflowId: string
  onDeploymentComplete?: () => void
}

export function TemplateDeploy({ workflowId, onDeploymentComplete }: TemplateDeployProps) {
  const { data: session } = useSession()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [existingTemplate, setExistingTemplate] = useState<any>(null)
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [creatorOptions, setCreatorOptions] = useState<CreatorOption[]>([])
  const [loadingCreators, setLoadingCreators] = useState(false)
  const [showPreviewDialog, setShowPreviewDialog] = useState(false)

  const form = useForm<TemplateFormData>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      name: '',
      tagline: '',
      about: '',
      creatorId: undefined,
      tags: [],
    },
  })

  // Fetch creator profiles
  const fetchCreatorOptions = async () => {
    if (!session?.user?.id) return

    setLoadingCreators(true)
    try {
      const response = await fetch('/api/creator-profiles')
      if (response.ok) {
        const data = await response.json()
        const profiles = (data.profiles || []).map((profile: any) => ({
          id: profile.id,
          name: profile.name,
          referenceType: profile.referenceType,
          referenceId: profile.referenceId,
        }))
        setCreatorOptions(profiles)
        return profiles
      }
    } catch (error) {
      logger.error('Error fetching creator profiles:', error)
    } finally {
      setLoadingCreators(false)
    }
    return []
  }

  useEffect(() => {
    fetchCreatorOptions()
  }, [session?.user?.id])

  // Auto-select creator profile when there's only one option and no selection yet
  useEffect(() => {
    const currentCreatorId = form.getValues('creatorId')
    if (creatorOptions.length === 1 && !currentCreatorId) {
      form.setValue('creatorId', creatorOptions[0].id)
      logger.info('Auto-selected single creator profile:', creatorOptions[0].name)
    }
  }, [creatorOptions, form])

  // Listen for creator profile saved event
  useEffect(() => {
    const handleCreatorProfileSaved = async () => {
      logger.info('Creator profile saved, refreshing profiles...')

      // Refetch creator profiles (autoselection will happen via the effect above)
      await fetchCreatorOptions()

      // Close settings modal and reopen deploy modal to template tab
      window.dispatchEvent(new CustomEvent('close-settings'))
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('open-deploy-modal', { detail: { tab: 'template' } }))
      }, 100)
    }

    window.addEventListener('creator-profile-saved', handleCreatorProfileSaved)

    return () => {
      window.removeEventListener('creator-profile-saved', handleCreatorProfileSaved)
    }
  }, [])

  // Check for existing template
  useEffect(() => {
    const checkExistingTemplate = async () => {
      setIsLoadingTemplate(true)
      try {
        const response = await fetch(`/api/templates?workflowId=${workflowId}&limit=1`)
        if (response.ok) {
          const result = await response.json()
          const template = result.data?.[0] || null
          setExistingTemplate(template)

          if (template) {
            // Map old template format to new format if needed
            const tagline = (template.details as any)?.tagline || template.description || ''
            const about = (template.details as any)?.about || ''

            form.reset({
              name: template.name,
              tagline: tagline,
              about: about,
              creatorId: template.creatorId || undefined,
              tags: template.tags || [],
            })
          }
        }
      } catch (error) {
        logger.error('Error checking existing template:', error)
        setExistingTemplate(null)
      } finally {
        setIsLoadingTemplate(false)
      }
    }

    checkExistingTemplate()
  }, [workflowId, session?.user?.id])

  const onSubmit = async (data: TemplateFormData) => {
    if (!session?.user) {
      logger.error('User not authenticated')
      return
    }

    setIsSubmitting(true)

    try {
      // Build template data with new schema
      const templateData: any = {
        name: data.name,
        details: {
          tagline: data.tagline || '',
          about: data.about || '',
        },
        creatorId: data.creatorId || null,
        tags: data.tags || [],
      }

      let response
      if (existingTemplate) {
        // Update template metadata AND state from current workflow
        response = await fetch(`/api/templates/${existingTemplate.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...templateData,
            updateState: true, // Update state from current workflow
          }),
        })
      } else {
        // Create new template with workflowId
        response = await fetch('/api/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...templateData, workflowId }),
        })
      }

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(
          errorData.error || `Failed to ${existingTemplate ? 'update' : 'create'} template`
        )
      }

      const result = await response.json()
      logger.info(`Template ${existingTemplate ? 'updated' : 'created'} successfully:`, result)

      // Update existing template state
      setExistingTemplate(result.data || result)

      onDeploymentComplete?.()
    } catch (error) {
      logger.error('Failed to save template:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!existingTemplate) return

    setIsDeleting(true)
    try {
      const response = await fetch(`/api/templates/${existingTemplate.id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setExistingTemplate(null)
        setShowDeleteDialog(false)
        form.reset({
          name: '',
          tagline: '',
          about: '',
          creatorId: undefined,
          tags: [],
        })
      }
    } catch (error) {
      logger.error('Error deleting template:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  if (isLoadingTemplate) {
    return (
      <div className='flex h-64 items-center justify-center'>
        <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      {existingTemplate && (
        <div className='flex items-center justify-between rounded-lg border border-border/50 bg-muted/30 px-4 py-3'>
          <div className='flex items-center gap-3'>
            <CheckCircle2 className='h-4 w-4 text-green-600 dark:text-green-400' />
            <div className='flex items-center gap-2'>
              <span className='font-medium text-sm'>Template Connected</span>
              {existingTemplate.status === 'pending' && (
                <span className='rounded-md bg-yellow-100 px-2 py-0.5 font-medium text-xs text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'>
                  Under Review
                </span>
              )}
              {existingTemplate.status === 'approved' && existingTemplate.views > 0 && (
                <span className='text-muted-foreground text-xs'>
                  • {existingTemplate.views} views
                  {existingTemplate.stars > 0 && ` • ${existingTemplate.stars} stars`}
                </span>
              )}
            </div>
          </div>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => setShowDeleteDialog(true)}
            className='h-8 px-2 text-muted-foreground hover:text-red-600 dark:hover:text-red-400'
          >
            <Trash2 className='h-4 w-4' />
          </Button>
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
          <FormField
            control={form.control}
            name='name'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Template Name</FormLabel>
                <FormControl>
                  <Input placeholder='My Awesome Template' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='tagline'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tagline</FormLabel>
                <FormControl>
                  <Input placeholder='Brief description of what this template does' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='about'
            render={({ field }) => (
              <FormItem>
                <FormLabel>About (Optional)</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder='Detailed description (supports Markdown)'
                    className='min-h-[150px] resize-none'
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='creatorId'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Creator Profile</FormLabel>
                {creatorOptions.length === 0 && !loadingCreators ? (
                  <div className='flex items-center gap-2'>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      className='gap-2'
                      onClick={() => {
                        try {
                          const event = new CustomEvent('open-settings', {
                            detail: { tab: 'creator-profile' },
                          })
                          window.dispatchEvent(event)
                          logger.info('Opened Settings modal at creator-profile section')
                        } catch (error) {
                          logger.error('Failed to open Settings modal for creator profile', {
                            error,
                          })
                        }
                      }}
                    >
                      <Plus className='h-4 w-4 text-muted-foreground' />
                      <span className='text-muted-foreground'>Create a Creator Profile</span>
                    </Button>
                  </div>
                ) : (
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={loadingCreators}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={loadingCreators ? 'Loading...' : 'Select creator profile'}
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {creatorOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='tags'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tags</FormLabel>
                <FormControl>
                  <TagInput
                    value={field.value || []}
                    onChange={field.onChange}
                    placeholder='Type and press Enter to add tags'
                    maxTags={10}
                    disabled={isSubmitting}
                  />
                </FormControl>
                <p className='text-muted-foreground text-xs'>
                  Add up to 10 tags to help users discover your template
                </p>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className='flex justify-end gap-2 border-t pt-4'>
            {existingTemplate && (
              <Button
                type='button'
                variant='outline'
                onClick={() => setShowPreviewDialog(true)}
                disabled={!existingTemplate?.state}
              >
                View Current
              </Button>
            )}
            <Button
              type='submit'
              disabled={isSubmitting || !form.formState.isValid}
              className='bg-purple-600 hover:bg-purple-700'
            >
              {isSubmitting ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  {existingTemplate ? 'Updating...' : 'Publishing...'}
                </>
              ) : existingTemplate ? (
                'Update Template'
              ) : (
                'Publish Template'
              )}
            </Button>
          </div>
        </form>
      </Form>

      {showDeleteDialog && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
          <div className='w-full max-w-md rounded-lg bg-background p-6 shadow-lg'>
            <h3 className='mb-4 font-semibold text-lg'>Delete Template?</h3>
            <p className='mb-6 text-muted-foreground text-sm'>
              This will permanently delete your template. This action cannot be undone.
            </p>
            <div className='flex justify-end gap-2'>
              <Button variant='outline' onClick={() => setShowDeleteDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleDelete}
                disabled={isDeleting}
                className='bg-red-600 hover:bg-red-700'
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Template State Preview Dialog */}
      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className='max-h-[80vh] max-w-5xl overflow-auto'>
          <DialogHeader>
            <DialogTitle>Published Template Preview</DialogTitle>
          </DialogHeader>
          {showPreviewDialog && (
            <div className='mt-4'>
              {(() => {
                if (!existingTemplate?.state || !existingTemplate.state.blocks) {
                  return (
                    <div className='flex flex-col items-center gap-4 py-8'>
                      <div className='text-center text-muted-foreground'>
                        <p className='mb-2'>No template state available yet.</p>
                        <p className='text-sm'>
                          Click "Update Template" to capture the current workflow state.
                        </p>
                      </div>
                    </div>
                  )
                }

                // Ensure the state has the right structure
                const workflowState: WorkflowState = {
                  blocks: existingTemplate.state.blocks || {},
                  edges: existingTemplate.state.edges || [],
                  loops: existingTemplate.state.loops || {},
                  parallels: existingTemplate.state.parallels || {},
                  lastSaved: existingTemplate.state.lastSaved || Date.now(),
                }

                return (
                  <div className='h-[500px] w-full'>
                    <WorkflowPreview
                      key={`template-preview-${existingTemplate.id}`}
                      workflowState={workflowState}
                      showSubBlocks={true}
                      height='100%'
                      width='100%'
                    />
                  </div>
                )
              })()}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
