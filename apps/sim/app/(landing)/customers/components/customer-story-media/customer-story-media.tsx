import Image from 'next/image'
import type { CustomerStory } from '@/lib/customers/data'

interface CustomerStoryMediaProps {
  story: CustomerStory
  priority?: boolean
  playable?: boolean
}

/** Customer artwork, with on-demand playback on story detail pages. */
export function CustomerStoryMedia({
  story,
  priority = false,
  playable = false,
}: CustomerStoryMediaProps) {
  return (
    <div
      data-customer-story-media={story.slug}
      className='relative aspect-[16/9] w-full overflow-hidden rounded-[12px] bg-[var(--surface-4)]'
    >
      {playable && story.heroVideo ? (
        <video
          aria-label={story.heroVideo.label}
          controls
          muted
          playsInline
          preload='none'
          poster={story.heroVideo.poster}
          src={story.heroVideo.src}
          className='absolute inset-0 size-full rounded-[inherit] bg-black object-cover'
        />
      ) : story.heroImage ? (
        <Image
          src={story.heroImage}
          alt={story.heroAlt}
          fill
          sizes='(max-width: 1023px) calc(100vw - 64px), (max-width: 1728px) 78vw, 1374px'
          preload={priority}
          quality={90}
          className='object-cover'
        />
      ) : (
        <div className='absolute inset-0 flex items-center justify-center p-12'>
          <Image
            src={story.logo.src}
            alt={story.logo.alt}
            width={320}
            height={175}
            className='h-auto w-[30%] min-w-[100px] max-w-[320px] brightness-0 dark:invert'
          />
        </div>
      )}
      <div
        aria-hidden='true'
        className='pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-black/10 ring-inset dark:ring-white/10'
      />
    </div>
  )
}
