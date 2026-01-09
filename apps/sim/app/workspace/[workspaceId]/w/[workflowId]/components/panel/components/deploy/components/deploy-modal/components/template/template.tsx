'use client'

import { forwardRef, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  Button,
  Combobox,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/components/emcn'
import { Skeleton, TagInput } from '@/components/ui'
import { useSession } from '@/lib/auth/auth-client'
import { cn } from '@/lib/core/utils/cn'
import { captureAndUploadOGImage, OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from '@/lib/og'
import { WorkflowPreview } from '@/app/workspace/[workspaceId]/w/components/preview'
import {
  useCreateTemplate,
  useDeleteTemplate,
  useTemplateByWorkflow,
  useUpdateTemplate,
} from '@/hooks/queries/templates'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
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
  const [isCapturing, setIsCapturing] = useState(false)
  const previewContainerRef = useRef<HTMLDivElement>(null)
  const ogCaptureRef = useRef<HTMLDivElement>(null)

  const [formData, setFormData] = useState<TemplateFormData>(initialFormData)

  const { data: existingTemplate, isLoading: isLoadingTemplate } = useTemplateByWorkflow(workflowId)
  const createMutation = useCreateTemplate()
  const updateMutation = useUpdateTemplate()
  const deleteMutation = useDeleteTemplate()

  const isSubmitting = createMutation.isPending || updateMutation.isPending
  const isFormValid =
    formData.name.trim().length > 0 &&
    formData.name.length <= 100 &&
    formData.tagline.length <= 200 &&
    formData.creatorId.length > 0

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
      const response = await fetch('/api/creators')
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
        creatorId: formData.creatorId,
        tags: formData.tags,
      }

      let templateId: string

      if (existingTemplate) {
        await updateMutation.mutateAsync({
          id: existingTemplate.id,
          data: {
            ...templateData,
            updateState: true,
          },
        })
        templateId = existingTemplate.id
      } else {
        const result = await createMutation.mutateAsync({ ...templateData, workflowId })
        templateId = result.id
      }

      logger.info(`Template ${existingTemplate ? 'updated' : 'created'} successfully`)

      setIsCapturing(true)
      requestAnimationFrame(() => {
        requestAnimationFrame(async () => {
          try {
            if (ogCaptureRef.current) {
              const ogUrl = await captureAndUploadOGImage(ogCaptureRef.current, templateId)
              if (ogUrl) {
                logger.info(`OG image uploaded for template ${templateId}: ${ogUrl}`)
              }
            }
          } catch (ogError) {
            logger.warn('Failed to capture/upload OG image:', ogError)
          } finally {
            setIsCapturing(false)
          }
        })
      })

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
              ref={previewContainerRef}
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
            Name <span className='text-[var(--text-error)]'>*</span>
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
            className={cn(formData.tagline.length > 200 && 'border-[var(--text-error)]')}
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
            Creator <span className='text-[var(--text-error)]'>*</span>
          </Label>
          {creatorOptions.length === 0 && !loadingCreators ? (
            <div className='space-y-[8px]'>
              <p className='text-[12px] text-[var(--text-tertiary)]'>
                A creator profile is required to publish templates.
              </p>
              <Button
                type='button'
                variant='tertiary'
                onClick={() => {
                  try {
                    const event = new CustomEvent('open-settings', {
                      detail: { tab: 'template-profile' },
                    })
                    window.dispatchEvent(event)
                    logger.info('Opened Settings modal at template-profile section')
                  } catch (error) {
                    logger.error('Failed to open Settings modal for template profile', {
                      error,
                    })
                  }
                }}
                className='gap-[8px]'
              >
                <span>Create Template Profile</span>
              </Button>
            </div>
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
        <ModalContent size='sm'>
          <ModalHeader>Delete Template</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to delete this template?{' '}
              <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Hidden container for OG image capture */}
      {isCapturing && <OGCaptureContainer ref={ogCaptureRef} />}
    </div>
  )
}

/**
 * Hidden container for OG image capture.
 * Lazy-rendered only when capturing - gets workflow state from store on mount.
 */
const OGCaptureContainer = forwardRef<HTMLDivElement>((_, ref) => {
  const blocks = useWorkflowStore((state) => state.blocks)
  const edges = useWorkflowStore((state) => state.edges)
  const loops = useWorkflowStore((state) => state.loops)
  const parallels = useWorkflowStore((state) => state.parallels)

  if (!blocks || Object.keys(blocks).length === 0) {
    return null
  }

  const workflowState: WorkflowState = {
    blocks,
    edges: edges ?? [],
    loops: loops ?? {},
    parallels: parallels ?? {},
    lastSaved: Date.now(),
  }

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        left: '-9999px',
        top: '-9999px',
        width: OG_IMAGE_WIDTH,
        height: OG_IMAGE_HEIGHT,
        backgroundColor: '#0c0c0c',
        overflow: 'hidden',
      }}
      aria-hidden='true'
    >
      <WorkflowPreview
        workflowState={workflowState}
        height='100%'
        width='100%'
        isPannable={false}
        defaultZoom={0.8}
        fitPadding={0.2}
        lightweight
      />
    </div>
  )
})

OGCaptureContainer.displayName = 'OGCaptureContainer'

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
      height='100%'
      width='100%'
      isPannable={true}
      defaultPosition={{ x: 0, y: 0 }}
      defaultZoom={0.6}
    />
  )
}
