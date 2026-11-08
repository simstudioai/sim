import { useEffect, useRef } from 'react'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { convertBuilderDataToJsonString, type JSONProperty } from '@/executor/utils/builder-data'
import { useSubBlockValue } from '@/platform/lib/data/workflow-editor'

type BuilderFieldType = 'string' | 'number' | 'boolean' | 'object' | 'array'

interface BuilderField {
  id: string
  name: string
  type: BuilderFieldType
  value: unknown
  collapsed: boolean
}

function inferType(value: unknown): BuilderFieldType {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object' && value !== null) return 'object'
  return 'string'
}

/** Quotes bare `<block.output>` references so the JSON parses before it becomes builder rows. */
function normalizeVariableReferences(jsonString: string): string {
  return jsonString.replace(/([^"]<[^>]+>)/g, '"$1"')
}

function convertJsonToBuilderData(jsonString: string): BuilderField[] {
  try {
    const parsed: unknown = JSON.parse(normalizeVariableReferences(jsonString))
    if (!isRecordLike(parsed)) return []
    return Object.entries(parsed).map(([name, value]) => {
      const type = inferType(value)
      return {
        id: generateId(),
        name,
        type,
        value: type === 'object' || type === 'array' ? JSON.stringify(value, null, 2) : value,
        collapsed: false,
      }
    })
  } catch {
    return []
  }
}

interface UseDataModeSyncOptions {
  blockId: string
  subBlockId: string
  mode: unknown
  enabled: boolean
}

/**
 * The Response block's `dataMode` switch carries the body across: structured rows become a JSON
 * string when switching to JSON, and a JSON body becomes rows when switching back.
 */
export function useDataModeSync({ blockId, subBlockId, mode, enabled }: UseDataModeSyncOptions) {
  const active = enabled && subBlockId === 'dataMode'
  const [builderData, setBuilderData] = useSubBlockValue<unknown[]>(blockId, 'builderData')
  const [data, setData] = useSubBlockValue<string>(blockId, 'data')
  const previousModeRef = useRef<string | null>(null)
  const builderDataRef = useRef(builderData)
  const dataRef = useRef(data)

  useEffect(() => {
    builderDataRef.current = builderData
    dataRef.current = data
  }, [builderData, data])

  useEffect(() => {
    if (!active) return
    const currentMode = typeof mode === 'string' ? mode : ''
    const previousMode = previousModeRef.current
    if (previousMode !== null && previousMode !== currentMode) {
      if (currentMode === 'json' && previousMode === 'structured') {
        const rows = builderDataRef.current
        if (Array.isArray(rows) && rows.length > 0)
          setData(convertBuilderDataToJsonString(rows as JSONProperty[]))
      } else if (currentMode === 'structured' && previousMode === 'json') {
        const body = dataRef.current
        if (typeof body === 'string' && body.trim().length > 0)
          setBuilderData(convertJsonToBuilderData(body))
      }
    }
    previousModeRef.current = currentMode
  }, [active, mode, setData, setBuilderData])
}
