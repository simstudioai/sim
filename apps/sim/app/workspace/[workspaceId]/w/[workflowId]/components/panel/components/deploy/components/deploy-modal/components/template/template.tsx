'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { Button, Combobox, Input, Label, Textarea } from '@/components/emcn'
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn/components/modal-new/modal'
import { Skeleton, TagInput } from '@/components/ui'
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

interface TemplateFormData {
  name: string
  tagline: string
  about: string
  creatorId: string
  tags: string[]
}

const initialFormData: TemplateFormData = {
  name: '',
  tagline: '',
  about: '',
  creatorId: '',
  tags: [],
}

interface CreatorOption {
  id: string
  name: string
  referenceType: 'user' | 'organization'
  referenceId: string
}

interface TemplateStatus {
  status: 'pending' | 'approved' | 'rejected' | null
  views?: number
  stars?: number
}

interface TemplateDeployProps {
  workflowId: string
  onDeploymentComplete?: () => void
  onValidationChange?: (isValid: boolean) => void
  onSubmittingChange?: (isSubmitting: boolean) => void
  onExistingTemplateChange?: (exists: boolean) => void
  onTemplateStatusChange?: (status: TemplateStatus | null) => void
}

export function TemplateDeploy({
  workflowId,
  onDeploymentComplete,
  onValidationChange,
  onSubmittingChange,
  onExistingTemplateChange,
  onTemplateStatusChange,
}: TemplateDeployProps) {
  const { data: session } = useSession()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [creatorOptions, setCreatorOptions] = useState<CreatorOption[]>([])
  const [loadingCreators, setLoadingCreators] = useState(false)

  const [formData, setFormData] = useState<TemplateFormData>(initialFormData)

  const { data: existingTemplate, isLoading: isLoadingTemplate } = useTemplateByWorkflow(workflowId)
  const createMutation = useCreateTemplate()
  const updateMutation = useUpdateTemplate()
  const deleteMutation = useDeleteTemplate()

  const isSubmitting = createMutation.isPending || updateMutation.isPending
  const isFormValid = formData.name.trim().length > 0 && formData.name.length <= 100

  const updateField = <K extends keyof TemplateFormData>(field: K, value: TemplateFormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  useEffect(() => {
    onValidationChange?.(isFormValid)
  }, [isFormValid, onValidationChange])

  useEffect(() => {
    onSubmittingChange?.(isSubmitting)
  }, [isSubmitting, onSubmittingChange])

  useEffect(() => {
    onExistingTemplateChange?.(!!existingTemplate)
  }, [existingTemplate, onExistingTemplateChange])

  useEffect(() => {
    if (existingTemplate) {
      onTemplateStatusChange?.({
        status: existingTemplate.status as 'pending' | 'approved' | 'rejected',
        views: existingTemplate.views,
        stars: existingTemplate.stars,
      })
    } else {
      onTemplateStatusChange?.(null)
    }
  }, [existingTemplate, onTemplateStatusChange])

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
    if (creatorOptions.length === 1 && !formData.creatorId) {
      updateField('creatorId', creatorOptions[0].id)
      logger.info('Auto-selected single creator profile:', creatorOptions[0].name)
    }
  }, [creatorOptions, formData.creatorId])

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
      setFormData({
        name: existingTemplate.name,
        tagline: existingTemplate.details?.tagline || '',
        about: existingTemplate.details?.about || '',
        creatorId: existingTemplate.creatorId || '',
        tags: existingTemplate.tags || [],
      })
    }
  }, [existingTemplate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!session?.user || !isFormValid) {
      logger.error('User not authenticated or form invalid')
      return
    }

    try {
      const templateData = {
        name: formData.name.trim(),
        details: {
          tagline: formData.tagline.trim(),
          about: formData.about.trim(),
        },
        creatorId: formData.creatorId || undefined,
        tags: formData.tags,
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
      setFormData(initialFormData)
    } catch (error) {
      logger.error('Error deleting template:', error)
    }
  }

  if (isLoadingTemplate) {
    return (
      <div className='space-y-[12px]'>
        <div>
          <Skeleton className='mb-[6.5px] h-[16px] w-[40px]' />
          <Skeleton className='h-[34px] w-full rounded-[4px]' />
        </div>
        <div>
          <Skeleton className='mb-[6.5px] h-[16px] w-[50px]' />
          <Skeleton className='h-[34px] w-full rounded-[4px]' />
        </div>
        <div>
          <Skeleton className='mb-[6.5px] h-[16px] w-[76px]' />
          <Skeleton className='h-[160px] w-full rounded-[4px]' />
        </div>
        <div>
          <Skeleton className='mb-[6.5px] h-[16px] w-[50px]' />
          <Skeleton className='h-[34px] w-full rounded-[4px]' />
        </div>
        <div>
          <Skeleton className='mb-[6.5px] h-[16px] w-[32px]' />
          <Skeleton className='h-[34px] w-full rounded-[4px]' />
        </div>
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      <form id='template-deploy-form' onSubmit={handleSubmit} className='space-y-[12px]'>
        {existingTemplate?.state && (
          <div>
            <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
              Live Template
            </Label>
            <div
              className='[&_*]:!cursor-default relative h-[260px] w-full cursor-default overflow-hidden rounded-[4px] border border-[var(--border)]'
              onWheelCapture={(e) => {
                if (e.ctrlKey || e.metaKey) return
                e.stopPropagation()
              }}
            >
              <TemplatePreviewContent existingTemplate={existingTemplate} />
            </div>
          </div>
        )}

        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            Name
          </Label>
          <Input
            placeholder='Deep Research Agent'
            value={formData.name}
            onChange={(e) => updateField('name', e.target.value)}
            disabled={isSubmitting}
          />
        </div>

        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            Tagline
          </Label>
          <Input
            placeholder='A deep research agent that can find information on any topic'
            value={formData.tagline}
            onChange={(e) => updateField('tagline', e.target.value)}
            disabled={isSubmitting}
          />
        </div>

        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            Description
          </Label>
          <Textarea
            placeholder='Optional description that supports Markdown'
            className='min-h-[160px] resize-none'
            value={formData.about}
            onChange={(e) => updateField('about', e.target.value)}
            disabled={isSubmitting}
          />
        </div>

        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            Creator
          </Label>
          {creatorOptions.length === 0 && !loadingCreators ? (
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
          ) : (
            <Combobox
              options={creatorOptions.map((option) => ({
                label: option.name,
                value: option.id,
              }))}
              value={formData.creatorId}
              selectedValue={formData.creatorId}
              onChange={(value) => updateField('creatorId', value)}
              placeholder={loadingCreators ? 'Loading...' : 'Select creator profile'}
              editable={false}
              filterOptions={false}
              disabled={loadingCreators || isSubmitting}
            />
          )}
        </div>

        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            Tags
          </Label>
          <TagInput
            value={formData.tags}
            onChange={(tags) => updateField('tags', tags)}
            placeholder='Dev, Agents, Research, etc.'
            maxTags={10}
            disabled={isSubmitting}
          />
        </div>

        <button
          type='button'
          data-template-delete-trigger
          onClick={() => setShowDeleteDialog(true)}
          style={{ display: 'none' }}
        />
      </form>

      <Modal open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <ModalContent className='w-[400px]'>
          <ModalHeader>Delete Template</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-tertiary)]'>
              Are you sure you want to delete this template?{' '}
              <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant='primary'
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className='bg-[var(--text-error)] text-[13px] text-white hover:bg-[var(--text-error)] dark:bg-[var(--text-error)] dark:hover:bg-[var(--text-error)]'
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}

interface TemplatePreviewContentProps {
  existingTemplate:
    | {
        id: string
        state?: Partial<WorkflowState>
      }
    | null
    | undefined
}

function TemplatePreviewContent({ existingTemplate }: TemplatePreviewContentProps) {
  if (!existingTemplate?.state || !existingTemplate.state.blocks) {
    return null
  }

  const workflowState: WorkflowState = {
    blocks: existingTemplate.state.blocks,
    edges: existingTemplate.state.edges ?? [],
    loops: existingTemplate.state.loops ?? {},
    parallels: existingTemplate.state.parallels ?? {},
    lastSaved: existingTemplate.state.lastSaved ?? Date.now(),
  }

  return (
    <WorkflowPreview
      key={`template-preview-${existingTemplate.id}`}
      workflowState={workflowState}
      showSubBlocks={true}
      height='100%'
      width='100%'
      isPannable={true}
      defaultPosition={{ x: 0, y: 0 }}
      defaultZoom={0.6}
    />
  )
}
