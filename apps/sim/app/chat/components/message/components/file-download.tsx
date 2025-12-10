'use client'

import { useState } from 'react'
import { ArrowDown, Loader2, Music } from 'lucide-react'
import { Button, Tooltip } from '@/components/emcn'
import { DefaultFileIcon, getDocumentIcon } from '@/components/icons/document-icons'
import { createLogger } from '@/lib/logs/console/logger'
import type { ChatFile } from '@/app/chat/components/message/message'

const logger = createLogger('ChatFileDownload')

interface ChatFileDownloadProps {
  file: ChatFile
}

/**
 * Format file size in human-readable format
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Math.round((bytes / k ** i) * 10) / 10} ${sizes[i]}`
}

/**
 * Check if file is an audio type
 */
function isAudioFile(mimeType: string, filename: string): boolean {
  const audioMimeTypes = [
    'audio/mpeg',
    'audio/wav',
    'audio/mp3',
    'audio/ogg',
    'audio/webm',
    'audio/aac',
    'audio/flac',
  ]
  const audioExtensions = ['mp3', 'wav', 'ogg', 'webm', 'aac', 'flac', 'm4a']
  const extension = filename.split('.').pop()?.toLowerCase()

  return (
    audioMimeTypes.some((t) => mimeType.includes(t)) ||
    (extension ? audioExtensions.includes(extension) : false)
  )
}

/**
 * Check if file is an image type
 */
function isImageFile(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

/**
 * File download component for the deployed chat interface.
 * Renders a clickable file card that opens the file in a new tab.
 */
export function ChatFileDownload({ file }: ChatFileDownloadProps) {
  const [isDownloading, setIsDownloading] = useState(false)

  const handleDownload = () => {
    if (isDownloading) return

    setIsDownloading(true)

    try {
      logger.info(`Initiating download for file: ${file.name}`)

      if (file.key.startsWith('url/')) {
        if (file.url) {
          window.open(file.url, '_blank')
          logger.info(`Opened URL-type file directly: ${file.url}`)
          return
        }
        throw new Error('URL is required for URL-type files')
      }

      if (file.url) {
        window.open(file.url, '_blank')
        logger.info(`Opened file via presigned URL: ${file.name}`)
      } else {
        const serveUrl = `/api/files/serve/${encodeURIComponent(file.key)}?context=${file.context || 'execution'}`
        window.open(serveUrl, '_blank')
        logger.info(`Opened file via serve endpoint: ${serveUrl}`)
      }
    } catch (error) {
      logger.error(`Failed to download file ${file.name}:`, error)
      if (file.url) {
        window.open(file.url, '_blank')
      }
    } finally {
      setIsDownloading(false)
    }
  }

  const renderIcon = () => {
    if (isAudioFile(file.type, file.name)) {
      return <Music className='h-4 w-4 text-purple-500' />
    }
    if (isImageFile(file.type)) {
      const ImageIcon = DefaultFileIcon
      return <ImageIcon className='h-5 w-5' />
    }
    const DocumentIcon = getDocumentIcon(file.type, file.name)
    return <DocumentIcon className='h-5 w-5' />
  }

  return (
    <Tooltip.Provider>
      <Tooltip.Root delayDuration={300}>
        <Tooltip.Trigger asChild>
          <Button
            variant='ghost'
            onClick={handleDownload}
            disabled={isDownloading}
            className='flex h-auto w-[200px] items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700'
          >
            <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center'>
              {renderIcon()}
            </div>
            <div className='min-w-0 flex-1 text-left'>
              <div className='w-[100px] truncate font-medium text-gray-800 text-xs dark:text-gray-200'>
                {file.name}
              </div>
              <div className='text-[10px] text-gray-500 dark:text-gray-400'>
                {formatFileSize(file.size)}
              </div>
            </div>
            <div className='flex-shrink-0'>
              {isDownloading ? (
                <Loader2 className='h-3.5 w-3.5 animate-spin text-gray-500 dark:text-gray-400' />
              ) : (
                <ArrowDown className='h-3.5 w-3.5 text-gray-500 dark:text-gray-400' />
              )}
            </div>
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='top' align='center' sideOffset={5}>
          {file.name}
        </Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
