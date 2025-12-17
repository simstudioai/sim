'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
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
  Switch,
  Trash,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { ALL_TAG_SLOTS, type AllTagSlot } from '@/lib/knowledge/constants'
import type { DocumentTag } from '@/lib/knowledge/tags/types'
import { createLogger } from '@/lib/logs/console/logger'
import {
  type TagDefinition,
  useKnowledgeBaseTagDefinitions,
} from '@/hooks/use-knowledge-base-tag-definitions'
import { useNextAvailableSlot } from '@/hooks/use-next-available-slot'
import { type TagDefinitionInput, useTagDefinitions } from '@/hooks/use-tag-definitions'
import { type DocumentData, useKnowledgeStore } from '@/stores/knowledge/store'

const logger = createLogger('DocumentTagsModal')

/** Field type display labels */
const FIELD_TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  boolean: 'Boolean',
}

/** Format value for display based on field type */
function formatValueForDisplay(value: string, fieldType: string): string {
  if (!value) return ''
  switch (fieldType) {
    case 'boolean':
      return value === 'true' ? 'Yes' : 'No'
    case 'date':
      try {
        return new Date(value).toLocaleDateString()
      } catch {
        return value
      }
    default:
      return value
  }
}

interface DocumentTagsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  knowledgeBaseId: string
  documentId: string
  documentData: DocumentData | null
  onDocumentUpdate?: (updates: Record<string, string>) => void
}

export function DocumentTagsModal({
  open,
  onOpenChange,
  knowledgeBaseId,
  documentId,
  documentData,
  onDocumentUpdate,
}: DocumentTagsModalProps) {
  const { updateDocument: updateDocumentInStore } = useKnowledgeStore()

  const documentTagHook = useTagDefinitions(knowledgeBaseId, documentId)
  const kbTagHook = useKnowledgeBaseTagDefinitions(knowledgeBaseId)
  const { getNextAvailableSlot: getServerNextSlot } = useNextAvailableSlot(knowledgeBaseId)

  const { saveTagDefinitions, tagDefinitions, fetchTagDefinitions } = documentTagHook
  const { tagDefinitions: kbTagDefinitions, fetchTagDefinitions: refreshTagDefinitions } = kbTagHook

  const [documentTags, setDocumentTags] = useState<DocumentTag[]>([])
  const [editingTagIndex, setEditingTagIndex] = useState<number | null>(null)
  const [isCreatingTag, setIsCreatingTag] = useState(false)
  const [isSavingTag, setIsSavingTag] = useState(false)
  const [editTagForm, setEditTagForm] = useState({
    displayName: '',
    fieldType: 'text',
    value: '',
  })

  const buildDocumentTags = useCallback((docData: DocumentData, definitions: TagDefinition[]) => {
    const tags: DocumentTag[] = []

    ALL_TAG_SLOTS.forEach((slot) => {
      const rawValue = docData[slot]
      const definition = definitions.find((def) => def.tagSlot === slot)

      if (rawValue !== null && rawValue !== undefined && definition) {
        // Convert value to string for storage
        const stringValue = String(rawValue).trim()
        if (stringValue) {
          tags.push({
            slot,
            displayName: definition.displayName,
            fieldType: definition.fieldType,
            value: stringValue,
          })
        }
      }
    })

    return tags
  }, [])

  const handleTagsChange = useCallback((newTags: DocumentTag[]) => {
    setDocumentTags(newTags)
  }, [])

  const handleSaveDocumentTags = useCallback(
    async (tagsToSave: DocumentTag[]) => {
      if (!documentData) return

      try {
        const tagData: Record<string, string | number | boolean | null> = {}

        // Initialize all slots to null
        ALL_TAG_SLOTS.forEach((slot) => {
          tagData[slot] = null
        })

        // Set values for tags that have data
        tagsToSave.forEach((tag) => {
          if (tag.value.trim()) {
            tagData[tag.slot] = tag.value.trim()
          }
        })

        const response = await fetch(`/api/knowledge/${knowledgeBaseId}/documents/${documentId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(tagData),
        })

        if (!response.ok) {
          throw new Error('Failed to update document tags')
        }

        updateDocumentInStore(knowledgeBaseId, documentId, tagData as Record<string, string>)
        onDocumentUpdate?.(tagData as Record<string, string>)

        await fetchTagDefinitions()
      } catch (error) {
        logger.error('Error updating document tags:', error)
        throw error
      }
    },
    [
      documentData,
      knowledgeBaseId,
      documentId,
      updateDocumentInStore,
      fetchTagDefinitions,
      onDocumentUpdate,
    ]
  )

  const handleRemoveTag = async (index: number) => {
    const updatedTags = documentTags.filter((_, i) => i !== index)
    handleTagsChange(updatedTags)

    try {
      await handleSaveDocumentTags(updatedTags)
    } catch (error) {
      logger.error('Error removing tag:', error)
    }
  }

  const startEditingTag = (index: number) => {
    const tag = documentTags[index]
    setEditingTagIndex(index)
    setEditTagForm({
      displayName: tag.displayName,
      fieldType: tag.fieldType,
      value: tag.value,
    })
    setIsCreatingTag(false)
  }

  const openTagCreator = () => {
    setEditingTagIndex(null)
    setEditTagForm({
      displayName: '',
      fieldType: 'text',
      value: '',
    })
    setIsCreatingTag(true)
  }

  const cancelEditingTag = () => {
    setEditTagForm({
      displayName: '',
      fieldType: 'text',
      value: '',
    })
    setEditingTagIndex(null)
    setIsCreatingTag(false)
  }

  const hasTagNameConflict = (name: string) => {
    if (!name.trim()) return false

    return documentTags.some((tag, index) => {
      if (editingTagIndex !== null && index === editingTagIndex) {
        return false
      }
      return tag.displayName.toLowerCase() === name.trim().toLowerCase()
    })
  }

  const availableDefinitions = kbTagDefinitions.filter((def) => {
    return !documentTags.some(
      (tag) => tag.displayName.toLowerCase() === def.displayName.toLowerCase()
    )
  })

  const tagNameOptions = availableDefinitions.map((def) => ({
    label: def.displayName,
    value: def.displayName,
  }))

  const saveDocumentTag = async () => {
    if (!editTagForm.displayName.trim() || !editTagForm.value.trim()) return

    const formData = { ...editTagForm }
    const currentEditingIndex = editingTagIndex
    const originalTag = currentEditingIndex !== null ? documentTags[currentEditingIndex] : null
    setEditingTagIndex(null)
    setIsCreatingTag(false)
    setIsSavingTag(true)

    try {
      let targetSlot: string

      if (currentEditingIndex !== null && originalTag) {
        targetSlot = originalTag.slot
      } else {
        const existingDefinition = kbTagDefinitions.find(
          (def) => def.displayName.toLowerCase() === formData.displayName.toLowerCase()
        )

        if (existingDefinition) {
          targetSlot = existingDefinition.tagSlot
        } else {
          const serverSlot = await getServerNextSlot(formData.fieldType)
          if (!serverSlot) {
            throw new Error(`No available slots for new tag of type '${formData.fieldType}'`)
          }
          targetSlot = serverSlot
        }
      }

      let updatedTags: DocumentTag[]
      if (currentEditingIndex !== null) {
        updatedTags = [...documentTags]
        updatedTags[currentEditingIndex] = {
          ...updatedTags[currentEditingIndex],
          displayName: formData.displayName,
          fieldType: formData.fieldType,
          value: formData.value,
        }
      } else {
        const newTag: DocumentTag = {
          slot: targetSlot,
          displayName: formData.displayName,
          fieldType: formData.fieldType,
          value: formData.value,
        }
        updatedTags = [...documentTags, newTag]
      }

      handleTagsChange(updatedTags)

      if (currentEditingIndex !== null && originalTag) {
        const currentDefinition = kbTagDefinitions.find(
          (def) => def.displayName.toLowerCase() === originalTag.displayName.toLowerCase()
        )

        if (currentDefinition) {
          const updatedDefinition: TagDefinitionInput = {
            displayName: formData.displayName,
            fieldType: currentDefinition.fieldType,
            tagSlot: currentDefinition.tagSlot,
            _originalDisplayName: originalTag.displayName,
          }

          if (saveTagDefinitions) {
            await saveTagDefinitions([updatedDefinition])
          }
          await refreshTagDefinitions()
        }
      } else {
        const existingDefinition = kbTagDefinitions.find(
          (def) => def.displayName.toLowerCase() === formData.displayName.toLowerCase()
        )

        if (!existingDefinition) {
          const newDefinition: TagDefinitionInput = {
            displayName: formData.displayName,
            fieldType: formData.fieldType,
            tagSlot: targetSlot as AllTagSlot,
          }

          if (saveTagDefinitions) {
            await saveTagDefinitions([newDefinition])
          }
          await refreshTagDefinitions()
        }
      }

      await handleSaveDocumentTags(updatedTags)

      setEditTagForm({
        displayName: '',
        fieldType: 'text',
        value: '',
      })
    } catch (error) {
      logger.error('Error saving tag:', error)
    } finally {
      setIsSavingTag(false)
    }
  }

  const isTagEditing = editingTagIndex !== null || isCreatingTag
  const tagNameConflict = hasTagNameConflict(editTagForm.displayName)

  const hasTagChanges = () => {
    if (editingTagIndex === null) return true

    const originalTag = documentTags[editingTagIndex]
    if (!originalTag) return true

    return (
      originalTag.displayName !== editTagForm.displayName ||
      originalTag.value !== editTagForm.value ||
      originalTag.fieldType !== editTagForm.fieldType
    )
  }

  const canSaveTag =
    editTagForm.displayName.trim() &&
    editTagForm.value.trim() &&
    !tagNameConflict &&
    hasTagChanges()

  const canAddNewTag = kbTagDefinitions.length < MAX_TAG_SLOTS || availableDefinitions.length > 0

  useEffect(() => {
    if (documentData && tagDefinitions && !isSavingTag) {
      const rebuiltTags = buildDocumentTags(documentData, tagDefinitions)
      setDocumentTags(rebuiltTags)
    }
  }, [documentData, tagDefinitions, buildDocumentTags, isSavingTag])

  const handleClose = (openState: boolean) => {
    if (!openState) {
      setIsCreatingTag(false)
      setEditingTagIndex(null)
      setEditTagForm({
        displayName: '',
        fieldType: 'text',
        value: '',
      })
    }
    onOpenChange(openState)
  }

  return (
    <Modal open={open} onOpenChange={handleClose}>
      <ModalContent>
        <ModalHeader>
          <div className='flex items-center justify-between'>
            <span>Document Tags</span>
          </div>
        </ModalHeader>

        <ModalBody className='!pb-[16px]'>
          <div className='min-h-0 flex-1 overflow-y-auto'>
            <div className='space-y-[8px]'>
              <Label>
                Tags{' '}
                <span className='pl-[6px] text-[var(--text-tertiary)]'>
                  {documentTags.length}/{MAX_TAG_SLOTS} slots used
                </span>
              </Label>

              {documentTags.length === 0 && !isCreatingTag && (
                <div className='rounded-[6px] border p-[16px] text-center'>
                  <p className='text-[12px] text-[var(--text-tertiary)]'>
                    No tags added yet. Add tags to help organize this document.
                  </p>
                </div>
              )}

              {documentTags.map((tag, index) => (
                <div key={index} className='space-y-[8px]'>
                  <div
                    className='flex cursor-pointer items-center gap-2 rounded-[4px] border p-[8px] hover:bg-[var(--surface-2)]'
                    onClick={() => startEditingTag(index)}
                  >
                    <span className='min-w-0 truncate text-[12px] text-[var(--text-primary)]'>
                      {tag.displayName}
                    </span>
                    <span className='rounded-[3px] bg-[var(--surface-3)] px-[6px] py-[2px] text-[10px] text-[var(--text-muted)]'>
                      {FIELD_TYPE_LABELS[tag.fieldType] || tag.fieldType}
                    </span>
                    <div className='mb-[-1.5px] h-[14px] w-[1.25px] flex-shrink-0 rounded-full bg-[#3A3A3A]' />
                    <span className='min-w-0 flex-1 truncate text-[11px] text-[var(--text-muted)]'>
                      {formatValueForDisplay(tag.value, tag.fieldType)}
                    </span>
                    <div className='flex flex-shrink-0 items-center gap-1'>
                      <Button
                        variant='ghost'
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemoveTag(index)
                        }}
                        className='h-4 w-4 p-0 text-[var(--text-muted)] hover:text-[var(--text-error)]'
                      >
                        <Trash className='h-3 w-3' />
                      </Button>
                    </div>
                  </div>

                  {editingTagIndex === index && (
                    <div className='space-y-[8px] rounded-[6px] border p-[12px]'>
                      <div className='flex flex-col gap-[8px]'>
                        <Label htmlFor={`tagName-${index}`}>Tag Name</Label>
                        {availableDefinitions.length > 0 ? (
                          <Combobox
                            id={`tagName-${index}`}
                            options={tagNameOptions}
                            value={editTagForm.displayName}
                            selectedValue={editTagForm.displayName}
                            onChange={(value) => {
                              const def = kbTagDefinitions.find(
                                (d) => d.displayName.toLowerCase() === value.toLowerCase()
                              )
                              setEditTagForm({
                                ...editTagForm,
                                displayName: value,
                                fieldType: def?.fieldType || 'text',
                              })
                            }}
                            placeholder='Enter or select tag name'
                            editable={true}
                            className={cn(tagNameConflict && 'border-[var(--text-error)]')}
                          />
                        ) : (
                          <Input
                            id={`tagName-${index}`}
                            value={editTagForm.displayName}
                            onChange={(e) =>
                              setEditTagForm({ ...editTagForm, displayName: e.target.value })
                            }
                            placeholder='Enter tag name'
                            className={cn(tagNameConflict && 'border-[var(--text-error)]')}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && canSaveTag) {
                                e.preventDefault()
                                saveDocumentTag()
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault()
                                cancelEditingTag()
                              }
                            }}
                          />
                        )}
                        {tagNameConflict && (
                          <span className='text-[11px] text-[var(--text-error)]'>
                            A tag with this name already exists
                          </span>
                        )}
                      </div>

                      <div className='flex flex-col gap-[8px]'>
                        <Label htmlFor={`tagValue-${index}`}>Value</Label>
                        {editTagForm.fieldType === 'boolean' ? (
                          <div className='flex items-center gap-2'>
                            <Switch
                              id={`tagValue-${index}`}
                              checked={editTagForm.value === 'true'}
                              onCheckedChange={(checked) =>
                                setEditTagForm({ ...editTagForm, value: String(checked) })
                              }
                            />
                            <span className='text-[12px] text-[var(--text-muted)]'>
                              {editTagForm.value === 'true' ? 'Yes' : 'No'}
                            </span>
                          </div>
                        ) : editTagForm.fieldType === 'number' ? (
                          <Input
                            id={`tagValue-${index}`}
                            type='number'
                            value={editTagForm.value}
                            onChange={(e) =>
                              setEditTagForm({ ...editTagForm, value: e.target.value })
                            }
                            placeholder='Enter number'
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && canSaveTag) {
                                e.preventDefault()
                                saveDocumentTag()
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault()
                                cancelEditingTag()
                              }
                            }}
                          />
                        ) : editTagForm.fieldType === 'date' ? (
                          <Input
                            id={`tagValue-${index}`}
                            type='datetime-local'
                            value={editTagForm.value ? editTagForm.value.slice(0, 16) : ''}
                            onChange={(e) =>
                              setEditTagForm({ ...editTagForm, value: new Date(e.target.value).toISOString() })
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.preventDefault()
                                cancelEditingTag()
                              }
                            }}
                          />
                        ) : (
                          <Input
                            id={`tagValue-${index}`}
                            value={editTagForm.value}
                            onChange={(e) =>
                              setEditTagForm({ ...editTagForm, value: e.target.value })
                            }
                            placeholder='Enter tag value'
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && canSaveTag) {
                                e.preventDefault()
                                saveDocumentTag()
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault()
                                cancelEditingTag()
                              }
                            }}
                          />
                        )}
                      </div>

                      <div className='flex gap-[8px]'>
                        <Button variant='default' onClick={cancelEditingTag} className='flex-1'>
                          Cancel
                        </Button>
                        <Button
                          variant='primary'
                          onClick={saveDocumentTag}
                          className='flex-1'
                          disabled={!canSaveTag}
                        >
                          Save Changes
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {!isTagEditing && (
                <Button
                  variant='default'
                  onClick={openTagCreator}
                  disabled={!canAddNewTag}
                  className='w-full'
                >
                  Add Tag
                </Button>
              )}

              {isCreatingTag && (
                <div className='space-y-[8px] rounded-[6px] border p-[12px]'>
                  <div className='flex flex-col gap-[8px]'>
                    <Label htmlFor='newTagName'>Tag Name</Label>
                    {tagNameOptions.length > 0 ? (
                      <Combobox
                        id='newTagName'
                        options={tagNameOptions}
                        value={editTagForm.displayName}
                        selectedValue={editTagForm.displayName}
                        onChange={(value) => {
                          const def = kbTagDefinitions.find(
                            (d) => d.displayName.toLowerCase() === value.toLowerCase()
                          )
                          setEditTagForm({
                            ...editTagForm,
                            displayName: value,
                            fieldType: def?.fieldType || 'text',
                          })
                        }}
                        placeholder='Enter or select tag name'
                        editable={true}
                        className={cn(tagNameConflict && 'border-[var(--text-error)]')}
                      />
                    ) : (
                      <Input
                        id='newTagName'
                        value={editTagForm.displayName}
                        onChange={(e) =>
                          setEditTagForm({ ...editTagForm, displayName: e.target.value })
                        }
                        placeholder='Enter tag name'
                        className={cn(tagNameConflict && 'border-[var(--text-error)]')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && canSaveTag) {
                            e.preventDefault()
                            saveDocumentTag()
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            cancelEditingTag()
                          }
                        }}
                      />
                    )}
                    {tagNameConflict && (
                      <span className='text-[11px] text-[var(--text-error)]'>
                        A tag with this name already exists
                      </span>
                    )}
                  </div>

                  <div className='flex flex-col gap-[8px]'>
                    <Label htmlFor='newTagValue'>Value</Label>
                    {editTagForm.fieldType === 'boolean' ? (
                      <div className='flex items-center gap-2'>
                        <Switch
                          id='newTagValue'
                          checked={editTagForm.value === 'true'}
                          onCheckedChange={(checked) =>
                            setEditTagForm({ ...editTagForm, value: String(checked) })
                          }
                        />
                        <span className='text-[12px] text-[var(--text-muted)]'>
                          {editTagForm.value === 'true' ? 'Yes' : 'No'}
                        </span>
                      </div>
                    ) : editTagForm.fieldType === 'number' ? (
                      <Input
                        id='newTagValue'
                        type='number'
                        value={editTagForm.value}
                        onChange={(e) =>
                          setEditTagForm({ ...editTagForm, value: e.target.value })
                        }
                        placeholder='Enter number'
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && canSaveTag) {
                            e.preventDefault()
                            saveDocumentTag()
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            cancelEditingTag()
                          }
                        }}
                      />
                    ) : editTagForm.fieldType === 'date' ? (
                      <Input
                        id='newTagValue'
                        type='datetime-local'
                        value={editTagForm.value ? editTagForm.value.slice(0, 16) : ''}
                        onChange={(e) =>
                          setEditTagForm({ ...editTagForm, value: new Date(e.target.value).toISOString() })
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            cancelEditingTag()
                          }
                        }}
                      />
                    ) : (
                      <Input
                        id='newTagValue'
                        value={editTagForm.value}
                        onChange={(e) => setEditTagForm({ ...editTagForm, value: e.target.value })}
                        placeholder='Enter tag value'
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && canSaveTag) {
                            e.preventDefault()
                            saveDocumentTag()
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            cancelEditingTag()
                          }
                        }}
                      />
                    )}
                  </div>

                  {kbTagDefinitions.length >= MAX_TAG_SLOTS &&
                    !kbTagDefinitions.find(
                      (def) =>
                        def.displayName.toLowerCase() === editTagForm.displayName.toLowerCase()
                    ) && (
                      <div className='rounded-[4px] border border-amber-500/50 bg-amber-500/10 p-[8px]'>
                        <p className='text-[11px] text-amber-600 dark:text-amber-400'>
                          Maximum tag definitions reached. You can still use existing tag
                          definitions, but cannot create new ones.
                        </p>
                      </div>
                    )}

                  <div className='flex gap-[8px]'>
                    <Button variant='default' onClick={cancelEditingTag} className='flex-1'>
                      Cancel
                    </Button>
                    <Button
                      variant='primary'
                      onClick={saveDocumentTag}
                      className='flex-1'
                      disabled={
                        !canSaveTag ||
                        isSavingTag ||
                        (kbTagDefinitions.length >= MAX_TAG_SLOTS &&
                          !kbTagDefinitions.find(
                            (def) =>
                              def.displayName.toLowerCase() ===
                              editTagForm.displayName.toLowerCase()
                          ))
                      }
                    >
                      {isSavingTag ? (
                        <>
                          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                          Creating...
                        </>
                      ) : (
                        'Create Tag'
                      )}
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
  )
}
