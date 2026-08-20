import { useRef, useState } from 'react'
import { Plus, Trash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { checkEnvVarTrigger, EnvVarDropdown } from '@/components/ui/env-var-dropdown'
import { Input } from '@/components/ui/input'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { createLogger } from '@/lib/logs/console-logger'
import type { JSONProperty } from '../response-format'

const logger = createLogger('ValueInput')

interface ValueInputProps {
  property: JSONProperty
  blockId: string
  isPreview: boolean
  onUpdateProperty: (id: string, updates: Partial<JSONProperty>) => void
  onAddArrayItem: (arrayPropId: string) => void
  onRemoveArrayItem: (arrayPropId: string, index: number) => void
  onUpdateArrayItem: (arrayPropId: string, index: number, newValue: any) => void
  placeholder?: string
  onObjectVariableChange?: (newValue: string) => void
}

export function ValueInput({
  property,
  blockId,
  isPreview,
  onUpdateProperty,
  onAddArrayItem,
  onRemoveArrayItem,
  onUpdateArrayItem,
  placeholder,
  onObjectVariableChange,
}: ValueInputProps) {
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [showTags, setShowTags] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)

  const inputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({})

  const findPropertyById = (props: JSONProperty[], id: string): JSONProperty | null => {
    for (const prop of props) {
      if (prop.id === id) return prop
      if (prop.type === 'object' && Array.isArray(prop.value)) {
        const found = findPropertyById(prop.value, id)
        if (found) return found
      }
    }
    return null
  }

  const handleDragOver = (e: React.DragEvent<HTMLInputElement>) => {
    e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent<HTMLInputElement>, propId: string) => {
    if (isPreview) return
    e.preventDefault()

    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data.type !== 'connectionBlock') return

      const input = inputRefs.current[propId]
      const dropPosition = input?.selectionStart ?? 0

      const currentValue = property.value?.toString() ?? ''
      const newValue = `${currentValue.slice(0, dropPosition)}<${currentValue.slice(dropPosition)}`

      input?.focus()

      Promise.resolve().then(() => {
        onUpdateProperty(property.id, { value: newValue })
        setCursorPosition(dropPosition + 1)
        setShowTags(true)

        if (data.connectionData?.sourceBlockId) {
          setActiveSourceBlockId(data.connectionData.sourceBlockId)
        }

        setTimeout(() => {
          if (input) {
            input.selectionStart = dropPosition + 1
            input.selectionEnd = dropPosition + 1
          }
        }, 0)
      })
    } catch (error) {
      logger.error('Failed to parse drop data:', { error })
    }
  }

  const getPlaceholder = () => {
    if (placeholder) return placeholder

    switch (property.type) {
      case 'number':
        return '42 or <variable.count>'
      case 'boolean':
        return 'true/false or <variable.isEnabled>'
      case 'array':
        return '["item1", "item2"] or <variable.items>'
      case 'object':
        return '{...} or <variable.object>'
      default:
        return 'Enter text or <variable.name>'
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    const cursorPos = e.target.selectionStart || 0

    if (onObjectVariableChange) {
      onObjectVariableChange(newValue.trim())
    } else {
      onUpdateProperty(property.id, { value: newValue })
    }

    if (!isPreview) {
      const tagTrigger = checkTagTrigger(newValue, cursorPos)
      const envVarTrigger = checkEnvVarTrigger(newValue, cursorPos)

      setShowTags(tagTrigger.show)
      setShowEnvVars(envVarTrigger.show)
      setSearchTerm(envVarTrigger.searchTerm || '')
      setCursorPosition(cursorPos)
    }
  }

  const handleTagSelect = (newValue: string) => {
    if (onObjectVariableChange) {
      onObjectVariableChange(newValue)
    } else {
      onUpdateProperty(property.id, { value: newValue })
    }
    setShowTags(false)
  }

  const handleEnvVarSelect = (newValue: string) => {
    if (onObjectVariableChange) {
      onObjectVariableChange(newValue)
    } else {
      onUpdateProperty(property.id, { value: newValue })
    }
    setShowEnvVars(false)
  }

  const isArrayVariable =
    property.type === 'array' &&
    typeof property.value === 'string' &&
    property.value.trim().startsWith('<') &&
    property.value.trim().includes('>')

  // Handle array type with individual items
  if (property.type === 'array' && !isArrayVariable && Array.isArray(property.value)) {
    return (
      <div className='space-y-1'>
        <div className='relative'>
          <Input
            ref={(el) => {
              inputRefs.current[`${property.id}-array-variable`] = el
            }}
            value={typeof property.value === 'string' ? property.value : ''}
            onChange={(e) => {
              const newValue = e.target.value.trim()
              if (newValue.startsWith('<') || newValue.startsWith('[')) {
                onUpdateProperty(property.id, { value: newValue })
              } else if (newValue === '') {
                onUpdateProperty(property.id, { value: [] })
              }

              const cursorPos = e.target.selectionStart || 0
              if (!isPreview) {
                const tagTrigger = checkTagTrigger(newValue, cursorPos)
                const envVarTrigger = checkEnvVarTrigger(newValue, cursorPos)

                setShowTags(tagTrigger.show)
                setShowEnvVars(envVarTrigger.show)
                setSearchTerm(envVarTrigger.searchTerm || '')
                setCursorPosition(cursorPos)
              }
            }}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, `${property.id}-array-variable`)}
            placeholder='Use <variable.items> or define items below'
            disabled={isPreview}
            className='h-7 text-xs'
          />
          {!isPreview && showTags && (
            <TagDropdown
              visible={showTags}
              onSelect={handleTagSelect}
              blockId={blockId}
              activeSourceBlockId={activeSourceBlockId}
              inputValue={typeof property.value === 'string' ? property.value : ''}
              cursorPosition={cursorPosition}
              onClose={() => setShowTags(false)}
            />
          )}
          {!isPreview && showEnvVars && (
            <EnvVarDropdown
              visible={showEnvVars}
              onSelect={handleEnvVarSelect}
              searchTerm={searchTerm}
              inputValue={typeof property.value === 'string' ? property.value : ''}
              cursorPosition={cursorPosition}
              onClose={() => setShowEnvVars(false)}
            />
          )}
        </div>

        {property.value.length > 0 && (
          <>
            <div className='mt-2 mb-1 font-medium text-muted-foreground text-xs'>Array Items:</div>
            {property.value.map((item: any, index: number) => (
              <div key={index} className='flex items-center gap-1'>
                <div className='relative flex-1'>
                  <Input
                    ref={(el) => {
                      inputRefs.current[`${property.id}-array-${index}`] = el
                    }}
                    value={item || ''}
                    onChange={(e) => onUpdateArrayItem(property.id, index, e.target.value)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, `${property.id}-array-${index}`)}
                    placeholder={`Item ${index + 1}`}
                    disabled={isPreview}
                    className='h-7 text-xs'
                  />
                </div>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => onRemoveArrayItem(property.id, index)}
                  disabled={isPreview}
                  className='h-7 w-7'
                >
                  <Trash className='h-3 w-3' />
                </Button>
              </div>
            ))}
          </>
        )}

        <Button
          variant='outline'
          size='sm'
          onClick={() => onAddArrayItem(property.id)}
          disabled={isPreview}
          className='h-7 w-full text-xs'
        >
          <Plus className='mr-1 h-3 w-3' />
          Add Item
        </Button>
      </div>
    )
  }

  // Handle regular input for all other types
  return (
    <div className='relative'>
      <Input
        ref={(el) => {
          inputRefs.current[property.id] = el
        }}
        value={property.value || ''}
        onChange={handleInputChange}
        onDragOver={handleDragOver}
        onDrop={(e) => handleDrop(e, property.id)}
        placeholder={getPlaceholder()}
        disabled={isPreview}
        className='h-7 text-xs'
      />
      {!isPreview && showTags && (
        <TagDropdown
          visible={showTags}
          onSelect={handleTagSelect}
          blockId={blockId}
          activeSourceBlockId={activeSourceBlockId}
          inputValue={property.value || ''}
          cursorPosition={cursorPosition}
          onClose={() => setShowTags(false)}
        />
      )}
      {!isPreview && showEnvVars && (
        <EnvVarDropdown
          visible={showEnvVars}
          onSelect={handleEnvVarSelect}
          searchTerm={searchTerm}
          inputValue={property.value || ''}
          cursorPosition={cursorPosition}
          onClose={() => setShowEnvVars(false)}
        />
      )}
    </div>
  )
}
