'use client'

import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { CheckCircle2, Loader2, Trash2 } from 'lucide-react'
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
  description: z.string().min(1, 'Description is required').max(500, 'Max 500 characters'),
  authorId: z.string().min(1, 'Author is required'),
  tags: z.array(z.string()).max(10, 'Maximum 10 tags allowed').optional().default([]),
})

type TemplateFormData = z.infer<typeof templateSchema>

interface AuthorOption {
  id: string
  name: string
  type: 'user' | 'organization'
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
  const [authorOptions, setAuthorOptions] = useState<AuthorOption[]>([])
  const [loadingAuthors, setLoadingAuthors] = useState(false)
  const [showPreviewDialog, setShowPreviewDialog] = useState(false)

  const form = useForm<TemplateFormData>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      name: '',
      description: '',
      authorId: session?.user?.id || '',
      tags: [],
    },
  })

  // Fetch author options (user + organizations)
  useEffect(() => {
    const fetchAuthorOptions = async () => {
      if (!session?.user?.id) return

      setLoadingAuthors(true)
      try {
        const options: AuthorOption[] = [
          {
            id: session.user.id,
            name: session.user.name || session.user.email || 'Me',
            type: 'user',
          },
        ]

        const response = await fetch('/api/organizations')
        if (response.ok) {
          const data = await response.json()
          const orgs = (data.organizations || []).map((org: any) => ({
            id: org.id,
            name: org.name,
            type: 'organization' as const,
          }))
          options.push(...orgs)
        }

        setAuthorOptions(options)
      } catch (error) {
        logger.error('Error fetching author options:', error)
      } finally {
        setLoadingAuthors(false)
      }
    }

    fetchAuthorOptions()
  }, [session?.user?.id, session?.user?.name, session?.user?.email])

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
            // Determine authorId from template
            const authorId =
              template.authorType === 'organization' ? template.organizationId : template.userId

            form.reset({
              name: template.name,
              description: template.description,
              authorId: authorId || session?.user?.id || '',
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
      // Determine author info from selected option
      const selectedAuthor = authorOptions.find((opt) => opt.id === data.authorId)
      const authorType = selectedAuthor?.type || 'user'
      const authorName = selectedAuthor?.name || session.user.name || session.user.email || ''
      const organizationId = authorType === 'organization' ? data.authorId : undefined

      const templateData: any = {
        name: data.name,
        description: data.description || '',
        author: authorName,
        authorType,
        tags: data.tags || [],
      }

      // Only include organizationId if it's defined
      if (organizationId) {
        templateData.organizationId = organizationId
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
          description: '',
          authorId: session?.user?.id || '',
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
            name='description'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder='What does this template do?'
                    className='min-h-[100px] resize-none'
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='authorId'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Author</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value}
                  disabled={loadingAuthors}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={loadingAuthors ? 'Loading...' : 'Select author'} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {authorOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.name} {option.type === 'organization' && '(Organization)'}
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
      {showPreviewDialog && (
        <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
          <DialogContent className='max-h-[80vh] max-w-5xl overflow-auto'>
            <DialogHeader>
              <DialogTitle>Template State Preview</DialogTitle>
            </DialogHeader>
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
                      key={`template-preview-${existingTemplate.id}-${Date.now()}`}
                      workflowState={workflowState}
                      showSubBlocks={true}
                      height='100%'
                      width='100%'
                    />
                  </div>
                )
              })()}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
