'use client'

import { useCallback, useState } from 'react'
import clsx from 'clsx'
import { ChevronDown, RepeatIcon, SplitIcon } from 'lucide-react'
import { Label } from '@/components/emcn'
import { extractFieldsFromSchema } from '@/lib/response-format'
import type { ConnectedBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/hooks/use-block-connections'
import { getBlock } from '@/blocks/registry'
import { getTool } from '@/tools/utils'
import { FieldItem, type SchemaField, TREE_SPACING } from './components/field-item/field-item'

interface ConnectionBlocksProps {
  connections: ConnectedBlock[]
  currentBlockId: string
}

const TREE_STYLES = {
  LINE_COLOR: 'hsl(var(--muted-foreground) / 0.2)',
} as const

const RESERVED_KEYS = new Set(['type', 'description'])

/**
 * Checks if a property is an object type
 */
const isObject = (prop: any): boolean => prop && typeof prop === 'object'

/**
 * Extracts nested fields from array or object properties
 */
const extractChildFields = (prop: any): SchemaField[] | undefined => {
  if (!isObject(prop)) return undefined

  if (prop.properties && isObject(prop.properties)) {
    return extractNestedFields(prop.properties)
  }

  if (prop.items?.properties && isObject(prop.items.properties)) {
    return extractNestedFields(prop.items.properties)
  }

  if (!('type' in prop)) {
    return extractNestedFields(prop)
  }

  if (prop.type === 'array') {
    const itemDefs = Object.fromEntries(
      Object.entries(prop).filter(([key]) => !RESERVED_KEYS.has(key))
    )
    if (Object.keys(itemDefs).length > 0) {
      return extractNestedFields(itemDefs)
    }
  }

  return undefined
}

/**
 * Recursively extracts nested fields from output properties
 */
const extractNestedFields = (properties: Record<string, any>): SchemaField[] => {
  return Object.entries(properties).map(([name, prop]) => {
    const baseType = isObject(prop) && typeof prop.type === 'string' ? prop.type : 'string'
    const type = isObject(prop) && !('type' in prop) ? 'object' : baseType

    return {
      name,
      type,
      description: isObject(prop) ? prop.description : undefined,
      children: extractChildFields(prop),
    }
  })
}

/**
 * Gets tool outputs for a block's operation
 */
const getToolOutputs = (blockConfig: any, connection: ConnectedBlock): Record<string, any> => {
  if (!blockConfig?.tools?.config?.tool || !connection.operation) return {}

  try {
    const toolId = blockConfig.tools.config.tool({ operation: connection.operation })
    if (!toolId) return {}

    const toolConfig = getTool(toolId)
    return toolConfig?.outputs || {}
  } catch {
    return {}
  }
}

/**
 * Creates a schema field from an output definition
 */
const createFieldFromOutput = (
  name: string,
  output: any,
  responseFormatFields?: SchemaField[]
): SchemaField => {
  const hasExplicitType = isObject(output) && typeof output.type === 'string'
  const type = hasExplicitType ? output.type : isObject(output) ? 'object' : 'string'

  const field: SchemaField = {
    name,
    type,
    description: isObject(output) && 'description' in output ? output.description : undefined,
  }

  if (name === 'data' && responseFormatFields && responseFormatFields.length > 0) {
    field.children = responseFormatFields
  } else {
    field.children = extractChildFields(output)
  }

  return field
}

/**
 * Builds complete field list for a connection, combining base outputs and responseFormat
 */
const buildConnectionFields = (connection: ConnectedBlock): SchemaField[] => {
  const blockConfig = getBlock(connection.type)

  if (!blockConfig && (connection.type === 'loop' || connection.type === 'parallel')) {
    return [
      {
        name: 'results',
        type: 'array',
        description: 'Array of results from the loop/parallel execution',
      },
    ]
  }

  const toolOutputs = getToolOutputs(blockConfig, connection)
  const baseOutputs =
    Object.keys(toolOutputs).length > 0
      ? toolOutputs
      : connection.outputs || blockConfig?.outputs || {}

  const responseFormatFields = extractFieldsFromSchema(connection.responseFormat)

  if (responseFormatFields.length > 0 && Object.keys(baseOutputs).length === 0) {
    return responseFormatFields
  }

  if (Object.keys(baseOutputs).length === 0) {
    return []
  }

  return Object.entries(baseOutputs).map(([name, output]) =>
    createFieldFromOutput(
      name,
      output,
      responseFormatFields.length > 0 ? responseFormatFields : undefined
    )
  )
}

/**
 * Calculates total height of visible nested fields recursively
 */
const calculateFieldsHeight = (
  fields: SchemaField[] | undefined,
  parentPath: string,
  connectionId: string,
  isExpanded: (connectionId: string, path: string) => boolean
): number => {
  if (!fields || fields.length === 0) return 0

  let totalHeight = 0

  fields.forEach((field, index) => {
    const fieldPath = parentPath ? `${parentPath}.${field.name}` : field.name
    const expanded = isExpanded(connectionId, fieldPath)

    totalHeight += TREE_SPACING.ITEM_HEIGHT

    if (index < fields.length - 1) {
      totalHeight += TREE_SPACING.ITEM_GAP
    }

    if (expanded && field.children && field.children.length > 0) {
      totalHeight += TREE_SPACING.ITEM_GAP
      totalHeight += calculateFieldsHeight(field.children, fieldPath, connectionId, isExpanded)
    }
  })

  return totalHeight
}

/**
 * Connection blocks component that displays incoming connections with their schemas
 */
export function ConnectionBlocks({ connections, currentBlockId }: ConnectionBlocksProps) {
  const [expandedConnections, setExpandedConnections] = useState<Set<string>>(new Set())
  const [expandedFieldPaths, setExpandedFieldPaths] = useState<Set<string>>(new Set())

  const toggleConnectionExpansion = useCallback((connectionId: string) => {
    setExpandedConnections((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(connectionId)) {
        newSet.delete(connectionId)
      } else {
        newSet.add(connectionId)
      }
      return newSet
    })
  }, [])

  const toggleFieldExpansion = useCallback((connectionId: string, fieldPath: string) => {
    setExpandedFieldPaths((prev) => {
      const next = new Set(prev)
      const key = `${connectionId}|${fieldPath}`
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const isFieldExpanded = useCallback(
    (connectionId: string, fieldPath: string) =>
      expandedFieldPaths.has(`${connectionId}|${fieldPath}`),
    [expandedFieldPaths]
  )

  const renderFieldTree = useCallback(
    (fields: SchemaField[], parentPath: string, level: number, connection: ConnectedBlock) => {
      return fields.map((field) => {
        const fieldPath = parentPath ? `${parentPath}.${field.name}` : field.name
        const hasChildren = !!(field.children && field.children.length > 0)
        const expanded = isFieldExpanded(connection.id, fieldPath)

        return (
          <div key={fieldPath}>
            <FieldItem
              connection={connection}
              field={field}
              path={fieldPath}
              level={level}
              hasChildren={hasChildren}
              isExpanded={expanded}
              onToggleExpand={(p) => toggleFieldExpansion(connection.id, p)}
            />
            {hasChildren && expanded && (
              <div className='relative'>
                <div
                  className='pointer-events-none absolute'
                  style={{
                    left: `${TREE_SPACING.BASE_INDENT + level * TREE_SPACING.INDENT_PER_LEVEL + TREE_SPACING.VERTICAL_LINE_LEFT_OFFSET}px`,
                    top: '0px',
                    width: '1px',
                    height: `${calculateFieldsHeight(field.children, fieldPath, connection.id, isFieldExpanded)}px`,
                    background: TREE_STYLES.LINE_COLOR,
                  }}
                />
                <div className='mt-[4px] space-y-[4px]'>
                  {renderFieldTree(field.children!, fieldPath, level + 1, connection)}
                </div>
              </div>
            )}
          </div>
        )
      })
    },
    [isFieldExpanded, toggleFieldExpansion]
  )

  if (!connections || connections.length === 0) {
    return null
  }

  return (
    <div className='rounded-[4px] px-[8px] pt-[1.5px] pb-[4px]'>
      <Label className='pb-[8px] pl-[2px]'>Connection blocks</Label>
      <div className='-mr-[8px] max-h-[120px] space-y-[4px] overflow-y-auto pr-[8px]'>
        {connections.map((connection) => {
          const blockConfig = getBlock(connection.type)
          const isExpanded = expandedConnections.has(connection.id)
          const fields = buildConnectionFields(connection)

          let Icon = blockConfig?.icon
          let bgColor = blockConfig?.bgColor || '#6B7280'

          if (!blockConfig) {
            if (connection.type === 'loop') {
              Icon = RepeatIcon as typeof Icon
              bgColor = '#2FB3FF'
            } else if (connection.type === 'parallel') {
              Icon = SplitIcon as typeof Icon
              bgColor = '#FEE12B'
            }
          }

          return (
            <div key={connection.id}>
              <div
                className={clsx(
                  'group flex h-[26px] items-center gap-[8px] rounded-[4px] px-[5px] text-[14px]',
                  'cursor-pointer border border-[#3D3D3D] bg-[#282828] font-medium transition-colors hover:border-[#4A4A4A] hover:bg-[#353535] dark:border-[#3D3D3D] dark:bg-[#353535] dark:hover:border-[#454545] dark:hover:bg-[#3D3D3D]'
                )}
                onClick={() => toggleConnectionExpansion(connection.id)}
              >
                <div
                  className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
                  style={{ backgroundColor: bgColor }}
                >
                  {Icon && (
                    <Icon
                      className={clsx(
                        'text-white transition-transform duration-200',
                        'group-hover:scale-110',
                        '!h-[10px] !w-[10px]'
                      )}
                    />
                  )}
                </div>
                <span className='flex-1 truncate text-[#E6E6E6] dark:text-[#E6E6E6]'>
                  {connection.name}
                </span>
                <ChevronDown
                  className={clsx(
                    'h-4 w-4 flex-shrink-0 opacity-50 transition-transform',
                    isExpanded && 'rotate-180'
                  )}
                />
              </div>

              {isExpanded && (
                <div className='relative space-y-[4px]'>
                  {fields.length === 0 ? (
                    <div className='rounded-[4px] border border-[#3D3D3D] bg-[#282828] p-[8px] text-[#787878] text-xs dark:border-[#3D3D3D] dark:bg-[#353535]'>
                      No schema available
                    </div>
                  ) : (
                    <>
                      <div
                        className='pointer-events-none absolute'
                        style={{
                          left: `${TREE_SPACING.VERTICAL_LINE_LEFT_OFFSET}px`,
                          top: '0px',
                          width: '1px',
                          height: `${calculateFieldsHeight(fields, '', connection.id, isFieldExpanded)}px`,
                          background: TREE_STYLES.LINE_COLOR,
                        }}
                      />
                      {renderFieldTree(fields, '', 0, connection)}
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
