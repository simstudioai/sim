'use client'

import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

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
      <div className='flex items-center gap-1 text-red-600'>
        <WifiOff className='h-3.5 w-3.5' />
        <div className='flex flex-col'>
          <span className='text-xs font-medium leading-tight'>Connection lost</span>
          <span className='text-xs leading-tight opacity-90'>Changes not saved - please refresh</span>
        </div>
      </div>
    </div>
  )
}
