'use client'

import { useState } from 'react'
import { Button, Download, Loader } from '@sim/emcn'
import { Music } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { DefaultFileIcon, getDocumentIcon } from '@/components/icons/document-icons'
import { isSafeHttpUrl } from '@/lib/core/utils/urls'
import { saveBlob } from '@/lib/uploads/client/download'
import type { ChatFile } from '@/app/(interfaces)/chat/components/message/message'

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
  if (file.base64) return `data:${file.type};base64,${file.base64}`
  if (isSafeHttpUrl(file.url)) return file.url
  return `/api/files/serve/${encodeURIComponent(file.key)}?context=${file.context || 'execution'}`
}

async function triggerDownload(file: ChatFile): Promise<void> {
  if (file.base64) {
    /** Decoding locally avoids a data-URL fetch, which connect-src does not allow. */
    const decoded = atob(file.base64)
    const bytes = new Uint8Array(decoded.length)
    for (let index = 0; index < decoded.length; index++) {
      bytes[index] = decoded.charCodeAt(index)
    }
    saveBlob(new Blob([bytes], { type: file.type }), file.name)
    return
  }

  const hasStorageKey = Boolean(file.key && !file.key.startsWith('url/'))
  const url = hasStorageKey
    ? `/api/files/serve/${encodeURIComponent(file.key)}?context=${encodeURIComponent(file.context || 'execution')}`
    : isSafeHttpUrl(file.url)
      ? file.url
      : null
  if (!url) throw new Error('File has no download URL')

  /** The same serve route as execution logs resolves current storage access on each click. */
  // boundary-raw-fetch: binary file download, including externally hosted file URLs
  let response = await fetch(url, { cache: 'no-store' })
  if (hasStorageKey && response.status === 401 && isSafeHttpUrl(file.url)) {
    /** Public chat visitors may only have the file access already delivered in the response. */
    response = await fetch(file.url, { cache: 'no-store' })
  }
  if (!response.ok) {
    throw new Error('Unable to download this file. Please try again or request a new copy.')
  }

  saveBlob(await response.blob(), file.name)
}

export function ChatFileDownload({ file }: ChatFileDownloadProps) {
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadFailed, setDownloadFailed] = useState(false)
  const [failedPreviewUrl, setFailedPreviewUrl] = useState<string | null>(null)
  const fileUrl = getFileUrl(file)

  const handleDownload = async () => {
    if (isDownloading) return

    setIsDownloading(true)
    setDownloadFailed(false)

    try {
      logger.info(`Initiating download for file: ${file.name}`)
      await triggerDownload(file)
    } catch (error) {
      logger.error(`Failed to download file ${file.name}:`, error)
      setDownloadFailed(true)
    } finally {
      setIsDownloading(false)
    }
  }

  const renderIcon = () => {
    if (isAudioFile(file.type, file.name)) {
      return <Music className='size-4 text-purple-500' />
    }
    if (isImageFile(file.type)) {
      const ImageIcon = DefaultFileIcon
      return <ImageIcon className='size-5' />
    }
    const DocumentIcon = getDocumentIcon(file.type, file.name)
    return <DocumentIcon className='size-5' />
  }

  return (
    <div className='flex max-w-full flex-col items-start gap-2'>
      {isImageFile(file.type) && failedPreviewUrl !== fileUrl && (
        <img
          src={fileUrl}
          alt={file.name}
          loading='lazy'
          className='-outline-offset-1 max-h-[480px] max-w-full rounded-lg object-contain outline outline-1 outline-black/10 dark:outline-white/10'
          onError={() => setFailedPreviewUrl(fileUrl)}
        />
      )}
      <Button
        variant='default'
        onClick={handleDownload}
        disabled={isDownloading}
        className='group flex h-auto w-[200px] items-center gap-2 rounded-lg px-3 py-2'
      >
        <div className='flex size-8 shrink-0 items-center justify-center'>{renderIcon()}</div>
        <div className='min-w-0 flex-1 text-left'>
          <div className='w-[100px] truncate text-xs'>{file.name}</div>
          <div className='text-[var(--text-muted)] text-micro'>{formatFileSize(file.size)}</div>
        </div>
        <div className='shrink-0'>
          {isDownloading ? (
            <Loader className='size-3.5' animate />
          ) : (
            <Download className='size-3.5 opacity-0 transition-opacity group-hover:opacity-100' />
          )}
        </div>
      </Button>
      {downloadFailed && (
        <p role='alert' className='text-[var(--text-error)] text-xs'>
          Unable to download this file. Please try again or request a new copy.
        </p>
      )}
    </div>
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
          await triggerDownload(file)
          logger.info(`Downloaded file ${i + 1}/${files.length}: ${file.name}`)

          if (i < files.length - 1) {
            await sleep(150)
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
    <Button
      variant='ghost-secondary'
      onClick={handleDownloadAll}
      disabled={isDownloading}
      className='p-0'
    >
      {isDownloading ? (
        <Loader className='size-3' animate />
      ) : (
        <Download className='size-3' strokeWidth={2} />
      )}
    </Button>
  )
}
