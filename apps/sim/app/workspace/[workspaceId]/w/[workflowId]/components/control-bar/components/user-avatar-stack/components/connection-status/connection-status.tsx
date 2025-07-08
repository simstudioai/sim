'use client'

import { useEffect, useState } from 'react'

interface ConnectionStatusProps {
  isConnected: boolean
  isSyncing: boolean
}

export function ConnectionStatus({ isConnected, isSyncing }: ConnectionStatusProps) {
  const [showOfflineNotice, setShowOfflineNotice] = useState(false)
  const [syncCompleted, setSyncCompleted] = useState(false)

  useEffect(() => {
    let timeoutId: NodeJS.Timeout

    if (!isConnected) {
      timeoutId = setTimeout(() => {
        setShowOfflineNotice(true)
      }, 6000) // 6 seconds
    } else if (isConnected && showOfflineNotice && !isSyncing && syncCompleted) {
      setShowOfflineNotice(false)
      setSyncCompleted(false)
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [isConnected, isSyncing, showOfflineNotice, syncCompleted])

  // Track when sync completes
  useEffect(() => {
    if (!isSyncing && showOfflineNotice && isConnected) {
      setSyncCompleted(true)
    }
  }, [isSyncing, showOfflineNotice, isConnected])

  // Don't render anything if connected or if we haven't been disconnected long enough
  if (!showOfflineNotice) {
    return null
  }

  // Show different states based on connection and sync status
  if (isConnected && isSyncing) {
    return (
      <div className='flex items-center gap-1.5'>
        <div className='flex items-center gap-1.5 text-yellow-600'>
          <div className='relative flex items-center justify-center'>
            <div className='absolute h-3 w-3 animate-ping rounded-full bg-yellow-500/20' />
            <div className='relative h-2 w-2 rounded-full bg-yellow-500' />
          </div>
          <div className='flex flex-col'>
            <span className='font-medium text-xs leading-tight'>Syncing changes</span>
            <span className='text-xs leading-tight opacity-90'>
              Saving local changes to database...
            </span>
          </div>
        </div>
      </div>
    )
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
