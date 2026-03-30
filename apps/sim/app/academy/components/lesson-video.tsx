'use client'

interface LessonVideoProps {
  url: string
  title: string
}

export function LessonVideo({ url, title }: LessonVideoProps) {
  const embedUrl = resolveEmbedUrl(url)

  if (!embedUrl) {
    return (
      <div className='flex aspect-video items-center justify-center rounded-lg bg-[#1A1A1A] text-[#666] text-sm'>
        Video unavailable
      </div>
    )
  }

  return (
    <div className='aspect-video w-full overflow-hidden rounded-lg bg-black'>
      <iframe
        src={embedUrl}
        title={title}
        allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
        allowFullScreen
        className='h-full w-full border-0'
      />
    </div>
  )
}

function resolveEmbedUrl(url: string): string | null {
  try {
    const parsed = new URL(url)

    if (parsed.hostname === 'youtu.be') {
      return `https://www.youtube.com/embed${parsed.pathname}`
    }
    if (parsed.hostname.includes('youtube.com')) {
      // Shorts: youtube.com/shorts/VIDEO_ID
      const shortsMatch = parsed.pathname.match(/^\/shorts\/([^/?]+)/)
      if (shortsMatch) return `https://www.youtube.com/embed/${shortsMatch[1]}`
      const v = parsed.searchParams.get('v')
      if (v) return `https://www.youtube.com/embed/${v}`
    }

    if (parsed.hostname === 'vimeo.com') {
      const id = parsed.pathname.replace(/^\//, '')
      if (id) return `https://player.vimeo.com/video/${id}`
    }

    return null
  } catch (_e: unknown) {
    return null
  }
}
