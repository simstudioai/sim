'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MAX_TAG_SLOTS, TAG_SLOTS, type TagSlot } from '@/lib/constants/knowledge'
import { createLogger } from '@/lib/logs/console/logger'
import type { DocumentTag } from '@/app/workspace/[workspaceId]/knowledge/components/document-tag-entry/document-tag-entry'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  type TagDefinition,
  useKnowledgeBaseTagDefinitions,
} from '@/hooks/use-knowledge-base-tag-definitions'
import { useNextAvailableSlot } from '@/hooks/use-next-available-slot'
import { type TagDefinitionInput, useTagDefinitions } from '@/hooks/use-tag-definitions'
import { type DocumentData, useKnowledgeStore } from '@/stores/knowledge/store'

const logger = createLogger('KnowledgeTags')

interface KnowledgeTagsProps {
  knowledgeBaseId: string
  documentId: string
}

// Predetermined colors for each tag slot
const TAG_SLOT_COLORS = [
  'var(--brand-primary-hex)', // Purple
  '#FF6B35', // Orange
  '#4ECDC4', // Teal
  '#45B7D1', // Blue
  '#96CEB4', // Green
  '#FFEAA7', // Yellow
  '#DDA0DD', // Plum
  '#FF7675', // Red
  '#74B9FF', // Light Blue
  '#A29BFE', // Lavender
] as const

export function KnowledgeTags({ knowledgeBaseId, documentId }: KnowledgeTagsProps) {
  const { getCachedDocuments, updateDocument: updateDocumentInStore } = useKnowledgeStore()
  const userPermissions = useUserPermissionsContext()

  // Use different hooks based on whether we have a documentId
  const documentTagHook = useTagDefinitions(knowledgeBaseId, documentId)
  const kbTagHook = useKnowledgeBaseTagDefinitions(knowledgeBaseId)
  const { getNextAvailableSlot: getServerNextSlot } = useNextAvailableSlot(knowledgeBaseId)

  // Use the document-level hook since we have documentId
  const { saveTagDefinitions, tagDefinitions, fetchTagDefinitions } = documentTagHook
  const { tagDefinitions: kbTagDefinitions, fetchTagDefinitions: refreshTagDefinitions } = kbTagHook

  const [documentTags, setDocumentTags] = useState<DocumentTag[]>([])
  const [documentData, setDocumentData] = useState<DocumentData | null>(null)
  const [isLoadingDocument, setIsLoadingDocument] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Inline editing state
  const [editingTagIndex, setEditingTagIndex] = useState<number | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [editForm, setEditForm] = useState({
    displayName: '',
    fieldType: 'text',
    value: '',
  })

  // Function to build document tags from data and definitions
  const buildDocumentTags = useCallback(
    (docData: DocumentData, definitions: TagDefinition[], currentTags?: DocumentTag[]) => {
      const tags: DocumentTag[] = []
      const tagSlots = TAG_SLOTS

      tagSlots.forEach((slot) => {
        const value = docData[slot] as string | null | undefined
        const definition = definitions.find((def) => def.tagSlot === slot)
        const currentTag = currentTags?.find((tag) => tag.slot === slot)

        // Only include tag if the document has a value AND a corresponding KB tag definition exists
        if (value?.trim() && definition) {
          tags.push({
            slot,
            displayName: definition.displayName,
            fieldType: definition.fieldType,
            value: value.trim(),
          })
        }
      })

      return tags
    },
    []
  )

  // Handle tag updates (local state only, no API calls)
  const handleTagsChange = useCallback((newTags: DocumentTag[]) => {
    // Only update local state, don't save to API
    setDocumentTags(newTags)
  }, [])

  // Handle saving document tag values to the API
  const handleSaveDocumentTags = useCallback(
    async (tagsToSave: DocumentTag[]) => {
      if (!documentData) return

      try {
        // Convert DocumentTag array to tag data for API
        const tagData: Record<string, string> = {}
        const tagSlots = TAG_SLOTS

        // Clear all tags first
        tagSlots.forEach((slot) => {
          tagData[slot] = ''
        })

        // Set values from tagsToSave
        tagsToSave.forEach((tag) => {
          if (tag.value.trim()) {
            tagData[tag.slot] = tag.value.trim()
          }
        })

        // Update document via API
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

        // Update the document in the store and local state
        updateDocumentInStore(knowledgeBaseId, documentId, tagData)
        setDocumentData((prev) => (prev ? { ...prev, ...tagData } : null))

        // Refresh tag definitions to update the display
        await fetchTagDefinitions()
      } catch (error) {
        logger.error('Error updating document tags:', error)
        throw error // Re-throw so the component can handle it
      }
    },
    [documentData, knowledgeBaseId, documentId, updateDocumentInStore, fetchTagDefinitions]
  )

  // Handle removing a tag
  const handleRemoveTag = async (index: number) => {
    const updatedTags = documentTags.filter((_, i) => i !== index)
    handleTagsChange(updatedTags)

    // Persist the changes
    try {
      await handleSaveDocumentTags(updatedTags)
    } catch (error) {
      // Handle error silently - the UI will show the optimistic update
      // but the user can retry if needed
    }
  }

  // Toggle inline editor for existing tag
  const toggleTagEditor = (index: number) => {
    if (editingTagIndex === index) {
      // Already editing this tag - collapse it
      cancelEditing()
    } else {
      // Start editing this tag
      const tag = documentTags[index]
      setEditingTagIndex(index)
      setEditForm({
        displayName: tag.displayName,
        fieldType: tag.fieldType,
        value: tag.value,
      })
      setIsCreating(false)
    }
  }

  // Open inline creator for new tag
  const openTagCreator = () => {
    setEditingTagIndex(null)
    setEditForm({
      displayName: '',
      fieldType: 'text',
      value: '',
    })
    setIsCreating(true)
  }

  // Save tag (create or edit)
  const saveTag = async () => {
    if (!editForm.displayName.trim() || !editForm.value.trim()) return

    // Close the edit form immediately and set saving flag
    const formData = { ...editForm }
    const currentEditingIndex = editingTagIndex
    // Capture original tag data before updating
    const originalTag = currentEditingIndex !== null ? documentTags[currentEditingIndex] : null
    setEditingTagIndex(null)
    setIsCreating(false)
    setIsSaving(true)

    try {
      let targetSlot: string

      if (currentEditingIndex !== null && originalTag) {
        // EDIT MODE: Editing existing tag - use existing slot
        targetSlot = originalTag.slot
      } else {
        // CREATE MODE: Check if using existing definition or creating new one
        const existingDefinition = kbTagDefinitions.find(
          (def) => def.displayName.toLowerCase() === formData.displayName.toLowerCase()
        )

        if (existingDefinition) {
          // Using existing definition - use its slot
          targetSlot = existingDefinition.tagSlot
        } else {
          // Creating new definition - get next available slot from server
          const serverSlot = await getServerNextSlot(formData.fieldType)
          if (!serverSlot) {
            throw new Error(`No available slots for new tag of type '${formData.fieldType}'`)
          }
          targetSlot = serverSlot
        }
      }

      // Update the tags array
      let updatedTags: DocumentTag[]
      if (currentEditingIndex !== null) {
        // Editing existing tag
        updatedTags = [...documentTags]
        updatedTags[currentEditingIndex] = {
          ...updatedTags[currentEditingIndex],
          displayName: formData.displayName,
          fieldType: formData.fieldType,
          value: formData.value,
        }
      } else {
        // Creating new tag
        const newTag: DocumentTag = {
          slot: targetSlot,
          displayName: formData.displayName,
          fieldType: formData.fieldType,
          value: formData.value,
        }
        updatedTags = [...documentTags, newTag]
      }

      handleTagsChange(updatedTags)

      // Handle tag definition creation/update based on edit mode
      if (currentEditingIndex !== null && originalTag) {
        // EDIT MODE: Always update existing definition, never create new slots
        const currentDefinition = kbTagDefinitions.find(
          (def) => def.displayName.toLowerCase() === originalTag.displayName.toLowerCase()
        )

        if (currentDefinition) {
          const updatedDefinition: TagDefinitionInput = {
            displayName: formData.displayName,
            fieldType: currentDefinition.fieldType, // Keep existing field type (can't change in edit mode)
            tagSlot: currentDefinition.tagSlot, // Keep existing slot
            _originalDisplayName: originalTag.displayName, // Tell server which definition to update
          }

          if (saveTagDefinitions) {
            await saveTagDefinitions([updatedDefinition])
          }
          await refreshTagDefinitions()
        }
      } else {
        // CREATE MODE: Adding new tag
        const existingDefinition = kbTagDefinitions.find(
          (def) => def.displayName.toLowerCase() === formData.displayName.toLowerCase()
        )

        if (!existingDefinition) {
          // Create new definition
          const newDefinition: TagDefinitionInput = {
            displayName: formData.displayName,
            fieldType: formData.fieldType,
            tagSlot: targetSlot as TagSlot,
          }

          if (saveTagDefinitions) {
            await saveTagDefinitions([newDefinition])
          }
          await refreshTagDefinitions()
        }
      }

      // Save the actual document tags
      await handleSaveDocumentTags(updatedTags)

      // Reset form
      setEditForm({
        displayName: '',
        fieldType: 'text',
        value: '',
      })
    } catch (error) {
      logger.error('Error saving tag:', error)
    } finally {
      setIsSaving(false)
    }
  }

  // Check if tag name already exists on this document
  const hasNameConflict = (name: string) => {
    if (!name.trim()) return false

    return documentTags.some((tag, index) => {
      // When editing, don't consider the current tag being edited as a conflict
      if (editingTagIndex !== null && index === editingTagIndex) {
        return false
      }
      return tag.displayName.toLowerCase() === name.trim().toLowerCase()
    })
  }

  // Get color for a tag based on its slot
  const getTagColor = (slot: string) => {
    // Extract slot number from slot string (e.g., "tag1" -> 1, "tag2" -> 2, etc.)
    const slotMatch = slot.match(/tag(\d+)/)
    const slotNumber = slotMatch ? Number.parseInt(slotMatch[1]) - 1 : 0
    return TAG_SLOT_COLORS[slotNumber % TAG_SLOT_COLORS.length]
  }

  const cancelEditing = () => {
    setEditForm({
      displayName: '',
      fieldType: 'text',
      value: '',
    })
    setEditingTagIndex(null)
    setIsCreating(false)
  }

  // Filter available tag definitions - exclude all used tag names on this document
  const availableDefinitions = kbTagDefinitions.filter((def) => {
    // Always exclude all already used tag names (including current tag being edited)
    return !documentTags.some(
      (tag) => tag.displayName.toLowerCase() === def.displayName.toLowerCase()
    )
  })

  useEffect(() => {
    const fetchDocument = async () => {
      try {
        setIsLoadingDocument(true)
        setError(null)

        const cachedDocuments = getCachedDocuments(knowledgeBaseId)
        const cachedDoc = cachedDocuments?.documents?.find((d) => d.id === documentId)

        if (cachedDoc) {
          setDocumentData(cachedDoc)
          // Initialize tags from cached document
          const initialTags = buildDocumentTags(cachedDoc, tagDefinitions)
          setDocumentTags(initialTags)
          setIsLoadingDocument(false)
          return
        }

        const response = await fetch(`/api/knowledge/${knowledgeBaseId}/documents/${documentId}`)

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Document not found')
          }
          throw new Error(`Failed to fetch document: ${response.statusText}`)
        }

        const result = await response.json()

        if (result.success) {
          setDocumentData(result.data)
          // Initialize tags from fetched document
          const initialTags = buildDocumentTags(result.data, tagDefinitions, [])
          setDocumentTags(initialTags)
        } else {
          throw new Error(result.error || 'Failed to fetch document')
        }
      } catch (err) {
        logger.error('Error fetching document:', err)
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setIsLoadingDocument(false)
      }
    }

    if (knowledgeBaseId && documentId) {
      fetchDocument()
    }
  }, [knowledgeBaseId, documentId, getCachedDocuments, buildDocumentTags])

  // Separate effect to rebuild tags when tag definitions change (without re-fetching document)
  useEffect(() => {
    if (documentData && !isSaving) {
      const rebuiltTags = buildDocumentTags(documentData, tagDefinitions, documentTags)
      setDocumentTags(rebuiltTags)
    }
  }, [documentData, tagDefinitions, buildDocumentTags, isSaving])

  if (isLoadingDocument) {
    return (
      <div className='h-full'>
        <ScrollArea className='h-full' hideScrollbar={true}>
          <div className='px-2 py-2'>
            <div className='h-20 animate-pulse rounded-md bg-muted' />
          </div>
        </ScrollArea>
      </div>
    )
  }

  if (error || !documentData) {
    return null // Don't show anything if there's an error or no document
  }

  const isEditing = editingTagIndex !== null || isCreating
  const nameConflict = hasNameConflict(editForm.displayName)

  // Check if there are actual changes (for editing mode)
  const hasChanges = () => {
    if (editingTagIndex === null) return true // Creating new tag always has changes

    const originalTag = documentTags[editingTagIndex]
    if (!originalTag) return true

    return (
      originalTag.displayName !== editForm.displayName ||
      originalTag.value !== editForm.value ||
      originalTag.fieldType !== editForm.fieldType
    )
  }

  // Check if save should be enabled
  const canSave =
    editForm.displayName.trim() && editForm.value.trim() && !nameConflict && hasChanges()

  return (
    <div className='h-full w-full overflow-hidden'>
      <ScrollArea className='h-full' hideScrollbar={true}>
        <div className='px-2 py-2'>
          {/* Document Tags Section */}
          <div className='mb-1 space-y-1'>
            <div className='font-medium text-muted-foreground text-xs'>Document Tags</div>
            <div>
              {/* Existing Tags */}
              <div>
                {documentTags.map((tag, index) => {
                  return (
                    <div key={index} className='mb-1'>
                      <div
                        className={`cursor-pointer rounded-[10px] border bg-card transition-colors ${editingTagIndex === index ? 'space-y-2 p-2' : 'p-2'}`}
                        onClick={() => userPermissions.canEdit && toggleTagEditor(index)}
                      >
                        {/* Always show the tag display */}
                        <div className='flex items-center justify-between text-sm'>
                          <div className='flex min-w-0 flex-1 items-center gap-2'>
                            <div
                              className='h-2 w-2 rounded-full'
                              style={{ backgroundColor: getTagColor(tag.slot) }}
                            />
                            <div className='truncate font-medium'>{tag.displayName}</div>
                          </div>
                          {userPermissions.canEdit && (
                            <Button
                              variant='ghost'
                              size='sm'
                              onClick={(e) => {
                                e.stopPropagation()
                                handleRemoveTag(index)
                              }}
                              className='h-6 w-6 p-0 text-muted-foreground hover:text-red-600'
                            >
                              <X className='h-3 w-3' />
                            </Button>
                          )}
                        </div>

                        {/* Show edit form when this tag is being edited */}
                        {editingTagIndex === index && (
                          <div className='space-y-1.5' onClick={(e) => e.stopPropagation()}>
                            <div className='space-y-1.5'>
                              <Label className='font-medium text-xs'>Tag Name</Label>
                              <div className='flex gap-1.5'>
                                <Input
                                  value={editForm.displayName}
                                  onChange={(e) =>
                                    setEditForm({ ...editForm, displayName: e.target.value })
                                  }
                                  placeholder='Enter tag name'
                                  className='h-8 min-w-0 flex-1 rounded-md text-sm'
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && canSave) {
                                      e.preventDefault()
                                      saveTag()
                                    }
                                    if (e.key === 'Escape') {
                                      e.preventDefault()
                                      cancelEditing()
                                    }
                                  }}
                                />
                                {availableDefinitions.length > 0 && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant='outline'
                                        size='sm'
                                        className='h-8 w-7 flex-shrink-0 p-0'
                                      >
                                        <ChevronDown className='h-3 w-3' />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent
                                      align='end'
                                      className='w-[160px] rounded-lg border bg-card shadow-xs'
                                    >
                                      {availableDefinitions.map((def) => (
                                        <DropdownMenuItem
                                          key={def.id}
                                          onClick={() =>
                                            setEditForm({
                                              ...editForm,
                                              displayName: def.displayName,
                                              fieldType: def.fieldType,
                                            })
                                          }
                                          className='cursor-pointer rounded-md px-3 py-2 text-sm hover:bg-secondary/50'
                                        >
                                          {def.displayName}
                                        </DropdownMenuItem>
                                      ))}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                              </div>
                              {nameConflict && (
                                <div className='text-red-600 text-xs'>
                                  A tag with this name already exists on this document
                                </div>
                              )}
                            </div>

                            <div className='space-y-1.5'>
                              <Label className='font-medium text-xs'>Type</Label>
                              <Select
                                value={editForm.fieldType}
                                onValueChange={(value) =>
                                  setEditForm({ ...editForm, fieldType: value })
                                }
                                disabled={editingTagIndex !== null} // Disable in edit mode
                              >
                                <SelectTrigger className='h-8 w-full text-sm'>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value='text'>Text</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div className='space-y-1.5'>
                              <Label className='font-medium text-xs'>Value</Label>
                              <Input
                                value={editForm.value}
                                onChange={(e) =>
                                  setEditForm({ ...editForm, value: e.target.value })
                                }
                                placeholder='Enter tag value'
                                className='h-8 w-full rounded-md text-sm'
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && canSave) {
                                    e.preventDefault()
                                    saveTag()
                                  }
                                  if (e.key === 'Escape') {
                                    e.preventDefault()
                                    cancelEditing()
                                  }
                                }}
                              />
                            </div>

                            <div className='pt-1'>
                              <Button
                                onClick={saveTag}
                                size='sm'
                                className='h-7 w-full text-xs'
                                disabled={!canSave}
                              >
                                Save Changes
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {documentTags.length === 0 && !isCreating && (
                <div className='mb-1 rounded-[10px] border border-dashed bg-card p-3 text-center'>
                  <p className='text-muted-foreground text-xs'>No tags added yet.</p>
                </div>
              )}

              {/* Add New Tag Button or Inline Creator */}
              {!isEditing && userPermissions.canEdit && (
                <div className='mb-1'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={openTagCreator}
                    className='w-full justify-start gap-2 rounded-[10px] border border-dashed bg-card text-muted-foreground hover:text-foreground'
                    disabled={
                      kbTagDefinitions.length >= MAX_TAG_SLOTS && availableDefinitions.length === 0
                    }
                  >
                    <Plus className='h-4 w-4' />
                    Add Tag
                  </Button>
                </div>
              )}

              {/* Inline Tag Creation Form */}
              {isCreating && (
                <div className='mb-1 w-full max-w-full space-y-2 rounded-[10px] border bg-card p-2'>
                  <div className='space-y-1.5'>
                    <div className='flex items-center justify-between'>
                      <Label className='font-medium text-xs'>Tag Name</Label>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={cancelEditing}
                        className='h-6 w-6 p-0 text-muted-foreground hover:text-red-600'
                      >
                        <X className='h-3 w-3' />
                      </Button>
                    </div>
                    <div className='flex gap-1.5'>
                      <Input
                        value={editForm.displayName}
                        onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                        placeholder='Enter tag name'
                        className='h-8 min-w-0 flex-1 rounded-md text-sm'
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && canSave) {
                            e.preventDefault()
                            saveTag()
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            cancelEditing()
                          }
                        }}
                      />
                      {availableDefinitions.length > 0 && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant='outline'
                              size='sm'
                              className='h-8 w-7 flex-shrink-0 p-0'
                            >
                              <ChevronDown className='h-3 w-3' />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align='end'
                            className='w-[160px] rounded-lg border bg-card shadow-xs'
                          >
                            {availableDefinitions.map((def) => (
                              <DropdownMenuItem
                                key={def.id}
                                onClick={() =>
                                  setEditForm({
                                    ...editForm,
                                    displayName: def.displayName,
                                    fieldType: def.fieldType,
                                  })
                                }
                                className='cursor-pointer rounded-md px-3 py-2 text-sm hover:bg-secondary/50'
                              >
                                {def.displayName}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                    {nameConflict && (
                      <div className='text-red-600 text-xs'>
                        A tag with this name already exists on this document
                      </div>
                    )}
                  </div>

                  <div className='space-y-1.5'>
                    <Label className='font-medium text-xs'>Type</Label>
                    <Select
                      value={editForm.fieldType}
                      onValueChange={(value) => setEditForm({ ...editForm, fieldType: value })}
                    >
                      <SelectTrigger className='h-8 w-full text-sm'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='text'>Text</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className='space-y-1.5'>
                    <Label className='font-medium text-xs'>Value</Label>
                    <Input
                      value={editForm.value}
                      onChange={(e) => setEditForm({ ...editForm, value: e.target.value })}
                      placeholder='Enter tag value'
                      className='h-8 w-full rounded-md text-sm'
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && canSave) {
                          e.preventDefault()
                          saveTag()
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          cancelEditing()
                        }
                      }}
                    />
                  </div>

                  {/* Warning when at max slots */}
                  {kbTagDefinitions.length >= MAX_TAG_SLOTS && (
                    <div className='rounded-md border border-amber-200 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-950'>
                      <div className='text-amber-800 text-xs dark:text-amber-200'>
                        <span className='font-medium'>Maximum tag definitions reached</span>
                      </div>
                      <p className='text-amber-700 text-xs dark:text-amber-300'>
                        You can still use existing tag definitions, but cannot create new ones.
                      </p>
                    </div>
                  )}

                  <div className='pt-2'>
                    <Button
                      onClick={saveTag}
                      size='sm'
                      className='h-7 w-full text-xs'
                      disabled={
                        !canSave ||
                        (kbTagDefinitions.length >= MAX_TAG_SLOTS &&
                          !kbTagDefinitions.find(
                            (def) =>
                              def.displayName.toLowerCase() === editForm.displayName.toLowerCase()
                          ))
                      }
                    >
                      Create Tag
                    </Button>
                  </div>
                </div>
              )}

              <div className='mt-2 text-muted-foreground text-xs'>
                {kbTagDefinitions.length} of {MAX_TAG_SLOTS} tag slots used
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
