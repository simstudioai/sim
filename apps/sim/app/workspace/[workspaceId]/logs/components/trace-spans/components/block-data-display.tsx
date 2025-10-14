import type React from 'react'
import { transformBlockData } from '@/app/workspace/[workspaceId]/logs/components/trace-spans/utils'

export function BlockDataDisplay({
  data,
  blockType,
  isInput = false,
  isError = false,
}: {
  data: unknown
  blockType?: string
  isInput?: boolean
  isError?: boolean
}) {
  if (!data) return null

  const renderValue = (value: unknown, key?: string): React.ReactNode => {
    if (value === null) return <span className='text-muted-foreground italic'>null</span>
    if (value === undefined) return <span className='text-muted-foreground italic'>undefined</span>

    if (typeof value === 'string') {
      return <span className='break-all text-emerald-700 dark:text-emerald-400'>"{value}"</span>
    }

    if (typeof value === 'number') {
      return <span className='font-mono text-blue-700 dark:text-blue-400'>{value}</span>
    }

    if (typeof value === 'boolean') {
      return (
        <span className='font-mono text-amber-700 dark:text-amber-400'>{value.toString()}</span>
      )
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return <span className='text-muted-foreground'>[]</span>
      return (
        <div className='space-y-0.5'>
          <span className='text-muted-foreground'>[</span>
          <div className='ml-2 space-y-0.5'>
            {value.map((item, index) => (
              <div key={index} className='flex min-w-0 gap-1.5'>
                <span className='flex-shrink-0 font-mono text-slate-600 text-xs dark:text-slate-400'>
                  {index}:
                </span>
                <div className='min-w-0 flex-1 overflow-hidden'>{renderValue(item)}</div>
              </div>
            ))}
          </div>
          <span className='text-muted-foreground'>]</span>
        </div>
      )
    }

    if (typeof value === 'object') {
      const entries = Object.entries(value)
      if (entries.length === 0) return <span className='text-muted-foreground'>{'{}'}</span>

      return (
        <div className='space-y-0.5'>
          {entries.map(([objKey, objValue]) => (
            <div key={objKey} className='flex min-w-0 gap-1.5'>
              <span className='flex-shrink-0 font-medium text-indigo-700 dark:text-indigo-400'>
                {objKey}:
              </span>
              <div className='min-w-0 flex-1 overflow-hidden'>{renderValue(objValue, objKey)}</div>
            </div>
          ))}
        </div>
      )
    }

    return <span>{String(value)}</span>
  }

  const transformedData = transformBlockData(data, blockType || 'unknown', isInput)

  if (isError && typeof data === 'object' && data !== null && 'error' in data) {
    const errorData = data as { error: string; [key: string]: unknown }
    return (
      <div className='space-y-2 text-xs'>
        <div className='rounded border border-red-200 bg-red-50 p-2 dark:border-red-800 dark:bg-red-950/20'>
          <div className='mb-1 font-medium text-red-800 dark:text-red-400'>Error</div>
          <div className='text-red-700 dark:text-red-300'>{errorData.error}</div>
        </div>
        {transformedData &&
          Object.keys(transformedData).filter((key) => key !== 'error' && key !== 'success')
            .length > 0 && (
            <div className='space-y-0.5'>
              {Object.entries(transformedData)
                .filter(([key]) => key !== 'error' && key !== 'success')
                .map(([key, value]) => (
                  <div key={key} className='flex gap-1.5'>
                    <span className='font-medium text-indigo-700 dark:text-indigo-400'>{key}:</span>
                    {renderValue(value, key)}
                  </div>
                ))}
            </div>
          )}
      </div>
    )
  }

  return (
    <div className='space-y-1 overflow-hidden text-xs'>{renderValue(transformedData || data)}</div>
  )
}
