'use client'

import { useCallback, useState } from 'react'
import clsx from 'clsx'
import { ChevronRight } from 'lucide-react'
import { Badge } from '@/components/emcn'

/**
 * Spacing and styling constants
 */
const INDENT_SIZE = 16
const LINE_HEIGHT = 24

interface PrettierOutputProps {
  output: any
  wrapText?: boolean
}

/**
 * Determines the display type of a value
 */
const getValueType = (value: any): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return typeof value
}

/**
 * Formats a primitive value for display
 */
const formatValue = (value: any, type: string): string => {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (type === 'string') return `"${value}"`
  if (type === 'boolean') return value ? 'true' : 'false'
  if (type === 'number') return String(value)
  return String(value)
}

/**
 * Gets a preview for collapsed objects/arrays
 */
const getCollapsedPreview = (value: any, type: string): string => {
  if (type === 'array') {
    const length = Array.isArray(value) ? value.length : 0
    return `Array(${length})`
  }
  if (type === 'object' && value !== null) {
    const keys = Object.keys(value).length
    return `Object {${keys} ${keys === 1 ? 'property' : 'properties'}}`
  }
  return ''
}

interface ValueRowProps {
  name: string
  value: any
  level: number
  path: string
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  wrapText?: boolean
}

/**
 * Renders a single key-value row
 */
function ValueRow({ name, value, level, path, expandedPaths, onToggle, wrapText }: ValueRowProps) {
  const type = getValueType(value)
  const isExpandable = type === 'object' || type === 'array'
  const isExpanded = expandedPaths.has(path)
  const indent = level * INDENT_SIZE

  const handleClick = useCallback(() => {
    if (isExpandable) {
      onToggle(path)
    }
  }, [isExpandable, onToggle, path])

  return (
    <div className='relative'>
      <div
        onClick={handleClick}
        className={clsx(
          'flex items-center gap-2 rounded-md px-2 py-1',
          isExpandable && 'cursor-pointer hover:bg-[var(--border)]'
        )}
        style={{
          paddingLeft: `${indent + 8}px`,
          minHeight: `${LINE_HEIGHT}px`,
        }}
      >
        {isExpandable ? (
          <ChevronRight
            className={clsx(
              'h-3 w-3 flex-shrink-0 text-[#8D8D8D] transition-transform',
              isExpanded && 'rotate-90'
            )}
          />
        ) : (
          <div className='h-3 w-3 flex-shrink-0' />
        )}

        <span className='font-medium text-[13px] text-[var(--text-tertiary)]'>{name}:</span>

        {!isExpandable ? (
          <span
            className={clsx(
              'flex-1 text-[13px] text-[var(--text-primary)]',
              !wrapText && 'truncate'
            )}
            style={wrapText ? { wordBreak: 'break-word' } : undefined}
          >
            {formatValue(value, type)}
          </span>
        ) : (
          !isExpanded && (
            <span className='text-[#8D8D8D] text-[12px] italic'>
              {getCollapsedPreview(value, type)}
            </span>
          )
        )}

        <Badge className='ml-auto flex-shrink-0 rounded-[4px] px-2 py-0.5 font-mono text-[10px]'>
          {type}
        </Badge>
      </div>

      {isExpandable && isExpanded && (
        <div>
          {type === 'array' && Array.isArray(value)
            ? value.map((item, index) => (
                <ValueRow
                  key={`${path}[${index}]`}
                  name={`[${index}]`}
                  value={item}
                  level={level + 1}
                  path={`${path}[${index}]`}
                  expandedPaths={expandedPaths}
                  onToggle={onToggle}
                  wrapText={wrapText}
                />
              ))
            : type === 'object' && value !== null
              ? Object.entries(value).map(([key, val]) => (
                  <ValueRow
                    key={`${path}.${key}`}
                    name={key}
                    value={val}
                    level={level + 1}
                    path={`${path}.${key}`}
                    expandedPaths={expandedPaths}
                    onToggle={onToggle}
                    wrapText={wrapText}
                  />
                ))
              : null}
        </div>
      )}
    </div>
  )
}

/**
 * Console-style output viewer for structured data.
 * Displays key-value pairs in a clean, stacked format similar to browser dev tools.
 */
export function PrettierOutput({ output, wrapText }: PrettierOutputProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())

  const togglePath = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  if (!output || (typeof output === 'object' && Object.keys(output).length === 0)) {
    return (
      <div className='flex h-full items-center justify-center text-[#8D8D8D] text-[12px]'>
        No output data
      </div>
    )
  }

  // Handle primitive output (non-object)
  if (typeof output !== 'object' || output === null) {
    const type = getValueType(output)
    return (
      <div className='p-2'>
        <div className='flex items-center gap-2 py-1'>
          <span className='text-[13px] text-[var(--text-primary)]'>
            {formatValue(output, type)}
          </span>
          <Badge className='rounded-[4px] px-2 py-0.5 font-mono text-[10px]'>{type}</Badge>
        </div>
      </div>
    )
  }

  return (
    <div className='py-1'>
      {Object.entries(output).map(([key, value]) => (
        <ValueRow
          key={key}
          name={key}
          value={value}
          level={0}
          path={key}
          expandedPaths={expandedPaths}
          onToggle={togglePath}
          wrapText={wrapText}
        />
      ))}
    </div>
  )
}
