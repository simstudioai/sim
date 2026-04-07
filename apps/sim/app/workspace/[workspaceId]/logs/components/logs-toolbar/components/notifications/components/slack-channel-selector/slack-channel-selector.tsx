'use client'

import { useCallback, useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Hash, Lock } from 'lucide-react'
import { Combobox, type ComboboxOption } from '@/components/emcn'

const logger = createLogger('SlackChannelSelector')

interface SlackChannel {
  id: string
  name: string
  isPrivate: boolean
}

interface SlackChannelSelectorProps {
  accountId: string
  value: string
  onChange: (channelId: string, channelName: string) => void
  disabled?: boolean
  error?: string
}

/**
 * Standalone Slack channel selector that fetches channels for a given account.
 */
export function SlackChannelSelector({
  accountId,
  value,
  onChange,
  disabled = false,
  error,
}: SlackChannelSelectorProps) {
  const [channels, setChannels] = useState<SlackChannel[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const fetchChannels = useCallback(async () => {
    if (!accountId) {
      setChannels([])
      return
    }

    setIsLoading(true)
    setFetchError(null)

    try {
      const response = await fetch('/api/tools/slack/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: accountId }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to fetch channels')
      }

      const data = await response.json()
      setChannels(data.channels || [])
    } catch (err) {
      logger.error('Failed to fetch Slack channels', { error: err })
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch channels')
      setChannels([])
    } finally {
      setIsLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    fetchChannels()
  }, [fetchChannels])

  const options: ComboboxOption[] = channels.map((channel) => ({
    label: channel.name,
    value: channel.id,
    icon: channel.isPrivate ? Lock : Hash,
  }))

  const selectedChannel = channels.find((c) => c.id === value)

  const handleChange = (channelId: string) => {
    const channel = channels.find((c) => c.id === channelId)
    onChange(channelId, channel?.name || '')
  }

  return (
    <div className='flex flex-col gap-1'>
      <Combobox
        options={options}
        value={value}
        onChange={handleChange}
        placeholder={
          !accountId
            ? 'Select an account first...'
            : channels.length === 0 && !isLoading
              ? 'No channels available'
              : 'Select channel...'
        }
        disabled={disabled || !accountId || channels.length === 0}
        isLoading={isLoading}
        error={fetchError}
        searchable
        searchPlaceholder='Search channels...'
      />
      {selectedChannel && !fetchError && (
        <p className='text-[var(--text-muted)] text-caption'>
          {selectedChannel.isPrivate ? 'Private' : 'Public'} channel: #{selectedChannel.name}
        </p>
      )}
      {error && <p className='text-[var(--text-error)] text-caption'>{error}</p>}
    </div>
  )
}

export default SlackChannelSelector
