'use client'

import { useEffect, useState } from 'react'

interface ConnectionStatusProps {
  isConnected: boolean
}

export function ConnectionStatus({ isConnected }: ConnectionStatusProps) {
  const [showOfflineNotice, setShowOfflineNotice] = useState(false)

  useEffect(() => {
    let timeoutId: NodeJS.Timeout

    if (!isConnected) {
      // Show offline notice after 6 seconds of being disconnected
      timeoutId = setTimeout(() => {
        setShowOfflineNotice(true)
      }, 6000) // 6 seconds
    } else {
      // Hide notice immediately when reconnected
      setShowOfflineNotice(false)
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [isConnected])

  // Don't render anything if connected or if we haven't been disconnected long enough
  if (!showOfflineNotice) {
    return null
  }

  return (
    <div className='flex items-center gap-1.5'>
      <div className='flex items-center gap-1.5 text-red-600'>
        <div className='relative flex items-center justify-center'>
          <div className='absolute h-3 w-3 animate-ping rounded-full bg-red-500/20' />
          <div className='relative h-2 w-2 rounded-full bg-red-500' />
        </div>
        <div className='flex flex-col'>
          <span className='font-medium text-xs leading-tight'>Connection lost</span>
          <span className='text-xs leading-tight opacity-90'>
            Changes not saved - please refresh
          </span>
        </div>
      </div>
    </div>
  )
}
