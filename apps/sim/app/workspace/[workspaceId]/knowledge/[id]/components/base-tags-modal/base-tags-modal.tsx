'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  Button,
  Combobox,
  type ComboboxOption,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Trash,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { SUPPORTED_FIELD_TYPES, TAG_SLOT_CONFIG } from '@/lib/knowledge/constants'
import { getDocumentIcon } from '@/app/workspace/[workspaceId]/knowledge/components'
import {
  type TagDefinition,
  useKnowledgeBaseTagDefinitions,
} from '@/hooks/kb/use-knowledge-base-tag-definitions'
import { useCreateTagDefinition, useDeleteTagDefinition } from '@/hooks/queries/knowledge'

const logger = createLogger('BaseTagsModal')

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  boolean: 'Boolean',
}

interface TagUsageData {
  tagName: string
  tagSlot: string
  documentCount: number
  documents: Array<{ id: string; name: string; tagValue: string }>
}

interface DocumentListProps {
  documents: Array<{ id: string; name: string; tagValue: string }>
  totalCount: number
}

function DocumentList({ documents, totalCount }: DocumentListProps) {
  const displayLimit = 5
  const hasMore = totalCount > displayLimit

  return (
    <div className='rounded-[4px] border'>
      <div className='max-h-[160px] overflow-y-auto'>
        {documents.slice(0, displayLimit).map((doc) => {
          const DocumentIcon = getDocumentIcon('', doc.name)
          return (
            <div
              key={doc.id}
              className='flex items-center gap-[8px] border-b p-[8px] last:border-b-0'
            >
              <DocumentIcon className='h-4 w-4 flex-shrink-0 text-[var(--text-muted)]' />
              <span className='min-w-0 max-w-[120px] truncate text-[12px] text-[var(--text-primary)]'>
                {doc.name}
              </span>
              {doc.tagValue && (
                <>
                  <div className='mb-[-1.5px] h-[14px] w-[1.25px] flex-shrink-0 rounded-full bg-[#3A3A3A]' />
                  <span className='min-w-0 flex-1 truncate text-[11px] text-[var(--text-muted)]'>
                    {doc.tagValue}
                  </span>
                </>
              )}
            </div>
          )
        })}
        {hasMore && (
          <div className='p-[8px] text-[11px] text-[var(--text-muted)]'>
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
  const { tagDefinitions: kbTagDefinitions, fetchTagDefinitions: refreshTagDefinitions } =
    useKnowledgeBaseTagDefinitions(knowledgeBaseId)

  const createTagMutation = useCreateTagDefinition()
  const deleteTagMutation = useDeleteTagDefinition()

  const [deleteTagDialogOpen, setDeleteTagDialogOpen] = useState(false)
  const [selectedTag, setSelectedTag] = useState<TagDefinition | null>(null)
  const [viewDocumentsDialogOpen, setViewDocumentsDialogOpen] = useState(false)
  const [tagUsageData, setTagUsageData] = useState<TagUsageData[]>([])
  const [isCreatingTag, setIsCreatingTag] = useState(false)
  const [createTagForm, setCreateTagForm] = useState({
    displayName: '',
    fieldType: 'text',
  })

  const fetchTagUsage = useCallback(async () => {
    if (!knowledgeBaseId) return

    try {
      const response = await fetch(`/api/knowledge/${knowledgeBaseId}/tag-usage`)
      if (!response.ok) {
        throw new Error('Failed to fetch tag usage')
      }
      const result = await response.json()
      if (result.success) {
        setTagUsageData(result.data)
      }
    } catch (error) {
      logger.error('Error fetching tag usage:', error)
    }
  }, [knowledgeBaseId])

  useEffect(() => {
    if (open) {
      fetchTagUsage()
    }
  }, [open, fetchTagUsage])

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
    await fetchTagUsage()
    setDeleteTagDialogOpen(true)
  }

  const handleViewDocuments = async (tag: TagDefinition) => {
    setSelectedTag(tag)
    await fetchTagUsage()
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
    return SUPPORTED_FIELD_TYPES.filter((type) => hasAvailableSlots(type)).map((type) => {
      const { used, max } = getSlotUsageByFieldType(type)
      return {
        value: type,
        label: `${FIELD_TYPE_LABELS[type]} (${used}/${max})`,
      }
    })
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

      await Promise.all([refreshTagDefinitions(), fetchTagUsage()])

      setCreateTagForm({
        displayName: '',
        fieldType: 'text',
      })
      setIsCreatingTag(false)
    } catch (error) {
      logger.error('Error creating tag definition:', error)
    }
  }

  const confirmDeleteTag = async () => {
    if (!selectedTag) return

    try {
      await deleteTagMutation.mutateAsync({
        knowledgeBaseId,
        tagDefinitionId: selectedTag.id,
      })

      await Promise.all([refreshTagDefinitions(), fetchTagUsage()])

      setDeleteTagDialogOpen(false)
      setSelectedTag(null)
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
      <Modal open={open} onOpenChange={handleClose}>
        <ModalContent size='sm'>
          <ModalHeader>
            <div className='flex items-center justify-between'>
              <span>Tags</span>
            </div>
          </ModalHeader>

          <ModalBody>
            <div className='min-h-0 flex-1 overflow-y-auto'>
              <div className='space-y-[8px]'>
                <Label>
                  Tags:{' '}
                  <span className='pl-[6px] text-[var(--text-tertiary)]'>
                    {kbTagDefinitions.length} defined
                  </span>
                </Label>

                {kbTagDefinitions.length === 0 && !isCreatingTag && (
                  <div className='rounded-[6px] border p-[16px] text-center'>
                    <p className='text-[12px] text-[var(--text-tertiary)]'>
                      No tag definitions yet. Create your first tag to organize documents.
                    </p>
                  </div>
                )}

                {kbTagDefinitions.map((tag) => {
                  const usage = getTagUsage(tag.tagSlot)
                  return (
                    <div
                      key={tag.id}
                      className='flex cursor-pointer items-center gap-2 rounded-[4px] border p-[8px] hover:bg-[var(--surface-2)]'
                      onClick={() => handleViewDocuments(tag)}
                    >
                      <span className='min-w-0 truncate text-[12px] text-[var(--text-primary)]'>
                        {tag.displayName}
                      </span>
                      <span className='rounded-[3px] bg-[var(--surface-3)] px-[6px] py-[2px] text-[10px] text-[var(--text-muted)]'>
                        {FIELD_TYPE_LABELS[tag.fieldType] || tag.fieldType}
                      </span>
                      <div className='mb-[-1.5px] h-[14px] w-[1.25px] flex-shrink-0 rounded-full bg-[#3A3A3A]' />
                      <span className='min-w-0 flex-1 text-[11px] text-[var(--text-muted)]'>
                        {usage.documentCount} document{usage.documentCount !== 1 ? 's' : ''}
                      </span>
                      <div className='flex flex-shrink-0 items-center gap-1'>
                        <Button
                          variant='ghost'
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteTagClick(tag)
                          }}
                          className='h-4 w-4 p-0 text-[var(--text-muted)] hover:text-[var(--text-error)]'
                        >
                          <Trash className='h-3 w-3' />
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
                  <div className='space-y-[8px] rounded-[6px] border p-[12px]'>
                    <div className='flex flex-col gap-[8px]'>
                      <Label htmlFor='tagName'>Tag Name</Label>
                      <Input
                        id='tagName'
                        value={createTagForm.displayName}
                        onChange={(e) =>
                          setCreateTagForm({ ...createTagForm, displayName: e.target.value })
                        }
                        placeholder='Enter tag name'
                        className={cn(tagNameConflict && 'border-[var(--text-error)]')}
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
                      {tagNameConflict && (
                        <span className='text-[12px] text-[var(--text-error)]'>
                          A tag with this name already exists
                        </span>
                      )}
                    </div>

                    <div className='flex flex-col gap-[8px]'>
                      <Label htmlFor='tagType'>Type</Label>
                      <Combobox
                        options={fieldTypeOptions}
                        value={createTagForm.fieldType}
                        onChange={(value) =>
                          setCreateTagForm({ ...createTagForm, fieldType: value })
                        }
                        placeholder='Select type'
                      />
                      {!hasAvailableSlots(createTagForm.fieldType) && (
                        <span className='text-[12px] text-[var(--text-error)]'>
                          No available slots for this type. Choose a different type.
                        </span>
                      )}
                    </div>

                    <div className='flex gap-[8px]'>
                      <Button variant='default' onClick={cancelCreatingTag} className='flex-1'>
                        Cancel
                      </Button>
                      <Button
                        variant='tertiary'
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
            </div>
          </ModalBody>

          <ModalFooter>
            <Button variant='default' onClick={() => handleClose(false)}>
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Delete Tag Confirmation Dialog */}
      <Modal open={deleteTagDialogOpen} onOpenChange={setDeleteTagDialogOpen}>
        <ModalContent size='sm'>
          <ModalHeader>Delete Tag</ModalHeader>
          <ModalBody>
            <div className='space-y-[8px]'>
              <p className='text-[12px] text-[var(--text-secondary)]'>
                Are you sure you want to delete the "{selectedTag?.displayName}" tag? This will
                remove this tag from {selectedTagUsage?.documentCount || 0} document
                {selectedTagUsage?.documentCount !== 1 ? 's' : ''}.{' '}
                <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
              </p>

              {selectedTagUsage && selectedTagUsage.documentCount > 0 && (
                <div className='flex flex-col gap-[8px]'>
                  <Label>Affected documents:</Label>
                  <DocumentList
                    documents={selectedTagUsage.documents}
                    totalCount={selectedTagUsage.documentCount}
                  />
                </div>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              disabled={deleteTagMutation.isPending}
              onClick={() => setDeleteTagDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={confirmDeleteTag}
              disabled={deleteTagMutation.isPending}
            >
              {deleteTagMutation.isPending ? 'Deleting...' : 'Delete Tag'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* View Documents Dialog */}
      <Modal open={viewDocumentsDialogOpen} onOpenChange={setViewDocumentsDialogOpen}>
        <ModalContent size='sm'>
          <ModalHeader>Documents using "{selectedTag?.displayName}"</ModalHeader>
          <ModalBody>
            <div className='space-y-[8px]'>
              <p className='text-[12px] text-[var(--text-secondary)]'>
                {selectedTagUsage?.documentCount || 0} document
                {selectedTagUsage?.documentCount !== 1 ? 's are' : ' is'} currently using this tag
                definition.
              </p>

              {selectedTagUsage?.documentCount === 0 ? (
                <div className='rounded-[6px] border p-[16px] text-center'>
                  <p className='text-[12px] text-[var(--text-secondary)]'>
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
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setViewDocumentsDialogOpen(false)}>
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
