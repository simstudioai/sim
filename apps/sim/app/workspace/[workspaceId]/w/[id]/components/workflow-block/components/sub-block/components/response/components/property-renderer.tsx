import { ChevronDown, ChevronRight, Plus, Trash } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { JSONProperty } from '../response-format'
import { ValueInput } from './value-input'

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

interface PropertyRendererProps {
  property: JSONProperty
  blockId: string
  isPreview: boolean
  onUpdateProperty: (id: string, updates: Partial<JSONProperty>) => void
  onAddProperty: (parentId?: string) => void
  onRemoveProperty: (id: string) => void
  onAddArrayItem: (arrayPropId: string) => void
  onRemoveArrayItem: (arrayPropId: string, index: number) => void
  onUpdateArrayItem: (arrayPropId: string, index: number, newValue: any) => void
  depth?: number
}

export function PropertyRenderer({
  property,
  blockId,
  isPreview,
  onUpdateProperty,
  onAddProperty,
  onRemoveProperty,
  onAddArrayItem,
  onRemoveArrayItem,
  onUpdateArrayItem,
  depth = 0,
}: PropertyRendererProps) {
  const isContainer = property.type === 'object'
  const indent = depth * 12

  // Check if this object is using a variable reference
  const isObjectVariable =
    property.type === 'object' &&
    typeof property.value === 'string' &&
    property.value.trim().startsWith('<') &&
    property.value.trim().includes('>')

  return (
    <div className='space-y-1' style={{ marginLeft: `${indent}px` }}>
      <div className='rounded border bg-card/50 p-2'>
        <div className='flex items-center gap-2'>
          {isContainer && !isObjectVariable && (
            <Button
              variant='ghost'
              size='icon'
              onClick={() => onUpdateProperty(property.id, { collapsed: !property.collapsed })}
              className='h-4 w-4 shrink-0'
              disabled={isPreview}
            >
              {property.collapsed ? (
                <ChevronRight className='h-3 w-3' />
              ) : (
                <ChevronDown className='h-3 w-3' />
              )}
            </Button>
          )}

          <Badge
            variant='outline'
            className={cn('shrink-0 px-1 py-0 font-mono text-xs', TYPE_COLORS[property.type])}
          >
            {TYPE_ICONS[property.type]}
          </Badge>

          <Input
            value={property.key}
            onChange={(e) => onUpdateProperty(property.id, { key: e.target.value })}
            placeholder='key'
            disabled={isPreview}
            className='h-6 min-w-0 flex-1 text-xs'
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='outline'
                size='sm'
                className='h-6 shrink-0 px-2 text-xs'
                disabled={isPreview}
              >
                {property.type}
                <ChevronDown className='ml-1 h-3 w-3' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {Object.entries(TYPE_ICONS).map(([type, icon]) => (
                <DropdownMenuItem
                  key={type}
                  onClick={() => onUpdateProperty(property.id, { type: type as any })}
                  className='text-xs'
                >
                  <span className='mr-2 font-mono text-xs'>{icon}</span>
                  {type}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className='flex shrink-0 items-center gap-1'>
            {isContainer && !isObjectVariable && (
              <Button
                variant='ghost'
                size='icon'
                onClick={() => onAddProperty(property.id)}
                disabled={isPreview}
                className='h-6 w-6'
                title='Add property'
              >
                <Plus className='h-3 w-3' />
              </Button>
            )}

            <Button
              variant='ghost'
              size='icon'
              onClick={() => onRemoveProperty(property.id)}
              disabled={isPreview}
              className='h-6 w-6 text-muted-foreground hover:text-destructive'
            >
              <Trash className='h-3 w-3' />
            </Button>
          </div>
        </div>

        {/* Show value input for non-container types OR container types using variables */}
        {(!isContainer || isObjectVariable) && (
          <div className='mt-2'>
            <ValueInput
              property={property}
              blockId={blockId}
              isPreview={isPreview}
              onUpdateProperty={onUpdateProperty}
              onAddArrayItem={onAddArrayItem}
              onRemoveArrayItem={onRemoveArrayItem}
              onUpdateArrayItem={onUpdateArrayItem}
            />
          </div>
        )}

        {/* Show object variable input for object types */}
        {isContainer && !isObjectVariable && (
          <div className='mt-2'>
            <ValueInput
              property={{
                ...property,
                id: `${property.id}-object-variable`,
                type: 'string',
                value: typeof property.value === 'string' ? property.value : '',
              }}
              blockId={blockId}
              isPreview={isPreview}
              onUpdateProperty={(id: string, updates: Partial<JSONProperty>) =>
                onUpdateProperty(property.id, updates)
              }
              onAddArrayItem={onAddArrayItem}
              onRemoveArrayItem={onRemoveArrayItem}
              onUpdateArrayItem={onUpdateArrayItem}
              placeholder='Use <variable.object> or define properties below'
              onObjectVariableChange={(newValue: string) => {
                if (newValue.startsWith('<')) {
                  onUpdateProperty(property.id, { value: newValue })
                } else if (newValue === '') {
                  onUpdateProperty(property.id, { value: [] })
                }
              }}
            />
          </div>
        )}
      </div>

      {isContainer && !property.collapsed && !isObjectVariable && (
        <div className='ml-1 space-y-1 border-muted/30 border-l-2 pl-2'>
          {Array.isArray(property.value) && property.value.length > 0 ? (
            property.value.map((childProp: JSONProperty) => (
              <PropertyRenderer
                key={childProp.id}
                property={childProp}
                blockId={blockId}
                isPreview={isPreview}
                onUpdateProperty={onUpdateProperty}
                onAddProperty={onAddProperty}
                onRemoveProperty={onRemoveProperty}
                onAddArrayItem={onAddArrayItem}
                onRemoveArrayItem={onRemoveArrayItem}
                onUpdateArrayItem={onUpdateArrayItem}
                depth={depth + 1}
              />
            ))
          ) : (
            <div className='rounded border-2 border-muted/50 border-dashed p-2 text-center'>
              <p className='text-muted-foreground text-xs'>No properties</p>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => onAddProperty(property.id)}
                disabled={isPreview}
                className='mt-1 h-6 text-xs'
              >
                <Plus className='mr-1 h-3 w-3' />
                Add Property
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
