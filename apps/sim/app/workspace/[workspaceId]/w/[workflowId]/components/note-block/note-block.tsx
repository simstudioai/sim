import { memo, useCallback, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import type { NodeProps } from 'reactflow'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/core/utils/cn'
import { BLOCK_DIMENSIONS } from '@/lib/workflows/blocks/block-dimensions'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ActionBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/action-bar/action-bar'
import { useBlockVisual } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { useBlockDimensions } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-block-dimensions'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import type { WorkflowBlockProps } from '../workflow-block/types'

interface NoteBlockNodeData extends WorkflowBlockProps {}

/**
 * Extract string value from subblock value object or primitive
 */
function extractFieldValue(rawValue: unknown): string | undefined {
  if (typeof rawValue === 'string') return rawValue
  if (rawValue && typeof rawValue === 'object' && 'value' in rawValue) {
    const candidate = (rawValue as { value?: unknown }).value
    return typeof candidate === 'string' ? candidate : undefined
  }
  return undefined
}

type EmbedInfo = {
  url: string
  type: 'iframe' | 'video' | 'audio'
  aspectRatio?: string
}

const EMBED_SCALE = 0.78
const EMBED_INVERSE_SCALE = `${(1 / EMBED_SCALE) * 100}%`

function getTwitchParent(): string {
  return typeof window !== 'undefined' ? window.location.hostname : 'localhost'
}

/**
 * Get embed info for supported media platforms
 */
function getEmbedInfo(url: string): EmbedInfo | null {
  const youtubeMatch = url.match(
    /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/
  )
  if (youtubeMatch) {
    return { url: `https://www.youtube.com/embed/${youtubeMatch[1]}`, type: 'iframe' }
  }

  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/)
  if (vimeoMatch) {
    return { url: `https://player.vimeo.com/video/${vimeoMatch[1]}`, type: 'iframe' }
  }

  const dailymotionMatch = url.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/)
  if (dailymotionMatch) {
    return { url: `https://www.dailymotion.com/embed/video/${dailymotionMatch[1]}`, type: 'iframe' }
  }

  const twitchVideoMatch = url.match(/twitch\.tv\/videos\/(\d+)/)
  if (twitchVideoMatch) {
    return {
      url: `https://player.twitch.tv/?video=${twitchVideoMatch[1]}&parent=${getTwitchParent()}`,
      type: 'iframe',
    }
  }

  const twitchChannelMatch = url.match(/twitch\.tv\/([a-zA-Z0-9_]+)(?:\/|$)/)
  if (twitchChannelMatch && !url.includes('/videos/') && !url.includes('/clip/')) {
    return {
      url: `https://player.twitch.tv/?channel=${twitchChannelMatch[1]}&parent=${getTwitchParent()}`,
      type: 'iframe',
    }
  }

  const streamableMatch = url.match(/streamable\.com\/([a-zA-Z0-9]+)/)
  if (streamableMatch) {
    return { url: `https://streamable.com/e/${streamableMatch[1]}`, type: 'iframe' }
  }

  const wistiaMatch = url.match(/(?:wistia\.com|wistia\.net)\/(?:medias|embed)\/([a-zA-Z0-9]+)/)
  if (wistiaMatch) {
    return { url: `https://fast.wistia.net/embed/iframe/${wistiaMatch[1]}`, type: 'iframe' }
  }

  const tiktokMatch = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/)
  if (tiktokMatch) {
    return {
      url: `https://www.tiktok.com/embed/v2/${tiktokMatch[1]}`,
      type: 'iframe',
      aspectRatio: '9/16',
    }
  }

  const soundcloudMatch = url.match(/soundcloud\.com\/([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)/)
  if (soundcloudMatch) {
    return {
      url: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23ff5500&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false`,
      type: 'iframe',
      aspectRatio: '3/2',
    }
  }

  const spotifyTrackMatch = url.match(/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/)
  if (spotifyTrackMatch) {
    return {
      url: `https://open.spotify.com/embed/track/${spotifyTrackMatch[1]}`,
      type: 'iframe',
      aspectRatio: '3.7/1',
    }
  }

  const spotifyAlbumMatch = url.match(/open\.spotify\.com\/album\/([a-zA-Z0-9]+)/)
  if (spotifyAlbumMatch) {
    return {
      url: `https://open.spotify.com/embed/album/${spotifyAlbumMatch[1]}`,
      type: 'iframe',
      aspectRatio: '2/3',
    }
  }

  const spotifyPlaylistMatch = url.match(/open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/)
  if (spotifyPlaylistMatch) {
    return {
      url: `https://open.spotify.com/embed/playlist/${spotifyPlaylistMatch[1]}`,
      type: 'iframe',
      aspectRatio: '2/3',
    }
  }

  const spotifyEpisodeMatch = url.match(/open\.spotify\.com\/episode\/([a-zA-Z0-9]+)/)
  if (spotifyEpisodeMatch) {
    return {
      url: `https://open.spotify.com/embed/episode/${spotifyEpisodeMatch[1]}`,
      type: 'iframe',
      aspectRatio: '2.5/1',
    }
  }

  const spotifyShowMatch = url.match(/open\.spotify\.com\/show\/([a-zA-Z0-9]+)/)
  if (spotifyShowMatch) {
    return {
      url: `https://open.spotify.com/embed/show/${spotifyShowMatch[1]}`,
      type: 'iframe',
      aspectRatio: '3.7/1',
    }
  }

  const appleMusicSongMatch = url.match(/music\.apple\.com\/([a-z]{2})\/song\/[^/]+\/(\d+)/)
  if (appleMusicSongMatch) {
    const [, country, songId] = appleMusicSongMatch
    return {
      url: `https://embed.music.apple.com/${country}/song/${songId}`,
      type: 'iframe',
      aspectRatio: '3/2',
    }
  }

  const appleMusicAlbumMatch = url.match(/music\.apple\.com\/([a-z]{2})\/album\/(?:[^/]+\/)?(\d+)/)
  if (appleMusicAlbumMatch) {
    const [, country, albumId] = appleMusicAlbumMatch
    return {
      url: `https://embed.music.apple.com/${country}/album/${albumId}`,
      type: 'iframe',
      aspectRatio: '2/3',
    }
  }

  const appleMusicPlaylistMatch = url.match(
    /music\.apple\.com\/([a-z]{2})\/playlist\/[^/]+\/(pl\.[a-zA-Z0-9]+)/
  )
  if (appleMusicPlaylistMatch) {
    const [, country, playlistId] = appleMusicPlaylistMatch
    return {
      url: `https://embed.music.apple.com/${country}/playlist/${playlistId}`,
      type: 'iframe',
      aspectRatio: '2/3',
    }
  }

  const loomMatch = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/)
  if (loomMatch) {
    return { url: `https://www.loom.com/embed/${loomMatch[1]}`, type: 'iframe' }
  }

  const facebookVideoMatch =
    url.match(/facebook\.com\/.*\/videos\/(\d+)/) || url.match(/fb\.watch\/([a-zA-Z0-9_-]+)/)
  if (facebookVideoMatch) {
    return {
      url: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false`,
      type: 'iframe',
    }
  }

  const instagramReelMatch = url.match(/instagram\.com\/reel\/([a-zA-Z0-9_-]+)/)
  if (instagramReelMatch) {
    return {
      url: `https://www.instagram.com/reel/${instagramReelMatch[1]}/embed`,
      type: 'iframe',
      aspectRatio: '9/16',
    }
  }

  const instagramPostMatch = url.match(/instagram\.com\/p\/([a-zA-Z0-9_-]+)/)
  if (instagramPostMatch) {
    return {
      url: `https://www.instagram.com/p/${instagramPostMatch[1]}/embed`,
      type: 'iframe',
      aspectRatio: '4/5',
    }
  }

  const twitterMatch = url.match(/(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/)
  if (twitterMatch) {
    return {
      url: `https://platform.twitter.com/embed/Tweet.html?id=${twitterMatch[1]}`,
      type: 'iframe',
      aspectRatio: '3/4',
    }
  }

  const rumbleMatch =
    url.match(/rumble\.com\/embed\/([a-zA-Z0-9]+)/) || url.match(/rumble\.com\/([a-zA-Z0-9]+)-/)
  if (rumbleMatch) {
    return { url: `https://rumble.com/embed/${rumbleMatch[1]}/`, type: 'iframe' }
  }

  const bilibiliMatch = url.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/)
  if (bilibiliMatch) {
    return {
      url: `https://player.bilibili.com/player.html?bvid=${bilibiliMatch[1]}&high_quality=1`,
      type: 'iframe',
    }
  }

  const vidyardMatch = url.match(/(?:vidyard\.com|share\.vidyard\.com)\/watch\/([a-zA-Z0-9]+)/)
  if (vidyardMatch) {
    return { url: `https://play.vidyard.com/${vidyardMatch[1]}`, type: 'iframe' }
  }

  const cfStreamMatch =
    url.match(/cloudflarestream\.com\/([a-zA-Z0-9]+)/) ||
    url.match(/videodelivery\.net\/([a-zA-Z0-9]+)/)
  if (cfStreamMatch) {
    return { url: `https://iframe.cloudflarestream.com/${cfStreamMatch[1]}`, type: 'iframe' }
  }

  const twitchClipMatch =
    url.match(/clips\.twitch\.tv\/([a-zA-Z0-9_-]+)/) ||
    url.match(/twitch\.tv\/[^/]+\/clip\/([a-zA-Z0-9_-]+)/)
  if (twitchClipMatch) {
    return {
      url: `https://clips.twitch.tv/embed?clip=${twitchClipMatch[1]}&parent=${getTwitchParent()}`,
      type: 'iframe',
    }
  }

  const mixcloudMatch = url.match(/mixcloud\.com\/([^/]+\/[^/]+)/)
  if (mixcloudMatch) {
    return {
      url: `https://www.mixcloud.com/widget/iframe/?feed=%2F${encodeURIComponent(mixcloudMatch[1])}%2F&hide_cover=1`,
      type: 'iframe',
      aspectRatio: '2/1',
    }
  }

  const googleDriveMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/)
  if (googleDriveMatch) {
    return { url: `https://drive.google.com/file/d/${googleDriveMatch[1]}/preview`, type: 'iframe' }
  }

  if (url.includes('dropbox.com') && /\.(mp4|mov|webm)/.test(url)) {
    const directUrl = url
      .replace('www.dropbox.com', 'dl.dropboxusercontent.com')
      .replace('?dl=0', '')
    return { url: directUrl, type: 'video' }
  }

  const tenorMatch = url.match(/tenor\.com\/view\/[^/]+-(\d+)/)
  if (tenorMatch) {
    return { url: `https://tenor.com/embed/${tenorMatch[1]}`, type: 'iframe', aspectRatio: '1/1' }
  }

  const giphyMatch = url.match(/giphy\.com\/(?:gifs|embed)\/(?:.*-)?([a-zA-Z0-9]+)/)
  if (giphyMatch) {
    return { url: `https://giphy.com/embed/${giphyMatch[1]}`, type: 'iframe', aspectRatio: '1/1' }
  }

  if (/\.(mp4|webm|ogg|mov)(\?|$)/i.test(url)) {
    return { url, type: 'video' }
  }

  if (/\.(mp3|wav|m4a|aac)(\?|$)/i.test(url)) {
    return { url, type: 'audio' }
  }

  return null
}

/**
 * Compact markdown renderer for note blocks with tight spacing
 */
const NoteMarkdown = memo(function NoteMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={{
        p: ({ children }: any) => (
          <p className='mb-1 break-words text-[var(--text-primary)] text-sm leading-[1.25rem] last:mb-0'>
            {children}
          </p>
        ),
        h1: ({ children }: any) => (
          <h1 className='mt-3 mb-3 break-words font-semibold text-[var(--text-primary)] text-lg first:mt-0'>
            {children}
          </h1>
        ),
        h2: ({ children }: any) => (
          <h2 className='mt-2.5 mb-2.5 break-words font-semibold text-[var(--text-primary)] text-base first:mt-0'>
            {children}
          </h2>
        ),
        h3: ({ children }: any) => (
          <h3 className='mt-2 mb-2 break-words font-semibold text-[var(--text-primary)] text-sm first:mt-0'>
            {children}
          </h3>
        ),
        h4: ({ children }: any) => (
          <h4 className='mt-2 mb-2 break-words font-semibold text-[var(--text-primary)] text-xs first:mt-0'>
            {children}
          </h4>
        ),
        ul: ({ children }: any) => (
          <ul className='mt-1 mb-1 list-disc space-y-1 break-words pl-6 text-[var(--text-primary)] text-sm'>
            {children}
          </ul>
        ),
        ol: ({ children }: any) => (
          <ol className='mt-1 mb-1 list-decimal space-y-1 break-words pl-6 text-[var(--text-primary)] text-sm'>
            {children}
          </ol>
        ),
        li: ({ children }: any) => <li className='break-words'>{children}</li>,
        code: ({ inline, className, children, ...props }: any) => {
          const isInline = inline || !className?.includes('language-')

          if (isInline) {
            return (
              <code
                {...props}
                className='whitespace-normal rounded bg-[var(--surface-5)] px-1 py-0.5 font-mono text-[#F59E0B] text-xs'
              >
                {children}
              </code>
            )
          }

          return (
            <code
              {...props}
              className='block whitespace-pre-wrap break-words rounded bg-[var(--surface-5)] p-2 text-[var(--text-primary)] text-xs'
            >
              {children}
            </code>
          )
        },
        a: ({ href, children }: any) => {
          const embedInfo = href ? getEmbedInfo(href) : null
          if (embedInfo) {
            return (
              <span className='my-2 block w-full'>
                <a
                  href={href}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='mb-1 block break-all text-[var(--brand-secondary)] underline-offset-2 hover:underline'
                >
                  {children}
                </a>
                <span className='block w-full overflow-hidden rounded-md'>
                  {embedInfo.type === 'iframe' && (
                    <span
                      className='block overflow-hidden'
                      style={{
                        width: '100%',
                        aspectRatio: embedInfo.aspectRatio || '16/9',
                      }}
                    >
                      <iframe
                        src={embedInfo.url}
                        title='Media'
                        allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
                        allowFullScreen
                        loading='lazy'
                        className='origin-top-left'
                        style={{
                          width: EMBED_INVERSE_SCALE,
                          height: EMBED_INVERSE_SCALE,
                          transform: `scale(${EMBED_SCALE})`,
                        }}
                      />
                    </span>
                  )}
                  {embedInfo.type === 'video' && (
                    <video
                      src={embedInfo.url}
                      controls
                      preload='metadata'
                      className='aspect-video w-full'
                    >
                      <track kind='captions' src='' default />
                    </video>
                  )}
                  {embedInfo.type === 'audio' && (
                    <audio src={embedInfo.url} controls preload='metadata' className='w-full'>
                      <track kind='captions' src='' default />
                    </audio>
                  )}
                </span>
              </span>
            )
          }
          return (
            <a
              href={href}
              target='_blank'
              rel='noopener noreferrer'
              className='break-all text-[var(--brand-secondary)] underline-offset-2 hover:underline'
            >
              {children}
            </a>
          )
        },
        strong: ({ children }: any) => (
          <strong className='break-words font-semibold text-[var(--text-primary)]'>
            {children}
          </strong>
        ),
        em: ({ children }: any) => (
          <em className='break-words text-[var(--text-tertiary)]'>{children}</em>
        ),
        blockquote: ({ children }: any) => (
          <blockquote className='my-4 break-words border-[var(--border-1)] border-l-4 py-1 pl-4 text-[var(--text-tertiary)] italic'>
            {children}
          </blockquote>
        ),
        table: ({ children }: any) => (
          <div className='my-2 max-w-full overflow-x-auto'>
            <table className='w-full border-collapse text-xs'>{children}</table>
          </div>
        ),
        thead: ({ children }: any) => (
          <thead className='border-[var(--border)] border-b'>{children}</thead>
        ),
        tbody: ({ children }: any) => <tbody>{children}</tbody>,
        tr: ({ children }: any) => (
          <tr className='border-[var(--border)] border-b last:border-b-0'>{children}</tr>
        ),
        th: ({ children }: any) => (
          <th className='px-2 py-1 text-left font-semibold text-[var(--text-primary)]'>
            {children}
          </th>
        ),
        td: ({ children }: any) => (
          <td className='px-2 py-1 text-[var(--text-secondary)]'>{children}</td>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  )
})

export const NoteBlock = memo(function NoteBlock({
  id,
  data,
  selected,
}: NodeProps<NoteBlockNodeData>) {
  const { type, name } = data

  const { activeWorkflowId, isEnabled, handleClick, hasRing, ringStyles } = useBlockVisual({
    blockId: id,
    data,
    isSelected: selected,
  })
  const storedValues = useSubBlockStore(
    useCallback(
      (state) => {
        if (!activeWorkflowId) return undefined
        return state.workflowValues[activeWorkflowId]?.[id]
      },
      [activeWorkflowId, id]
    )
  )

  const content = useMemo(() => {
    if (data.isPreview && data.subBlockValues) {
      const extractedContent = extractFieldValue(data.subBlockValues.content)
      return typeof extractedContent === 'string' ? extractedContent : ''
    }
    const storedContent = extractFieldValue(storedValues?.content)
    return typeof storedContent === 'string' ? storedContent : ''
  }, [data.isPreview, data.subBlockValues, storedValues])

  const isEmpty = content.trim().length === 0

  const userPermissions = useUserPermissionsContext()

  /**
   * Calculate deterministic dimensions based on content structure.
   * Uses fixed width and computed height to avoid ResizeObserver jitter.
   */
  useBlockDimensions({
    blockId: id,
    calculateDimensions: () => {
      const contentHeight = isEmpty
        ? BLOCK_DIMENSIONS.NOTE_MIN_CONTENT_HEIGHT
        : BLOCK_DIMENSIONS.NOTE_BASE_CONTENT_HEIGHT
      const calculatedHeight =
        BLOCK_DIMENSIONS.HEADER_HEIGHT + BLOCK_DIMENSIONS.NOTE_CONTENT_PADDING + contentHeight

      return { width: BLOCK_DIMENSIONS.FIXED_WIDTH, height: calculatedHeight }
    },
    dependencies: [isEmpty],
  })

  return (
    <div className='group relative'>
      <div
        className={cn(
          'note-drag-handle relative z-[20] w-[250px] cursor-grab select-none rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] [&:active]:cursor-grabbing'
        )}
        onClick={handleClick}
      >
        <ActionBar blockId={id} blockType={type} disabled={!userPermissions.canEdit} />

        <div className='flex items-center justify-between border-[var(--divider)] border-b p-[8px]'>
          <div className='flex min-w-0 flex-1 items-center'>
            <span
              className={cn(
                'truncate font-medium text-[16px]',
                !isEnabled && 'text-[var(--text-muted)]'
              )}
              title={name}
            >
              {name}
            </span>
          </div>
        </div>

        <div className='relative overflow-hidden p-[8px]'>
          <div className='relative max-w-full break-all'>
            {isEmpty ? (
              <p className='text-[#868686] text-sm'>Add note...</p>
            ) : (
              <NoteMarkdown content={content} />
            )}
          </div>
        </div>
        {hasRing && (
          <div
            className={cn('pointer-events-none absolute inset-0 z-40 rounded-[8px]', ringStyles)}
          />
        )}
      </div>
    </div>
  )
})
