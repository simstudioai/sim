import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('useAutoSave')

/** Auto-save debounce delay in milliseconds */
const AUTO_SAVE_DEBOUNCE_MS = 1500

/** Delay before enabling auto-save after initial load */
const INITIAL_LOAD_DELAY_MS = 500

/** Default maximum retry attempts */
const DEFAULT_MAX_RETRIES = 3

/** Delay before resetting save status to idle after successful save */
const SAVED_STATUS_DISPLAY_MS = 2000

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface SaveConfigResult {
  success: boolean
}

interface UseAutoSaveOptions<T extends SaveConfigResult = SaveConfigResult> {
  /** Whether auto-save is disabled (e.g., in preview mode) */
  disabled?: boolean
  /** Whether a save operation is already in progress externally */
  isExternallySaving?: boolean
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number
  /** Validate config before saving, return true if valid */
  validate: () => boolean
  /** Perform the save operation */
  onSave: () => Promise<T>
  /** Optional callback after successful save */
  onSaveSuccess?: (result: T) => void
  /** Optional callback after failed save */
  onSaveError?: (error: Error) => void
  /** Logger name for debugging */
  loggerName?: string
}

interface UseAutoSaveReturn {
  /** Current save status */
  saveStatus: SaveStatus
  /** Error message if save failed */
  errorMessage: string | null
  /** Current retry count */
  retryCount: number
  /** Maximum retries allowed */
  maxRetries: number
  /** Whether max retries has been reached */
  maxRetriesReached: boolean
  /** Trigger an immediate save attempt (for retry button) */
  triggerSave: () => Promise<void>
  /** Call this when config changes to trigger debounced save */
  onConfigChange: (configFingerprint: string) => void
  /** Call this when initial load completes to enable auto-save */
  markInitialLoadComplete: (currentFingerprint: string) => void
}

/**
 * Shared hook for auto-saving configuration with debouncing, retry limits, and status management.
 *
 * @example
 * ```tsx
 * const { saveStatus, errorMessage, triggerSave, onConfigChange, markInitialLoadComplete } = useAutoSave({
 *   disabled: isPreview,
 *   isExternallySaving: isSaving,
 *   validate: () => validateRequiredFields(),
 *   onSave: async () => saveConfig(),
 *   onSaveSuccess: (result) => { ... },
 * })
 *
 * // When config fingerprint changes
 * useEffect(() => {
 *   onConfigChange(configFingerprint)
 * }, [configFingerprint, onConfigChange])
 *
 * // When initial data loads
 * useEffect(() => {
 *   if (!isLoading && dataId) {
 *     markInitialLoadComplete(configFingerprint)
 *   }
 * }, [isLoading, dataId, configFingerprint, markInitialLoadComplete])
 * ```
 */
export function useAutoSave<T extends SaveConfigResult = SaveConfigResult>({
  disabled = false,
  isExternallySaving = false,
  maxRetries = DEFAULT_MAX_RETRIES,
  validate,
  onSave,
  onSaveSuccess,
  onSaveError,
  loggerName,
}: UseAutoSaveOptions<T>): UseAutoSaveReturn {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedConfigRef = useRef<string | null>(null)
  const isInitialLoadRef = useRef(true)
  const currentFingerprintRef = useRef<string | null>(null)

  // Clear any pending timeout on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current)
      }
    }
  }, [])

  const performSave = useCallback(async () => {
    if (disabled || isExternallySaving) return

    // Final validation check before saving
    if (!validate()) {
      setSaveStatus('idle')
      return
    }

    setSaveStatus('saving')
    setErrorMessage(null)

    try {
      const result = await onSave()

      if (!result.success) {
        throw new Error('Save operation returned unsuccessful result')
      }

      // Update last saved config to current
      lastSavedConfigRef.current = currentFingerprintRef.current
      setSaveStatus('saved')
      setErrorMessage(null)
      setRetryCount(0) // Reset retry count on success

      if (onSaveSuccess) {
        onSaveSuccess(result)
      }

      // Reset to idle after display duration
      setTimeout(() => {
        setSaveStatus('idle')
      }, SAVED_STATUS_DISPLAY_MS)

      if (loggerName) {
        logger.info(`${loggerName}: Auto-save completed successfully`)
      }
    } catch (error: unknown) {
      setSaveStatus('error')
      const message = error instanceof Error ? error.message : 'An error occurred while saving.'
      setErrorMessage(message)
      setRetryCount((prev) => prev + 1)

      if (onSaveError && error instanceof Error) {
        onSaveError(error)
      }

      if (loggerName) {
        logger.error(`${loggerName}: Auto-save failed`, { error })
      }
    }
  }, [disabled, isExternallySaving, validate, onSave, onSaveSuccess, onSaveError, loggerName])

  const onConfigChange = useCallback(
    (configFingerprint: string) => {
      currentFingerprintRef.current = configFingerprint

      if (disabled) return

      // Clear any existing timeout
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current)
      }

      // Skip if initial load hasn't completed
      if (isInitialLoadRef.current) return

      // Skip if already saving
      if (saveStatus === 'saving' || isExternallySaving) return

      // Clear error if validation now passes
      if (saveStatus === 'error' && validate()) {
        setErrorMessage(null)
        setSaveStatus('idle')
        setRetryCount(0) // Reset retry count when config changes
      }

      // Skip if config hasn't changed
      if (configFingerprint === lastSavedConfigRef.current) return

      // Skip if validation fails
      if (!validate()) return

      // Schedule debounced save
      autoSaveTimeoutRef.current = setTimeout(() => {
        if (loggerName) {
          logger.debug(`${loggerName}: Triggering debounced auto-save`)
        }
        performSave()
      }, AUTO_SAVE_DEBOUNCE_MS)
    },
    [disabled, saveStatus, isExternallySaving, validate, performSave, loggerName]
  )

  const markInitialLoadComplete = useCallback((currentFingerprint: string) => {
    // Delay before enabling auto-save to prevent immediate trigger
    const timer = setTimeout(() => {
      isInitialLoadRef.current = false
      lastSavedConfigRef.current = currentFingerprint
      currentFingerprintRef.current = currentFingerprint
    }, INITIAL_LOAD_DELAY_MS)

    return () => clearTimeout(timer)
  }, [])

  const triggerSave = useCallback(async () => {
    // Allow retry even if max retries reached (manual trigger)
    await performSave()
  }, [performSave])

  return {
    saveStatus,
    errorMessage,
    retryCount,
    maxRetries,
    maxRetriesReached: retryCount >= maxRetries,
    triggerSave,
    onConfigChange,
    markInitialLoadComplete,
  }
}
