'use client'

import { useMemo, useState } from 'react'
import {
  Button,
  ChipCombobox,
  ChipConfirmModal,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  type ComboboxOption,
  handleKeyboardActivation,
  Trash,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import type { TagUsageData } from '@/lib/api/contracts/knowledge'
import { SUPPORTED_FIELD_TYPES, TAG_SLOT_CONFIG } from '@/lib/knowledge/constants'
import { getDocumentIcon } from '@/app/workspace/[workspaceId]/knowledge/components'
import {
  type TagDefinition,
  useKnowledgeBaseTagDefinitions,
} from '@/hooks/kb/use-knowledge-base-tag-definitions'
import {
  useCreateTagDefinition,
  useDeleteTagDefinition,
  useTagUsageQuery,
} from '@/hooks/queries/kb/knowledge'

const logger = createLogger('BaseTagsModal')

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  boolean: 'Boolean',
}

interface DocumentListProps {
  documents: Array<{ id: string; name: string; tagValue: string }>
  totalCount: number
}

function DocumentList({ documents, totalCount }: DocumentListProps) {
  const displayLimit = 5
  const hasMore = totalCount > displayLimit

  return (
    <div className='rounded-sm border'>
      <div className='max-h-[160px] overflow-y-auto'>
        {documents.slice(0, displayLimit).map((doc) => {
          const DocumentIcon = getDocumentIcon('', doc.name)
          return (
            <div key={doc.id} className='flex items-center gap-2 border-b p-2 last:border-b-0'>
              <DocumentIcon className='size-4 flex-shrink-0 text-[var(--text-muted)]' />
              <span className='min-w-0 max-w-[120px] truncate text-[var(--text-primary)] text-caption'>
                {doc.name}
              </span>
              {doc.tagValue && (
                <>
                  <div className='mb-[-1.5px] h-[14px] w-[1.25px] flex-shrink-0 rounded-full bg-[var(--border-1)]' />
                  <span className='min-w-0 flex-1 truncate text-[var(--text-muted)] text-caption'>
                    {doc.tagValue}
                  </span>
                </>
              )}
            </div>
          )
        })}
        {hasMore && (
          <div className='p-2 text-[var(--text-muted)] text-caption'>
            and {totalCount - displayLimit} more documents
          </div>
        )}
      </div>
    </div>
  )
}

interface BaseTagsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  knowledgeBaseId: string
}

export function BaseTagsModal({ open, onOpenChange, knowledgeBaseId }: BaseTagsModalProps) {
  const { tagDefinitions: kbTagDefinitions } = useKnowledgeBaseTagDefinitions(knowledgeBaseId)

  const createTagMutation = useCreateTagDefinition()
  const deleteTagMutation = useDeleteTagDefinition()

  const [deleteTagDialogOpen, setDeleteTagDialogOpen] = useState(false)
  const [selectedTag, setSelectedTag] = useState<TagDefinition | null>(null)
  const [viewDocumentsDialogOpen, setViewDocumentsDialogOpen] = useState(false)
  const [isCreatingTag, setIsCreatingTag] = useState(false)
  const [createTagForm, setCreateTagForm] = useState({
    displayName: '',
    fieldType: 'text',
  })

  const { data: tagUsageData = [], refetch: refetchTagUsage } = useTagUsageQuery(knowledgeBaseId, {
    enabled: open,
  })

  const getTagUsage = (tagSlot: string): TagUsageData => {
    return (
      tagUsageData.find((usage) => usage.tagSlot === tagSlot) || {
        tagName: '',
        tagSlot,
        documentCount: 0,
        documents: [],
      }
    )
  }

  const handleDeleteTagClick = async (tag: TagDefinition) => {
    setSelectedTag(tag)
    await refetchTagUsage()
    setDeleteTagDialogOpen(true)
  }

  const handleViewDocuments = async (tag: TagDefinition) => {
    setSelectedTag(tag)
    await refetchTagUsage()
    setViewDocumentsDialogOpen(true)
  }

  const openTagCreator = () => {
    setCreateTagForm({
      displayName: '',
      fieldType: 'text',
    })
    setIsCreatingTag(true)
  }

  const cancelCreatingTag = () => {
    setCreateTagForm({
      displayName: '',
      fieldType: 'text',
    })
    setIsCreatingTag(false)
  }

  const hasTagNameConflict = (name: string) => {
    if (!name.trim()) return false
    return kbTagDefinitions.some(
      (tag) => tag.displayName.toLowerCase() === name.trim().toLowerCase()
    )
  }

  const tagNameConflict =
    isCreatingTag && !createTagMutation.isPending && hasTagNameConflict(createTagForm.displayName)

  const canSaveTag = () => {
    return createTagForm.displayName.trim() && !hasTagNameConflict(createTagForm.displayName)
  }

  const getSlotUsageByFieldType = (fieldType: string): { used: number; max: number } => {
    const config = TAG_SLOT_CONFIG[fieldType as keyof typeof TAG_SLOT_CONFIG]
    if (!config) return { used: 0, max: 0 }
    const used = kbTagDefinitions.filter((def) => def.fieldType === fieldType).length
    return { used, max: config.maxSlots }
  }

  const hasAvailableSlots = (fieldType: string): boolean => {
    const { used, max } = getSlotUsageByFieldType(fieldType)
    return used < max
  }

  const fieldTypeOptions: ComboboxOption[] = useMemo(() => {
    return SUPPORTED_FIELD_TYPES.reduce<ComboboxOption[]>((acc, type) => {
      const { used, max } = getSlotUsageByFieldType(type)
      if (used < max) {
        acc.push({ value: type, label: `${FIELD_TYPE_LABELS[type]} (${used}/${max})` })
      }
      return acc
    }, [])
  }, [kbTagDefinitions])

  const saveTagDefinition = async () => {
    if (!canSaveTag()) return

    try {
      if (!hasAvailableSlots(createTagForm.fieldType)) {
        throw new Error(`No available slots for ${createTagForm.fieldType} type`)
      }

      await createTagMutation.mutateAsync({
        knowledgeBaseId,
        displayName: createTagForm.displayName.trim(),
        fieldType: createTagForm.fieldType,
      })

      setCreateTagForm({
        displayName: '',
        fieldType: 'text',
      })
      setIsCreatingTag(false)
    } catch (error) {
      logger.error('Error creating tag definition:', error)
    }
  }

  const closeDeleteTagDialog = () => {
    setDeleteTagDialogOpen(false)
    setSelectedTag(null)
  }

  const confirmDeleteTag = async () => {
    if (!selectedTag) return

    try {
      await deleteTagMutation.mutateAsync({
        knowledgeBaseId,
        tagDefinitionId: selectedTag.id,
      })

      closeDeleteTagDialog()
    } catch (error) {
      logger.error('Error deleting tag definition:', error)
    }
  }

  const selectedTagUsage = selectedTag ? getTagUsage(selectedTag.tagSlot) : null

  const handleClose = (openState: boolean) => {
    if (!openState) {
      setIsCreatingTag(false)
      setCreateTagForm({
        displayName: '',
        fieldType: 'text',
      })
    }
    onOpenChange(openState)
  }

  return (
    <>
      <ChipModal open={open} onOpenChange={handleClose} srTitle='Tags' size='sm'>
        <ChipModalHeader onClose={() => handleClose(false)}>
          <div className='flex items-center justify-between'>
            <span>Tags</span>
          </div>
        </ChipModalHeader>

        <ChipModalBody>
          <ChipModalField
            type='custom'
            title={
              <>
                Tags:{' '}
                <span className='pl-1.5 text-[var(--text-tertiary)]'>
                  {kbTagDefinitions.length} defined
                </span>
              </>
            }
          >
            <div className='flex flex-col gap-2'>
              {kbTagDefinitions.length === 0 && !isCreatingTag && (
                <div className='rounded-md border p-4 text-center'>
                  <p className='text-[var(--text-tertiary)] text-caption'>
                    No tag definitions yet. Create your first tag to organize documents.
                  </p>
                </div>
              )}

              {kbTagDefinitions.map((tag) => {
                const usage = getTagUsage(tag.tagSlot)
                return (
                  <div
                    key={tag.id}
                    role='button'
                    tabIndex={0}
                    className='flex cursor-pointer items-center gap-2 rounded-sm border p-2 hover-hover:bg-[var(--surface-2)]'
                    onClick={() => handleViewDocuments(tag)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return
                      handleKeyboardActivation(event, () => handleViewDocuments(tag))
                    }}
                  >
                    <span className='min-w-0 truncate text-[var(--text-primary)] text-caption'>
                      {tag.displayName}
                    </span>
                    <span className='rounded-[3px] bg-[var(--surface-3)] px-1.5 py-0.5 text-[var(--text-muted)] text-micro'>
                      {FIELD_TYPE_LABELS[tag.fieldType] || tag.fieldType}
                    </span>
                    <div className='mb-[-1.5px] h-[14px] w-[1.25px] flex-shrink-0 rounded-full bg-[var(--border-1)]' />
                    <span className='min-w-0 flex-1 text-[var(--text-muted)] text-caption'>
                      {usage.documentCount} document{usage.documentCount !== 1 ? 's' : ''}
                    </span>
                    <div className='flex flex-shrink-0 items-center gap-1'>
                      <Button
                        variant='ghost'
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteTagClick(tag)
                        }}
                        className='size-4 p-0 text-[var(--text-muted)] hover-hover:text-[var(--text-error)]'
                      >
                        <Trash className='size-3' />
                      </Button>
                    </div>
                  </div>
                )
              })}

              {!isCreatingTag && (
                <Button
                  variant='default'
                  onClick={openTagCreator}
                  disabled={!SUPPORTED_FIELD_TYPES.some((type) => hasAvailableSlots(type))}
                  className='w-full'
                >
                  Add Tag
                </Button>
              )}

              {isCreatingTag && (
                <div className='space-y-2 rounded-md border p-3'>
                  <ChipModalField
                    type='custom'
                    title='Tag Name'
                    flush
                    error={tagNameConflict ? 'A tag with this name already exists' : undefined}
                  >
                    <ChipInput
                      value={createTagForm.displayName}
                      onChange={(e) =>
                        setCreateTagForm({ ...createTagForm, displayName: e.target.value })
                      }
                      placeholder='Enter tag name'
                      error={Boolean(tagNameConflict)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && canSaveTag()) {
                          e.preventDefault()
                          saveTagDefinition()
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          cancelCreatingTag()
                        }
                      }}
                    />
                  </ChipModalField>

                  <ChipModalField
                    type='custom'
                    title='Type'
                    flush
                    error={
                      !hasAvailableSlots(createTagForm.fieldType)
                        ? 'No available slots for this type. Choose a different type.'
                        : undefined
                    }
                  >
                    <ChipCombobox
                      options={fieldTypeOptions}
                      value={createTagForm.fieldType}
                      onChange={(value) => setCreateTagForm({ ...createTagForm, fieldType: value })}
                      placeholder='Select type'
                    />
                  </ChipModalField>

                  <div className='flex gap-2'>
                    <Button variant='default' onClick={cancelCreatingTag} className='flex-1'>
                      Cancel
                    </Button>
                    <Button
                      variant='primary'
                      onClick={saveTagDefinition}
                      className='flex-1'
                      disabled={
                        !canSaveTag() ||
                        createTagMutation.isPending ||
                        !hasAvailableSlots(createTagForm.fieldType)
                      }
                    >
                      {createTagMutation.isPending ? 'Creating...' : 'Create Tag'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </ChipModalField>
        </ChipModalBody>

        <ChipModalFooter
          onCancel={() => handleClose(false)}
          primaryAction={{ label: 'Close', onClick: () => handleClose(false) }}
        />
      </ChipModal>

      {/* Delete Tag Confirmation Dialog */}
      <ChipConfirmModal
        open={deleteTagDialogOpen}
        onOpenChange={(openState) => {
          if (openState) {
            setDeleteTagDialogOpen(true)
          } else {
            closeDeleteTagDialog()
          }
        }}
        srTitle='Delete Tag'
        title='Delete Tag'
        text={[
          'Are you sure you want to delete the ',
          { text: selectedTag?.displayName ?? 'selected', bold: true },
          ' tag? ',
          {
            text: `This will remove this tag from ${selectedTagUsage?.documentCount || 0} document${selectedTagUsage?.documentCount !== 1 ? 's' : ''}.`,
            error: true,
          },
          ' This action cannot be undone.',
        ]}
        confirm={{
          label: 'Delete Tag',
          onClick: confirmDeleteTag,
          pending: deleteTagMutation.isPending,
          pendingLabel: 'Deleting...',
        }}
      >
        {selectedTagUsage && selectedTagUsage.documentCount > 0 && (
          <ChipModalField type='custom' title='Affected documents'>
            <DocumentList
              documents={selectedTagUsage.documents}
              totalCount={selectedTagUsage.documentCount}
            />
          </ChipModalField>
        )}
      </ChipConfirmModal>

      {/* View Documents Dialog */}
      <ChipModal
        open={viewDocumentsDialogOpen}
        onOpenChange={setViewDocumentsDialogOpen}
        srTitle={`Documents using "${selectedTag?.displayName}"`}
        size='sm'
      >
        <ChipModalHeader onClose={() => setViewDocumentsDialogOpen(false)}>
          Documents using "{selectedTag?.displayName}"
        </ChipModalHeader>
        <ChipModalBody>
          <div className='flex flex-col gap-2 px-2'>
            <p className='text-[var(--text-secondary)]'>
              {selectedTagUsage?.documentCount || 0} document
              {selectedTagUsage?.documentCount !== 1 ? 's are' : ' is'} currently using this tag
              definition.
            </p>

            {selectedTagUsage?.documentCount === 0 ? (
              <div className='rounded-md border p-4 text-center'>
                <p className='text-[var(--text-secondary)]'>
                  This tag definition is not being used by any documents. You can safely delete it
                  to free up the tag slot.
                </p>
              </div>
            ) : (
              <DocumentList
                documents={selectedTagUsage?.documents || []}
                totalCount={selectedTagUsage?.documentCount || 0}
              />
            )}
          </div>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => setViewDocumentsDialogOpen(false)}
          primaryAction={{ label: 'Close', onClick: () => setViewDocumentsDialogOpen(false) }}
        />
      </ChipModal>
    </>
  )
}
