'use client'

import { FileViewer } from '@/components/file-viewer/file-viewer'
import type { FileStream } from '@/app/(product)/_components/chat/model'
import styles from '@/app/(product)/_components/chat/panel/workspace-resource/workspace-resource.module.css'

interface StreamingFileProps {
  file: NonNullable<FileStream['unsaved']>
  stream: FileStream
}

/** A file the agent is still creating, read-only in its preview as the text arrives. */
export function StreamingFile({ file, stream }: StreamingFileProps) {
  return (
    <div className={styles.resource}>
      <FileViewer
        file={file}
        workspaceId={file.workspaceId}
        canEdit={false}
        previewMode='preview'
        streamingContent={stream.streamingContent}
        isAgentEditing={stream.isAgentEditing}
        streamIsIncremental={stream.streamIsIncremental}
        streamOperation={stream.streamOperation}
        disableStreamingAutoScroll={stream.disableStreamingAutoScroll}
        previewContextKey={stream.previewContextKey}
      />
    </div>
  )
}
