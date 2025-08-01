'use client'

import { useState } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { MAX_TAG_SLOTS, TAG_SLOTS, type TagSlot } from '@/lib/constants/knowledge'
import { useKnowledgeBaseTagDefinitions } from '@/hooks/use-knowledge-base-tag-definitions'
import { type TagDefinitionInput, useTagDefinitions } from '@/hooks/use-tag-definitions'

export interface DocumentTag {
  slot: string
  displayName: string
  fieldType: string
  value: string
}

interface DocumentTagEntryProps {
  tags: DocumentTag[]
  onTagsChange: (newTags: DocumentTag[]) => void
  disabled?: boolean
  knowledgeBaseId: string
  documentId: string | null
  onSave?: (tagsToSave: DocumentTag[]) => Promise<void>
}

export function DocumentTagEntry({
  tags,
  onTagsChange,
  disabled = false,
  knowledgeBaseId,
  documentId,
  onSave,
}: DocumentTagEntryProps) {
  // Use different hooks based on whether we have a documentId
  const documentTagHook = useTagDefinitions(knowledgeBaseId, documentId)
  const kbTagHook = useKnowledgeBaseTagDefinitions(knowledgeBaseId)

  // Use the document-level hook since we have documentId
  const { saveTagDefinitions } = documentTagHook
  const { tagDefinitions: kbTagDefinitions, fetchTagDefinitions: refreshTagDefinitions } = kbTagHook

  // Modal state for tag editing
  const [editingTagIndex, setEditingTagIndex] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editForm, setEditForm] = useState({
    displayName: '',
    fieldType: 'text',
    value: '',
  })

  const getNextAvailableSlot = (): DocumentTag['slot'] => {
    // Check which slots are used at the KB level (tag definitions)
    const usedSlots = new Set(kbTagDefinitions.map((def) => def.tagSlot))
    for (const slot of TAG_SLOTS) {
      if (!usedSlots.has(slot)) {
        return slot
      }
    }
    return TAG_SLOTS[0] // Fallback to first slot if all are used
  }

  const handleRemoveTag = (index: number) => {
    const updatedTags = tags.filter((_, i) => i !== index)
    onTagsChange(updatedTags)
  }

  // Open modal to edit tag
  const openTagModal = (index: number) => {
    const tag = tags[index]
    setEditingTagIndex(index)
    setEditForm({
      displayName: tag.displayName,
      fieldType: tag.fieldType,
      value: tag.value,
    })
    setModalOpen(true)
  }

  // Open modal to create new tag
  const openNewTagModal = () => {
    setEditingTagIndex(null)
    setEditForm({
      displayName: '',
      fieldType: 'text',
      value: '',
    })
    setModalOpen(true)
  }

  // Save tag from modal
  const saveTagFromModal = async () => {
    if (!editForm.displayName.trim()) return

    try {
      if (editingTagIndex !== null) {
        // Editing existing tag
        const updatedTags = [...tags]
        updatedTags[editingTagIndex] = {
          ...updatedTags[editingTagIndex],
          displayName: editForm.displayName,
          fieldType: editForm.fieldType,
          value: editForm.value,
        }
        onTagsChange(updatedTags)
      } else {
        // Creating new tag - calculate slot once
        const newSlot = getNextAvailableSlot()
        const newTag: DocumentTag = {
          slot: newSlot,
          displayName: editForm.displayName,
          fieldType: editForm.fieldType,
          value: editForm.value,
        }
        const newTags = [...tags, newTag]
        onTagsChange(newTags)
      }

      // Auto-save tag definition if it's a new name
      const existingDefinition = kbTagDefinitions.find(
        (def) => def.displayName.toLowerCase() === editForm.displayName.toLowerCase()
      )

      if (!existingDefinition) {
        // Use the same slot for both tag and definition
        const targetSlot =
          editingTagIndex !== null ? tags[editingTagIndex].slot : getNextAvailableSlot()

        const newDefinition: TagDefinitionInput = {
          displayName: editForm.displayName,
          fieldType: editForm.fieldType,
          tagSlot: targetSlot as TagSlot,
        }

        if (saveTagDefinitions) {
          await saveTagDefinitions([newDefinition])
        } else {
          throw new Error('Cannot save tag definitions without a document ID')
        }
        await refreshTagDefinitions()
      }

      // Save the actual document tags if onSave is provided
      if (onSave) {
        const updatedTags =
          editingTagIndex !== null
            ? tags.map((tag, index) =>
                index === editingTagIndex
                  ? {
                      ...tag,
                      displayName: editForm.displayName,
                      fieldType: editForm.fieldType,
                      value: editForm.value,
                    }
                  : tag
              )
            : [
                ...tags,
                {
                  slot: getNextAvailableSlot(),
                  displayName: editForm.displayName,
                  fieldType: editForm.fieldType,
                  value: editForm.value,
                },
              ]
        await onSave(updatedTags)
      }

      setModalOpen(false)
    } catch (error) {}
  }

  // Filter available tag definitions (exclude already used ones)
  const availableDefinitions = kbTagDefinitions.filter(
    (def) => !tags.some((tag) => tag.displayName.toLowerCase() === def.displayName.toLowerCase())
  )

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <h3 className='font-medium text-sm'>Document Tags</h3>
      </div>

      {/* Tags as Badges */}
      <div className='flex flex-wrap gap-2'>
        {tags.map((tag, index) => (
          <Badge
            key={index}
            variant='outline'
            className='cursor-pointer gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-accent'
            onClick={() => openTagModal(index)}
          >
            <span className='font-medium'>{tag.displayName || 'Unnamed Tag'}</span>
            {tag.value && (
              <>
                <span className='text-muted-foreground'>:</span>
                <span className='text-muted-foreground'>{tag.value}</span>
              </>
            )}
            <Button
              variant='ghost'
              size='sm'
              onClick={(e) => {
                e.stopPropagation()
                handleRemoveTag(index)
              }}
              disabled={disabled}
              className='ml-1 h-4 w-4 p-0 text-muted-foreground hover:text-red-600'
            >
              <X className='h-3 w-3' />
            </Button>
          </Badge>
        ))}

        {/* Add Tag Button */}
        <Button
          variant='outline'
          size='sm'
          onClick={openNewTagModal}
          disabled={disabled || tags.length >= MAX_TAG_SLOTS}
          className='gap-1 border-dashed text-muted-foreground hover:text-foreground'
        >
          <Plus className='h-4 w-4' />
          Add Tag
        </Button>
      </div>

      {tags.length === 0 && (
        <div className='rounded-md border border-dashed p-4 text-center'>
          <p className='text-muted-foreground text-sm'>
            No tags added yet. Click "Add Tag" to get started.
          </p>
        </div>
      )}

      <div className='text-muted-foreground text-xs'>
        {kbTagDefinitions.length} of {MAX_TAG_SLOTS} tag slots used
      </div>

      {/* Tag Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>{editingTagIndex !== null ? 'Edit Tag' : 'Add New Tag'}</DialogTitle>
          </DialogHeader>

          <div className='space-y-4'>
            {/* Tag Name */}
            <div className='space-y-2'>
              <Label htmlFor='tag-name'>Tag Name</Label>
              <div className='flex gap-2'>
                <Input
                  id='tag-name'
                  value={editForm.displayName}
                  onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                  placeholder='Enter tag name'
                  className='flex-1'
                />
                {availableDefinitions.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant='outline' size='sm'>
                        <ChevronDown className='h-4 w-4' />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
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
                        >
                          {def.displayName}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>

            {/* Tag Type */}
            <div className='space-y-2'>
              <Label htmlFor='tag-type'>Type</Label>
              <Select
                value={editForm.fieldType}
                onValueChange={(value) => setEditForm({ ...editForm, fieldType: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='text'>Text</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Tag Value */}
            <div className='space-y-2'>
              <Label htmlFor='tag-value'>Value</Label>
              <Input
                id='tag-value'
                value={editForm.value}
                onChange={(e) => setEditForm({ ...editForm, value: e.target.value })}
                placeholder='Enter tag value'
              />
            </div>
          </div>

          <div className='flex justify-end gap-2 pt-4'>
            <Button variant='outline' onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveTagFromModal} disabled={!editForm.displayName.trim()}>
              {editingTagIndex !== null ? 'Save Changes' : 'Add Tag'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
