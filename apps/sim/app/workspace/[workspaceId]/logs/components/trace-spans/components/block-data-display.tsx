import { highlight, languages } from 'prismjs'
import 'prismjs/components/prism-json'
import { transformBlockData } from '@/app/workspace/[workspaceId]/logs/components/trace-spans/utils'
import '@/components/emcn/components/code/code.css'

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

  const transformedData = transformBlockData(data, blockType || 'unknown', isInput)
  const dataToDisplay = transformedData || data

  // Format the data as JSON string
  const jsonString = JSON.stringify(dataToDisplay, null, 2)

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
            <div className='code-editor-theme'>
              <pre
                className='w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all font-mono text-[#eeeeee] text-[11px] leading-[16px]'
                dangerouslySetInnerHTML={{
                  __html: highlight(
                    JSON.stringify(
                      Object.fromEntries(
                        Object.entries(transformedData).filter(
                          ([key]) => key !== 'error' && key !== 'success'
                        )
                      ),
                      null,
                      2
                    ),
                    languages.json,
                    'json'
                  ),
                }}
              />
            </div>
          )}
      </div>
    )
  }

  return (
    <div className='code-editor-theme overflow-hidden'>
      <pre
        className='w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all font-mono text-[#eeeeee] text-[11px] leading-[16px]'
        dangerouslySetInnerHTML={{
          __html: highlight(jsonString, languages.json, 'json'),
        }}
      />
    </div>
  )
}
