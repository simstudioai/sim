'use client'

import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { CheckCircle2, Loader2, Plus } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Badge, Button, Input, Textarea, Trash } from '@/components/emcn'
import {
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import { TagInput } from '@/components/ui/tag-input'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { WorkflowPreview } from '@/app/workspace/[workspaceId]/w/components/workflow-preview/workflow-preview'
import {
  useCreateTemplate,
  useDeleteTemplate,
  useTemplateByWorkflow,
  useUpdateTemplate,
} from '@/hooks/queries/templates'
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
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [creatorOptions, setCreatorOptions] = useState<CreatorOption[]>([])
  const [loadingCreators, setLoadingCreators] = useState(false)
  const [showPreviewDialog, setShowPreviewDialog] = useState(false)

  const { data: existingTemplate, isLoading: isLoadingTemplate } = useTemplateByWorkflow(workflowId)
  const createMutation = useCreateTemplate()
  const updateMutation = useUpdateTemplate()
  const deleteMutation = useDeleteTemplate()

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

  useEffect(() => {
    const currentCreatorId = form.getValues('creatorId')
    if (creatorOptions.length === 1 && !currentCreatorId) {
      form.setValue('creatorId', creatorOptions[0].id)
      logger.info('Auto-selected single creator profile:', creatorOptions[0].name)
    }
  }, [creatorOptions, form])

  useEffect(() => {
    const handleCreatorProfileSaved = async () => {
      logger.info('Creator profile saved, refreshing profiles...')

      await fetchCreatorOptions()

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

  useEffect(() => {
    if (existingTemplate) {
      const tagline = existingTemplate.details?.tagline || ''
      const about = existingTemplate.details?.about || ''

      form.reset({
        name: existingTemplate.name,
        tagline: tagline,
        about: about,
        creatorId: existingTemplate.creatorId || undefined,
        tags: existingTemplate.tags || [],
      })
    }
  }, [existingTemplate, form])

  const onSubmit = async (data: TemplateFormData) => {
    if (!session?.user) {
      logger.error('User not authenticated')
      return
    }

    try {
      const templateData = {
        name: data.name,
        details: {
          tagline: data.tagline || '',
          about: data.about || '',
        },
        creatorId: data.creatorId || undefined,
        tags: data.tags || [],
      }

      if (existingTemplate) {
        await updateMutation.mutateAsync({
          id: existingTemplate.id,
          data: {
            ...templateData,
            updateState: true,
          },
        })
      } else {
        await createMutation.mutateAsync({ ...templateData, workflowId })
      }

      logger.info(`Template ${existingTemplate ? 'updated' : 'created'} successfully`)
      onDeploymentComplete?.()
    } catch (error) {
      logger.error('Failed to save template:', error)
    }
  }

  const handleDelete = async () => {
    if (!existingTemplate) return

    try {
      await deleteMutation.mutateAsync(existingTemplate.id)
      setShowDeleteDialog(false)
      form.reset({
        name: '',
        tagline: '',
        about: '',
        creatorId: undefined,
        tags: [],
      })
    } catch (error) {
      logger.error('Error deleting template:', error)
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
        <div className='flex items-center justify-between rounded-[8px] border border-[var(--border)] bg-[var(--surface-3)] px-[16px] py-[12px]'>
          <div className='flex items-center gap-[12px]'>
            <CheckCircle2 className='h-[16px] w-[16px] text-green-600 dark:text-green-400' />
            <div className='flex items-center gap-[8px]'>
              <span className='font-medium text-[14px] text-[var(--text-primary)]'>
                Template Connected
              </span>
              {existingTemplate.status === 'pending' && (
                <Badge
                  variant='outline'
                  className='border-yellow-300 bg-yellow-100 text-yellow-700 dark:border-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
                >
                  Under Review
                </Badge>
              )}
              {existingTemplate.status === 'approved' && existingTemplate.views > 0 && (
                <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>
                  • {existingTemplate.views} views
                  {existingTemplate.stars > 0 && ` • ${existingTemplate.stars} stars`}
                </span>
              )}
            </div>
          </div>
          <Button
            type='button'
            variant='ghost'
            onClick={() => setShowDeleteDialog(true)}
            className='h-[32px] px-[8px] text-[var(--text-muted)] hover:text-red-600 dark:hover:text-red-400'
          >
            <Trash className='h-[14px] w-[14px]' />
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
                      className='gap-[8px]'
                    >
                      <Plus className='h-[14px] w-[14px] text-[var(--text-muted)]' />
                      <span className='text-[var(--text-muted)]'>Create a Creator Profile</span>
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
                    disabled={createMutation.isPending || updateMutation.isPending}
                  />
                </FormControl>
                <p className='text-muted-foreground text-xs'>
                  Add up to 10 tags to help users discover your template
                </p>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className='flex justify-end gap-[8px] border-[var(--border)] border-t pt-[16px]'>
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
              variant='primary'
              disabled={
                createMutation.isPending || updateMutation.isPending || !form.formState.isValid
              }
            >
              {createMutation.isPending || updateMutation.isPending ? (
                <>
                  <Loader2 className='mr-[8px] h-[14px] w-[14px] animate-spin' />
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
          <div className='w-full max-w-md rounded-[8px] bg-[var(--surface-3)] p-[24px] shadow-lg'>
            <h3 className='mb-[16px] font-semibold text-[18px] text-[var(--text-primary)]'>
              Delete Template?
            </h3>
            <p className='mb-[24px] text-[14px] text-[var(--text-secondary)]'>
              This will permanently delete your template. This action cannot be undone.
            </p>
            <div className='flex justify-end gap-[8px]'>
              <Button variant='outline' onClick={() => setShowDeleteDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className='bg-red-600 text-white hover:bg-red-700'
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
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
