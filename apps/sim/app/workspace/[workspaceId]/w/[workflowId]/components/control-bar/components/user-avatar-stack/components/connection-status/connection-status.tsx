'use client'

import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/w/components/providers/workspace-permissions-provider'

interface ConnectionStatusProps {
  isConnected: boolean
  hasOperationError?: boolean
}

export function ConnectionStatus({ isConnected, hasOperationError }: ConnectionStatusProps) {
  const userPermissions = useUserPermissionsContext()

  const handleRefresh = () => {
    window.location.reload()
  }

  // Show error if either offline mode OR operation error
  const shouldShowError = userPermissions.isOfflineMode || hasOperationError

  // Don't render anything if no errors
  if (!shouldShowError) {
    return null
  }

  return (
    <div className='flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2'>
      <div className='flex items-center gap-2 text-red-700'>
        <div className='relative flex items-center justify-center'>
          {!isConnected && (
            <div className='absolute h-4 w-4 animate-ping rounded-full bg-red-500/20' />
          )}
          <AlertTriangle className='relative h-4 w-4' />
        </div>
        <div className='flex flex-col'>
          <span className='font-medium text-xs leading-tight'>
            {hasOperationError
              ? 'Workflow Edit Failed'
              : isConnected
                ? 'Reconnected'
                : 'Connection lost - please refresh'}
          </span>
          <span className='text-red-600 text-xs leading-tight'>
            Please refresh to continue editing
          </span>
        </div>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={handleRefresh}
            variant='ghost'
            size='sm'
            className='h-7 w-7 p-0 text-red-700 hover:bg-red-100 hover:text-red-800'
          >
            <RefreshCw className='h-4 w-4' />
          </Button>
        </TooltipTrigger>
        <TooltipContent className='z-[9999]'>Refresh page to continue editing</TooltipContent>
      </Tooltip>
    </div>
  )
}
