'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@sim/emcn/icon'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/media-preview.module.css'
import {
  PreviewError,
  resolvePreviewError,
  UnsupportedPreview,
} from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/preview-shared'
import {
  resolveMediaMimeType,
  useFileContentSource,
  useReresolveFileRecord,
  useWorkspaceFileBinary,
  type WorkspaceFileRecord,
} from '@/platform/lib/data/files'

type MediaKind = 'audio' | 'video'

interface MediaPreviewProps {
  file: WorkspaceFileRecord
  workspaceId: string
  kind: MediaKind
  onDownload?: () => void
}

/**
 * Audio and video in the browser's own player. Where the content source answers byte ranges the
 * player streams from its URL, so playback and seeking start at once at any size; elsewhere the
 * file is fetched whole into a blob first.
 */
export function MediaPreview({ file, workspaceId, kind, onDownload }: MediaPreviewProps) {
  const source = useFileContentSource()
  if (!source.servesByteRanges)
    return <BufferedMediaPreview file={file} workspaceId={workspaceId} kind={kind} />
  /** The version lets the browser cache the bytes across visits; a content write moves the key. */
  const src = source.buildUrl(file.key, { version: Number(new Date(file.updatedAt)) || file.size })
  return (
    <StreamedMediaPlayer
      key={src}
      src={src}
      file={file}
      workspaceId={workspaceId}
      kind={kind}
      onDownload={onDownload}
    />
  )
}

interface StreamedMediaPlayerProps extends MediaPreviewProps {
  src: string
}

function StreamedMediaPlayer({
  src,
  file,
  workspaceId,
  kind,
  onDownload,
}: StreamedMediaPlayerProps) {
  const [status, setStatus] = useState<'playable' | 'unplayable' | 'unavailable'>('playable')
  const reresolveRecord = useReresolveFileRecord(workspaceId, file.id)
  const diagnosing = useRef(false)

  /**
   * A media element says only that it failed, so the URL is asked for its first byte. A 404 means
   * the key was replaced: the record is re-resolved and a moved key re-renders this at the new URL.
   * Bytes that are there but do not play are the browser's format support.
   */
  const handleError = useCallback(async () => {
    if (diagnosing.current) return
    diagnosing.current = true
    // boundary-raw-fetch: ranged probe of the binary serve path, which has no contract
    const probe = await fetch(src, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' }).catch(
      () => null
    )
    await probe?.body?.cancel()
    if (probe?.status === 404) await reresolveRecord()
    setStatus(probe?.ok ? 'unplayable' : 'unavailable')
  }, [src, reresolveRecord])

  /** A small file can fail before hydration attaches listeners; read the element's own state. */
  const syncWithElement = useCallback(
    (media: HTMLMediaElement | null) => {
      if (media?.error) void handleError()
    },
    [handleError]
  )

  if (status === 'unplayable')
    return (
      <UnsupportedPreview
        name={file.name}
        reason={`This ${kind} can't be played in your browser. Download it to play it.`}
        onDownload={onDownload}
      />
    )
  if (status === 'unavailable')
    return <PreviewError label={kind} error='Failed to fetch file content' />
  return (
    <MediaPlayer
      file={file}
      kind={kind}
      src={src}
      mediaRef={syncWithElement}
      onError={handleError}
    />
  )
}

/** The whole file as a blob, for a content source that sends only whole bodies. */
function BufferedMediaPreview({ file, workspaceId, kind }: MediaPreviewProps) {
  const { data, error } = useWorkspaceFileBinary(workspaceId, file.id, file.key)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const mediaType = resolveMediaMimeType(file.type, file.name, kind)
  useEffect(() => {
    if (!data) return
    const url = URL.createObjectURL(new Blob([data], { type: mediaType }))
    setBlobUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [data, mediaType])
  const failure = blobUrl ? null : resolvePreviewError(error, null)
  if (failure) return <PreviewError label={kind} error={failure} />
  if (!blobUrl) return null
  return <MediaPlayer file={file} kind={kind} src={blobUrl} />
}

interface MediaPlayerProps {
  file: WorkspaceFileRecord
  kind: MediaKind
  src: string
  mediaRef?: (media: HTMLMediaElement | null) => void
  onError?: () => void
}

function MediaPlayer({ file, kind, src, mediaRef, onError }: MediaPlayerProps) {
  if (kind === 'audio')
    return (
      <div className={styles.stage}>
        <div className={styles.audio}>
          <Icon name='I015' />
          <span className={styles.name} data-type='T060'>
            {file.name}
          </span>
          {/* biome-ignore lint/a11y/useMediaCaption: audio from workspace files has no captions */}
          <audio
            ref={mediaRef}
            src={src}
            controls
            className={styles.audioPlayer}
            onError={onError}
          />
        </div>
      </div>
    )
  return (
    <div className={styles.stage}>
      {/* biome-ignore lint/a11y/useMediaCaption: video from workspace files has no captions */}
      <video ref={mediaRef} src={src} controls className={styles.video} onError={onError} />
    </div>
  )
}
