import { useEffect, useRef } from 'react'

interface UseBuilderJsonSyncOptions<T> {
  modeValue: string | null
  jsonValue: string | null
  setJsonValue: (value: string) => void
  isPreview: boolean
  conditions: T[]
  setConditions: (conditions: T[]) => void
  jsonToConditions: (json: string) => T[]
  conditionsToJson: (conditions: T[]) => string
  enabled?: boolean
}

/**
 * Handles bidirectional sync between builder conditions and JSON format.
 *
 * - JSON → Builder: When mode switches to 'builder', parses JSON into conditions
 * - Builder → JSON: When conditions change in builder mode, converts to JSON
 */
export function useBuilderJsonSync<T>({
  modeValue,
  jsonValue,
  setJsonValue,
  isPreview,
  conditions,
  setConditions,
  jsonToConditions,
  conditionsToJson,
  enabled = true,
}: UseBuilderJsonSyncOptions<T>) {
  const prevModeRef = useRef<string | null>(null)
  const isSyncingRef = useRef(false)

  // Sync JSON → Builder when switching to builder mode
  useEffect(() => {
    if (!enabled || isPreview) return

    const switchingToBuilder =
      prevModeRef.current !== null && prevModeRef.current !== 'builder' && modeValue === 'builder'

    if (switchingToBuilder && jsonValue?.trim()) {
      isSyncingRef.current = true
      const parsedConditions = jsonToConditions(jsonValue)
      if (parsedConditions.length > 0) {
        setConditions(parsedConditions)
      }
      isSyncingRef.current = false
    }

    prevModeRef.current = modeValue
  }, [modeValue, jsonValue, setConditions, isPreview, jsonToConditions, enabled])

  // Sync Builder → JSON when conditions change in builder mode
  useEffect(() => {
    if (!enabled || isPreview || isSyncingRef.current) return
    if (modeValue !== 'builder') return

    if (conditions.length > 0) {
      const newJson = conditionsToJson(conditions)
      if (newJson !== jsonValue) {
        setJsonValue(newJson)
      }
    }
  }, [conditions, modeValue, jsonValue, setJsonValue, isPreview, conditionsToJson, enabled])
}
