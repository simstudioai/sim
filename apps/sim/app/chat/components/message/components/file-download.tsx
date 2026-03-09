'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { ArrowDown, Download, Loader2, Music } from 'lucide-react'
import { Button } from '@/components/emcn'
import { DefaultFileIcon, getDocumentIcon } from '@/components/icons/document-icons'
import type { ChatFile } from '@/app/chat/components/message/message'

const logger = createLogger('ChatFileDownload')

interface ChatFileDownloadProps {
  file: ChatFile
}

interface ChatFileDownloadAllProps {
  files: ChatFile[]
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Math.round((bytes / k ** i) * 10) / 10} ${sizes[i]}`
}

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

function isImageFile(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

function getFileUrl(file: ChatFile): string {
  return `/api/files/serve/${encodeURIComponent(file.key)}?context=${file.context || 'execution'}`
}

async function triggerDownload(url: string, filename: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`)
  }

  const blob = await response.blob()
  const blobUrl = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = blobUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  URL.revokeObjectURL(blobUrl)
  logger.info(`Downloaded: ${filename}`)
}

export function ChatFileDownload({ file }: ChatFileDownloadProps) {
  const [isDownloading, setIsDownloading] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  const handleDownload = async () => {
    if (isDownloading) return

    setIsDownloading(true)

    try {
      logger.info(`Initiating download for file: ${file.name}`)
      const url = getFileUrl(file)
      await triggerDownload(url, file.name)
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
    <Button
      variant='default'
      onClick={handleDownload}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      disabled={isDownloading}
      className='flex h-auto w-[200px] items-center gap-2 rounded-lg px-3 py-2'
    >
      <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center'>{renderIcon()}</div>
      <div className='min-w-0 flex-1 text-left'>
        <div className='w-[100px] truncate text-xs'>{file.name}</div>
        <div className='text-[10px] text-[var(--text-muted)]'>{formatFileSize(file.size)}</div>
      </div>
      <div className='flex-shrink-0'>
        {isDownloading ? (
          <Loader2 className='h-3.5 w-3.5 animate-spin' />
        ) : (
          <ArrowDown
            className={`h-3.5 w-3.5 transition-opacity ${isHovered ? 'opacity-100' : 'opacity-0'}`}
          />
        )}
      </div>
    </Button>
  )
}

export function ChatFileDownloadAll({ files }: ChatFileDownloadAllProps) {
  const [isDownloading, setIsDownloading] = useState(false)

  if (!files || files.length === 0) return null

  const handleDownloadAll = async () => {
    if (isDownloading) return

    setIsDownloading(true)

    try {
      logger.info(`Initiating download for ${files.length} files`)

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        try {
          const url = getFileUrl(file)
          await triggerDownload(url, file.name)
          logger.info(`Downloaded file ${i + 1}/${files.length}: ${file.name}`)

          if (i < files.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 150))
          }
        } catch (error) {
          logger.error(`Failed to download file ${file.name}:`, error)
        }
      }
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <button
      onClick={handleDownloadAll}
      disabled={isDownloading}
      className='text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50'
    >
      {isDownloading ? (
        <Loader2 className='h-3 w-3 animate-spin' strokeWidth={2} />
      ) : (
        <Download className='h-3 w-3' strokeWidth={2} />
      )}
    </button>
  )
}
