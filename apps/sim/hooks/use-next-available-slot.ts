import { useCallback, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('useNextAvailableSlot')

interface NextAvailableSlotResponse {
  success: boolean
  data?: {
    nextAvailableSlot: string | null
    fieldType: string
    usedSlots: string[]
    totalSlots: number
    availableSlots: number
  }
  error?: string
}

export function useNextAvailableSlot(knowledgeBaseId: string | null) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const getNextAvailableSlot = useCallback(
    async (fieldType: string): Promise<string | null> => {
      if (!knowledgeBaseId) {
        setError('Knowledge base ID is required')
        return null
      }

      setIsLoading(true)
      setError(null)

      try {
        const url = new URL(
          `/api/knowledge/${knowledgeBaseId}/next-available-slot`,
          window.location.origin
        )
        url.searchParams.set('fieldType', fieldType)

        const response = await fetch(url.toString())

        if (!response.ok) {
          throw new Error(`Failed to get next available slot: ${response.statusText}`)
        }

        const data: NextAvailableSlotResponse = await response.json()

        if (!data.success) {
          throw new Error(data.error || 'Failed to get next available slot')
        }

        return data.data?.nextAvailableSlot || null
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        logger.error('Error getting next available slot:', err)
        setError(errorMessage)
        return null
      } finally {
        setIsLoading(false)
      }
    },
    [knowledgeBaseId]
  )

  const getSlotInfo = useCallback(
    async (fieldType: string) => {
      if (!knowledgeBaseId) {
        setError('Knowledge base ID is required')
        return null
      }

      setIsLoading(true)
      setError(null)

      try {
        const url = new URL(
          `/api/knowledge/${knowledgeBaseId}/next-available-slot`,
          window.location.origin
        )
        url.searchParams.set('fieldType', fieldType)

        const response = await fetch(url.toString())

        if (!response.ok) {
          throw new Error(`Failed to get slot info: ${response.statusText}`)
        }

        const data: NextAvailableSlotResponse = await response.json()

        if (!data.success) {
          throw new Error(data.error || 'Failed to get slot info')
        }

        return data.data || null
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        logger.error('Error getting slot info:', err)
        setError(errorMessage)
        return null
      } finally {
        setIsLoading(false)
      }
    },
    [knowledgeBaseId]
  )

  return {
    getNextAvailableSlot,
    getSlotInfo,
    isLoading,
    error,
  }
}
