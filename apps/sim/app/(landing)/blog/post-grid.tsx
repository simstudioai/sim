import Image from 'next/image'
import Link from 'next/link'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/emcn'

interface Author {
  id: string
  name: string
  avatarUrl?: string
  url?: string
}

interface Post {
  slug: string
  title: string
  description: string
  date: string
  ogImage: string
  author: Author
  authors?: Author[]
  featured?: boolean
}

export function PostGrid({ posts }: { posts: Post[] }) {
  return (
    <div className='grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6 lg:grid-cols-3'>
      {posts.map((p, index) => (
        <Link key={p.slug} href={`/blog/${p.slug}`} className='group flex flex-col'>
          <div className='flex h-full flex-col overflow-hidden rounded-xl border border-[#2A2A2A] transition-colors duration-300 hover:border-[#3d3d3d]'>
            {/* Image container with fixed aspect ratio to prevent layout shift */}
            <div className='relative aspect-video w-full overflow-hidden'>
              <Image
                src={p.ogImage}
                alt={p.title}
                sizes='(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw'
                priority={index < 6}
                loading={index < 6 ? undefined : 'lazy'}
                fill
                style={{ objectFit: 'cover' }}
              />
            </div>
            <div className='flex flex-1 flex-col p-4'>
              <div className='mb-2 text-[#999] text-xs'>
                {new Date(p.date).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </div>
              <h3 className='mb-1 font-[500] text-[#ECECEC] text-lg leading-tight'>{p.title}</h3>
              <p className='mb-3 line-clamp-3 flex-1 text-[#999] text-sm'>{p.description}</p>
              <div className='flex items-center gap-2'>
                <div className='-space-x-1.5 flex'>
                  {(p.authors && p.authors.length > 0 ? p.authors : [p.author])
                    .slice(0, 3)
                    .map((author, idx) => (
                      <Avatar key={idx} className='size-4 border border-[#1C1C1C]'>
                        <AvatarImage src={author?.avatarUrl} alt={author?.name} />
                        <AvatarFallback className='border border-[#1C1C1C] bg-[#2A2A2A] text-[#999] text-[10px]'>
                          {author?.name.slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                    ))}
                </div>
                <span className='text-[#999] text-xs'>
                  {(p.authors && p.authors.length > 0 ? p.authors : [p.author])
                    .slice(0, 2)
                    .map((a) => a?.name)
                    .join(', ')}
                  {(p.authors && p.authors.length > 0 ? p.authors : [p.author]).length > 2 && (
                    <>
                      {' '}
                      and {(p.authors && p.authors.length > 0 ? p.authors : [p.author]).length - 2}{' '}
                      other
                      {(p.authors && p.authors.length > 0 ? p.authors : [p.author]).length - 2 > 1
                        ? 's'
                        : ''}
                    </>
                  )}
                </span>
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  )
}
