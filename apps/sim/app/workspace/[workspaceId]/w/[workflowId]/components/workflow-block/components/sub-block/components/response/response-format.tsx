import { useState } from 'react'
import { Code, Eye, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useSubBlockValue } from '../../hooks/use-sub-block-value'
import { PropertyRenderer } from './components/property-renderer'

export interface JSONProperty {
  id: string
  key: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  value: any
  collapsed?: boolean
}

interface ResponseFormatProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: JSONProperty[] | null
}

const TYPE_ICONS = {
  string: 'Aa',
  number: '123',
  boolean: 'T/F',
  object: '{}',
  array: '[]',
}

const TYPE_COLORS = {
  string: 'text-green-600 dark:text-green-400',
  number: 'text-blue-600 dark:text-blue-400',
  boolean: 'text-purple-600 dark:text-purple-400',
  object: 'text-orange-600 dark:text-orange-400',
  array: 'text-pink-600 dark:text-pink-400',
}

const DEFAULT_PROPERTY: JSONProperty = {
  id: crypto.randomUUID(),
  key: 'message',
  type: 'string',
  value: '',
  collapsed: false,
}

export function ResponseFormat({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
}: ResponseFormatProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<JSONProperty[]>(blockId, subBlockId)
  const [showPreview, setShowPreview] = useState(false)

  const value = isPreview ? previewValue : storeValue
  const properties: JSONProperty[] = value || [DEFAULT_PROPERTY]

  const isVariableReference = (value: any): boolean => {
    return typeof value === 'string' && value.trim().startsWith('<') && value.trim().includes('>')
  }

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

  const generateJSON = (props: JSONProperty[]): any => {
    const result: any = {}

    for (const prop of props) {
      if (!prop.key.trim()) return

      let value = prop.value

      if (prop.type === 'object') {
        if (Array.isArray(prop.value)) {
          value = generateJSON(prop.value)
        } else if (typeof prop.value === 'string' && isVariableReference(prop.value)) {
          value = prop.value
        } else {
          value = {} // Default empty object for non-array, non-variable values
        }
      } else if (prop.type === 'array' && Array.isArray(prop.value)) {
        value = prop.value.map((item: any) => {
          if (typeof item === 'object' && item.type) {
            if (item.type === 'object' && Array.isArray(item.value)) {
              return generateJSON(item.value)
            }
            if (item.type === 'array' && Array.isArray(item.value)) {
              return item.value.map((subItem: any) =>
                typeof subItem === 'object' && subItem.type ? subItem.value : subItem
              )
            }
            return item.value
          }
          return item
        })
      } else if (prop.type === 'number' && !isVariableReference(value)) {
        value = Number.isNaN(Number(value)) ? value : Number(value)
      } else if (prop.type === 'boolean' && !isVariableReference(value)) {
        const strValue = String(value).toLowerCase().trim()
        value = strValue === 'true' || strValue === '1' || strValue === 'yes' || strValue === 'on'
      }

      result[prop.key] = value
    }

    return result
  }

  const updateProperties = (newProperties: JSONProperty[]) => {
    if (isPreview) return
    setStoreValue(newProperties)
  }

  const updateProperty = (id: string, updates: Partial<JSONProperty>) => {
    const updateRecursive = (props: JSONProperty[]): JSONProperty[] => {
      return props.map((prop) => {
        if (prop.id === id) {
          const updated = { ...prop, ...updates }

          if (updates.type && updates.type !== prop.type) {
            if (updates.type === 'object') {
              updated.value = []
            } else if (updates.type === 'array') {
              updated.value = []
            } else if (updates.type === 'boolean') {
              updated.value = 'false'
            } else if (updates.type === 'number') {
              updated.value = '0'
            } else {
              updated.value = ''
            }
          }

          return updated
        }

        if (prop.type === 'object' && Array.isArray(prop.value)) {
          return { ...prop, value: updateRecursive(prop.value) }
        }

        return prop
      })
    }

    updateProperties(updateRecursive(properties))
  }

  const addProperty = (parentId?: string) => {
    const newProp: JSONProperty = {
      id: crypto.randomUUID(),
      key: '',
      type: 'string',
      value: '',
      collapsed: false,
    }

    if (parentId) {
      const addToParent = (props: JSONProperty[]): JSONProperty[] => {
        return props.map((prop) => {
          if (prop.id === parentId && prop.type === 'object') {
            return { ...prop, value: [...(prop.value || []), newProp] }
          }
          if (prop.type === 'object' && Array.isArray(prop.value)) {
            return { ...prop, value: addToParent(prop.value) }
          }
          return prop
        })
      }
      updateProperties(addToParent(properties))
    } else {
      updateProperties([...properties, newProp])
    }
  }

  const removeProperty = (id: string) => {
    const removeRecursive = (props: JSONProperty[]): JSONProperty[] => {
      return props
        .filter((prop) => prop.id !== id)
        .map((prop) => {
          if (prop.type === 'object' && Array.isArray(prop.value)) {
            return { ...prop, value: removeRecursive(prop.value) }
          }
          return prop
        })
    }

    const newProperties = removeRecursive(properties)
    updateProperties(
      newProperties.length > 0
        ? newProperties
        : [
            {
              id: crypto.randomUUID(),
              key: '',
              type: 'string',
              value: '',
              collapsed: false,
            },
          ]
    )
  }

  const addArrayItem = (arrayPropId: string) => {
    const addItem = (props: JSONProperty[]): JSONProperty[] => {
      return props.map((prop) => {
        if (prop.id === arrayPropId && prop.type === 'array') {
          return { ...prop, value: [...(prop.value || []), ''] }
        }
        if (prop.type === 'object' && Array.isArray(prop.value)) {
          return { ...prop, value: addItem(prop.value) }
        }
        return prop
      })
    }
    updateProperties(addItem(properties))
  }

  const removeArrayItem = (arrayPropId: string, index: number) => {
    const removeItem = (props: JSONProperty[]): JSONProperty[] => {
      return props.map((prop) => {
        if (prop.id === arrayPropId && prop.type === 'array') {
          const newValue = [...(prop.value || [])]
          newValue.splice(index, 1)
          return { ...prop, value: newValue }
        }
        if (prop.type === 'object' && Array.isArray(prop.value)) {
          return { ...prop, value: removeItem(prop.value) }
        }
        return prop
      })
    }
    updateProperties(removeItem(properties))
  }

  const updateArrayItem = (arrayPropId: string, index: number, newValue: any) => {
    const updateItem = (props: JSONProperty[]): JSONProperty[] => {
      return props.map((prop) => {
        if (prop.id === arrayPropId && prop.type === 'array') {
          const updatedValue = [...(prop.value || [])]
          updatedValue[index] = newValue
          return { ...prop, value: updatedValue }
        }
        if (prop.type === 'object' && Array.isArray(prop.value)) {
          return { ...prop, value: updateItem(prop.value) }
        }
        return prop
      })
    }
    updateProperties(updateItem(properties))
  }

  const hasConfiguredProperties = properties.some((prop) => prop.key.trim())

  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between'>
        <Label className='font-medium text-xs'> </Label>
        <div className='flex items-center gap-1'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setShowPreview(!showPreview)}
            disabled={isPreview}
            className='h-6 px-2 text-xs'
          >
            {showPreview ? <Code className='mr-1 h-3 w-3' /> : <Eye className='mr-1 h-3 w-3' />}
            {showPreview ? 'Hide' : 'Preview'}
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={() => addProperty()}
            disabled={isPreview}
            className='h-6 px-2 text-xs'
          >
            <Plus className='h-3 w-3' />
          </Button>
        </div>
      </div>

      {showPreview && (
        <div className='rounded border bg-muted/30 p-2'>
          <pre className='max-h-32 overflow-auto text-xs'>
            {(() => {
              try {
                return JSON.stringify(generateJSON(properties), null, 2)
              } catch (error) {
                return `Error generating preview: ${error instanceof Error ? error.message : 'Unknown error'}`
              }
            })()}
          </pre>
        </div>
      )}

      <div className='space-y-1'>
        {properties.map((prop) => (
          <PropertyRenderer
            key={prop.id}
            property={prop}
            blockId={blockId}
            isPreview={isPreview}
            onUpdateProperty={updateProperty}
            onAddProperty={addProperty}
            onRemoveProperty={removeProperty}
            onAddArrayItem={addArrayItem}
            onRemoveArrayItem={removeArrayItem}
            onUpdateArrayItem={updateArrayItem}
            depth={0}
          />
        ))}
      </div>

      {!hasConfiguredProperties && (
        <div className='py-4 text-center text-muted-foreground'>
          <p className='text-xs'>Build your JSON response format</p>
          <p className='text-xs'>
            Use &lt;variable.name&gt; in values or drag variables from above
          </p>
        </div>
      )}
    </div>
  )
}
