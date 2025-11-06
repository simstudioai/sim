'use client'

import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2, Star, Trash2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  Button,
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
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('TemplateDeploy')

const templateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Max 100 characters'),
  description: z.string().min(1, 'Description is required').max(500, 'Max 500 characters'),
  authorId: z.string().min(1, 'Author is required'),
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

  const form = useForm<TemplateFormData>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      name: '',
      description: '',
      authorId: session?.user?.id || '',
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
        workflowId,
        name: data.name,
        description: data.description || '',
        author: authorName,
        authorType,
        // Note: template state is handled by the API (copies from active deployment version)
      }

      // Only include organizationId if it's defined
      if (organizationId) {
        templateData.organizationId = organizationId
      }

      let response
      if (existingTemplate) {
        response = await fetch(`/api/templates/${existingTemplate.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(templateData),
        })
      } else {
        response = await fetch('/api/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(templateData),
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
        <>
          <div className='flex items-center justify-between rounded-lg border bg-muted/40 p-4'>
            <div className='flex items-center gap-3'>
              <div className='text-sm'>
                <div className='flex items-center gap-2'>
                  <span className='font-medium'>Template Published</span>
                  {existingTemplate.status === 'pending' && (
                    <span className='rounded-md bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'>
                      Under Review
                    </span>
                  )}
                </div>
                <div className='text-muted-foreground text-xs'>
                  {existingTemplate.stars > 0 && (
                    <>
                      <Star className='mr-1 inline h-3 w-3' />
                      {existingTemplate.stars} stars
                    </>
                  )}
                  {existingTemplate.views > 0 && (
                    <span className='ml-2'>{existingTemplate.views} views</span>
                  )}
                </div>
              </div>
            </div>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setShowDeleteDialog(true)}
              className='text-red-600 hover:bg-red-50'
            >
              <Trash2 className='mr-2 h-4 w-4' />
              Delete
            </Button>
          </div>
        </>
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

          <div className='flex justify-end gap-2 pt-4'>
            {existingTemplate && (
              <Button
                type='button'
                variant='outline'
                onClick={() => setShowDeleteDialog(true)}
                className='text-red-600 hover:bg-red-50'
              >
                <Trash2 className='mr-2 h-4 w-4' />
                Delete Template
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
    </div>
  )
}
