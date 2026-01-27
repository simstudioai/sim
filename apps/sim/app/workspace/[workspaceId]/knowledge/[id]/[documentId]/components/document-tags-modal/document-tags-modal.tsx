'use client'

import { useCallback, useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  Button,
  Combobox,
  DatePicker,
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
import { ALL_TAG_SLOTS, type AllTagSlot, MAX_TAG_SLOTS } from '@/lib/knowledge/constants'
import type { DocumentTag } from '@/lib/knowledge/tags/types'
import type { DocumentData } from '@/lib/knowledge/types'
import {
  type TagDefinition,
  useKnowledgeBaseTagDefinitions,
} from '@/hooks/kb/use-knowledge-base-tag-definitions'
import { useNextAvailableSlot } from '@/hooks/kb/use-next-available-slot'
import { type TagDefinitionInput, useTagDefinitions } from '@/hooks/kb/use-tag-definitions'
import { useUpdateDocumentTags } from '@/hooks/queries/knowledge'

const logger = createLogger('DocumentTagsModal')

/** Field type display labels */
const FIELD_TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  boolean: 'Boolean',
}

/**
 * Gets the appropriate value when changing field types.
 * Clears value when type changes to allow placeholder to show.
 */
function getValueForFieldType(
  newFieldType: string,
  currentFieldType: string,
  currentValue: string
): string {
  return newFieldType === currentFieldType ? currentValue : ''
}

/** Format value for display based on field type */
function formatValueForDisplay(value: string, fieldType: string): string {
  if (!value) return ''
  switch (fieldType) {
    case 'boolean':
      return value === 'true' ? 'True' : 'False'
    case 'date':
      try {
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) return value
        if (typeof value === 'string' && (value.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(value))) {
          return new Date(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate()
          ).toLocaleDateString()
        }
        return date.toLocaleDateString()
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
  const documentTagHook = useTagDefinitions(knowledgeBaseId, documentId)
  const kbTagHook = useKnowledgeBaseTagDefinitions(knowledgeBaseId)
  const { getNextAvailableSlot: getServerNextSlot } = useNextAvailableSlot(knowledgeBaseId)
  const { mutateAsync: updateDocumentTags } = useUpdateDocumentTags()

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

      const tagData: Record<string, string> = {}

      ALL_TAG_SLOTS.forEach((slot) => {
        const tag = tagsToSave.find((t) => t.slot === slot)
        if (tag?.value.trim()) {
          tagData[slot] = tag.value.trim()
        } else {
          tagData[slot] = ''
        }
      })

      await updateDocumentTags({
        knowledgeBaseId,
        documentId,
        tags: tagData,
      })

      onDocumentUpdate?.(tagData)
      await fetchTagDefinitions()
    },
    [
      documentData,
      knowledgeBaseId,
      documentId,
      updateDocumentTags,
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
      <ModalContent size='sm'>
        <ModalHeader>
          <div className='flex items-center justify-between'>
            <span>Document Tags</span>
          </div>
        </ModalHeader>

        <ModalBody>
          <div className='min-h-0 flex-1 overflow-y-auto'>
            <div className='space-y-[8px]'>
              <Label>Tags</Label>

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
                              const newFieldType = def?.fieldType || 'text'
                              setEditTagForm({
                                ...editTagForm,
                                displayName: value,
                                fieldType: newFieldType,
                                value: getValueForFieldType(
                                  newFieldType,
                                  editTagForm.fieldType,
                                  editTagForm.value
                                ),
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
                          <span className='text-[12px] text-[var(--text-error)]'>
                            A tag with this name already exists
                          </span>
                        )}
                      </div>

                      <div className='flex flex-col gap-[8px]'>
                        <Label htmlFor={`tagValue-${index}`}>Value</Label>
                        {editTagForm.fieldType === 'boolean' ? (
                          <Combobox
                            id={`tagValue-${index}`}
                            options={[
                              { label: 'True', value: 'true' },
                              { label: 'False', value: 'false' },
                            ]}
                            value={editTagForm.value}
                            selectedValue={editTagForm.value}
                            onChange={(value) => setEditTagForm({ ...editTagForm, value })}
                            placeholder='Select value'
                          />
                        ) : editTagForm.fieldType === 'number' ? (
                          <Input
                            id={`tagValue-${index}`}
                            value={editTagForm.value}
                            onChange={(e) => {
                              const val = e.target.value
                              // Allow empty, digits, decimal point, and negative sign
                              if (val === '' || /^-?\d*\.?\d*$/.test(val)) {
                                setEditTagForm({ ...editTagForm, value: val })
                              }
                            }}
                            placeholder='Enter number'
                            inputMode='decimal'
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
                          <DatePicker
                            value={editTagForm.value || undefined}
                            onChange={(value) => setEditTagForm({ ...editTagForm, value })}
                            placeholder='Select date'
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
                          variant='tertiary'
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

              {documentTags.length > 0 && !isTagEditing && (
                <Button
                  variant='default'
                  onClick={openTagCreator}
                  disabled={!canAddNewTag}
                  className='w-full'
                >
                  Add Tag
                </Button>
              )}

              {(isCreatingTag || documentTags.length === 0) && editingTagIndex === null && (
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
                          const newFieldType = def?.fieldType || 'text'
                          setEditTagForm({
                            ...editTagForm,
                            displayName: value,
                            fieldType: newFieldType,
                            value: getValueForFieldType(
                              newFieldType,
                              editTagForm.fieldType,
                              editTagForm.value
                            ),
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
                      <span className='text-[12px] text-[var(--text-error)]'>
                        A tag with this name already exists
                      </span>
                    )}
                  </div>

                  <div className='flex flex-col gap-[8px]'>
                    <Label htmlFor='newTagValue'>Value</Label>
                    {editTagForm.fieldType === 'boolean' ? (
                      <Combobox
                        id='newTagValue'
                        options={[
                          { label: 'True', value: 'true' },
                          { label: 'False', value: 'false' },
                        ]}
                        value={editTagForm.value}
                        selectedValue={editTagForm.value}
                        onChange={(value) => setEditTagForm({ ...editTagForm, value })}
                        placeholder='Select value'
                      />
                    ) : editTagForm.fieldType === 'number' ? (
                      <Input
                        id='newTagValue'
                        value={editTagForm.value}
                        onChange={(e) => {
                          const val = e.target.value
                          // Allow empty, digits, decimal point, and negative sign
                          if (val === '' || /^-?\d*\.?\d*$/.test(val)) {
                            setEditTagForm({ ...editTagForm, value: val })
                          }
                        }}
                        placeholder='Enter number'
                        inputMode='decimal'
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
                      <DatePicker
                        value={editTagForm.value || undefined}
                        onChange={(value) => setEditTagForm({ ...editTagForm, value })}
                        placeholder='Select date'
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
                    {documentTags.length > 0 && (
                      <Button variant='default' onClick={cancelEditingTag} className='flex-1'>
                        Cancel
                      </Button>
                    )}
                    <Button
                      variant='tertiary'
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
                      {isSavingTag ? 'Creating...' : 'Create Tag'}
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
