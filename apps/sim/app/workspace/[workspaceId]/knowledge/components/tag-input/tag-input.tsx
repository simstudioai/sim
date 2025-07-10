'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Settings, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface TagData {
  tag1?: string
  tag2?: string
  tag3?: string
  tag4?: string
  tag5?: string
  tag6?: string
  tag7?: string
}

interface TagInputProps {
  tags: TagData
  onTagsChange: (tags: TagData) => void
  disabled?: boolean
  className?: string
}

const TAG_LABELS = [
  { key: 'tag1' as keyof TagData, label: 'Tag 1', placeholder: 'Enter tag value' },
  { key: 'tag2' as keyof TagData, label: 'Tag 2', placeholder: 'Enter tag value' },
  { key: 'tag3' as keyof TagData, label: 'Tag 3', placeholder: 'Enter tag value' },
  { key: 'tag4' as keyof TagData, label: 'Tag 4', placeholder: 'Enter tag value' },
  { key: 'tag5' as keyof TagData, label: 'Tag 5', placeholder: 'Enter tag value' },
  { key: 'tag6' as keyof TagData, label: 'Tag 6', placeholder: 'Enter tag value' },
  { key: 'tag7' as keyof TagData, label: 'Tag 7', placeholder: 'Enter tag value' },
]

export function TagInput({ tags, onTagsChange, disabled = false, className = '' }: TagInputProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [showAllTags, setShowAllTags] = useState(false)

  const handleTagChange = (tagKey: keyof TagData, value: string) => {
    onTagsChange({
      ...tags,
      [tagKey]: value.trim() || undefined,
    })
  }

  const clearTag = (tagKey: keyof TagData) => {
    onTagsChange({
      ...tags,
      [tagKey]: undefined,
    })
  }

  const hasAnyTags = Object.values(tags).some((tag) => tag?.trim())
  const visibleTags = showAllTags ? TAG_LABELS : TAG_LABELS.slice(0, 2)

  return (
    <div className={className}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            type='button'
            variant='ghost'
            className='flex h-auto w-full justify-between p-0 hover:bg-transparent'
          >
            <div className='flex items-center gap-2'>
              <Settings className='h-4 w-4 text-muted-foreground' />
              <Label className='cursor-pointer font-medium text-sm'>Advanced Settings</Label>
              {hasAnyTags && (
                <span className='rounded-full bg-primary/10 px-2 py-0.5 text-primary text-xs'>
                  {Object.values(tags).filter((tag) => tag?.trim()).length} tag
                  {Object.values(tags).filter((tag) => tag?.trim()).length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            {isOpen ? (
              <ChevronDown className='h-4 w-4 text-muted-foreground' />
            ) : (
              <ChevronRight className='h-4 w-4 text-muted-foreground' />
            )}
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className='space-y-4 pt-4'>
          <div className='space-y-3'>
            <div className='flex items-center justify-between'>
              <Label className='font-medium text-sm'>Document Tags</Label>
              {!showAllTags && (
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  onClick={() => setShowAllTags(true)}
                  className='h-auto p-1 text-muted-foreground text-xs hover:text-foreground'
                >
                  <Plus className='mr-1 h-3 w-3' />
                  More tags
                </Button>
              )}
            </div>

            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              {visibleTags.map(({ key, label, placeholder }) => (
                <div key={key} className='space-y-1'>
                  <Label htmlFor={key} className='text-muted-foreground text-xs'>
                    {label}
                  </Label>
                  <div className='relative'>
                    <Input
                      id={key}
                      type='text'
                      value={tags[key] || ''}
                      onChange={(e) => handleTagChange(key, e.target.value)}
                      placeholder={placeholder}
                      disabled={disabled}
                      className='pr-8 text-sm'
                    />
                    {tags[key] && (
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        onClick={() => clearTag(key)}
                        disabled={disabled}
                        className='-translate-y-1/2 absolute top-1/2 right-1 h-6 w-6 p-0 hover:bg-muted'
                      >
                        <X className='h-3 w-3' />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {showAllTags && (
              <div className='flex justify-center'>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  onClick={() => setShowAllTags(false)}
                  className='h-auto p-1 text-muted-foreground text-xs hover:text-foreground'
                >
                  Show fewer tags
                </Button>
              </div>
            )}

            {hasAnyTags && (
              <div className='rounded-md bg-muted/50 p-3'>
                <p className='mb-2 text-muted-foreground text-xs'>Active tags:</p>
                <div className='flex flex-wrap gap-1'>
                  {Object.entries(tags).map(([key, value]) => {
                    if (!value?.trim()) return null
                    const tagLabel = TAG_LABELS.find((t) => t.key === key)?.label || key
                    return (
                      <span
                        key={key}
                        className='inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-primary text-xs'
                      >
                        <span className='font-medium'>{tagLabel}:</span>
                        <span>{value}</span>
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          onClick={() => clearTag(key as keyof TagData)}
                          disabled={disabled}
                          className='h-3 w-3 p-0 hover:bg-primary/20'
                        >
                          <X className='h-2 w-2' />
                        </Button>
                      </span>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
