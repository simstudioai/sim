'use client'

import { motion, useReducedMotion } from 'framer-motion'
import Image from 'next/image'
import Link from 'next/link'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/emcn'
import { getPrimaryCategory } from '@/app/(landing)/blog/tag-colors'

const EASE_OUT_QUINT = [0.23, 1, 0.32, 1] as const
const CARD_STAGGER = 0.08
const CARD_DURATION = 0.35
const CARD_Y = 16
const LEAD_Y = 20

const gridVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: CARD_STAGGER } },
}

const cardVariants = {
  hidden: { opacity: 0, y: CARD_Y },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: CARD_DURATION, ease: EASE_OUT_QUINT },
  },
}

const leadVariants = {
  hidden: { opacity: 0, y: LEAD_Y },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: CARD_DURATION + 0.05, ease: EASE_OUT_QUINT },
  },
}

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
  readingTime?: number
  tags: string[]
  author: Author
  authors?: Author[]
  featured?: boolean
}

interface PostGridProps {
  posts: Post[]
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function PostCard({ post, priority = false }: { post: Post; priority?: boolean }) {
  const category = getPrimaryCategory(post.tags)
  const color = category.color
  const authors = post.authors && post.authors.length > 0 ? post.authors : [post.author]

  return (
    <motion.div variants={cardVariants} className='h-full'>
      <Link href={`/studio/${post.slug}`} className='group flex h-full flex-col'>
        <article className='flex h-full flex-col overflow-hidden border border-[#2A2A2A] bg-[#232323] transition-[border-color] duration-200 hover:border-[#3d3d3d] active:scale-[0.99]'>
          <div className='relative aspect-video w-full overflow-hidden bg-[#1C1C1C]'>
            <Image
              src={post.ogImage}
              alt={post.title}
              sizes='(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw'
              unoptimized
              priority={priority}
              loading={priority ? undefined : 'lazy'}
              fill
              className='object-cover opacity-90 transition-[transform,opacity] duration-200 [@media(hover:hover)]:group-hover:scale-[1.02] [@media(hover:hover)]:group-hover:opacity-100'
            />
          </div>
          <div className='flex flex-1 flex-col p-6'>
            <div className='mb-3 flex items-center gap-3'>
              <span
                className='inline-block px-2 py-0.5 font-season text-[10px] font-bold uppercase tracking-wider text-black'
                style={{ backgroundColor: color }}
              >
                {category.label}
              </span>
              {post.readingTime && (
                <span className='font-season text-[10px] uppercase text-[#666]'>
                  {post.readingTime} min read
                </span>
              )}
            </div>
            <h3 className='mb-3 line-clamp-2 font-[500] text-[20px] leading-tight tracking-[-0.01em] text-[#ECECEC] transition-colors duration-150 [@media(hover:hover)]:group-hover:text-[#00F701]'>
              {post.title}
            </h3>
            <p className='mb-6 line-clamp-2 text-[14px] leading-relaxed text-[#999]'>
              {post.description}
            </p>
            <div className='mt-auto flex items-center gap-3 border-t border-[#2A2A2A] pt-4 font-season text-[10px] uppercase text-[#666]'>
              <div className='flex items-center gap-2'>
                <div className='flex -space-x-1.5'>
                  {authors.slice(0, 2).map((a, idx) => (
                    <Avatar key={idx} className='size-5 border border-[#1C1C1C]'>
                      <AvatarImage src={a?.avatarUrl} alt={a?.name} />
                      <AvatarFallback className='bg-[#2A2A2A] font-season text-[8px] text-[#999]'>
                        {a?.name.slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                </div>
                <span className='text-[#999]'>
                  {authors
                    .slice(0, 2)
                    .map((a) => a?.name)
                    .join(', ')}
                </span>
              </div>
              <span className='h-1 w-1 bg-[#3d3d3d]' aria-hidden='true' />
              <time dateTime={post.date}>{formatDate(post.date)}</time>
            </div>
          </div>
        </article>
      </Link>
    </motion.div>
  )
}

function FeaturedLeadCard({ post }: { post: Post }) {
  const category = getPrimaryCategory(post.tags)
  const color = category.color
  const authors = post.authors && post.authors.length > 0 ? post.authors : [post.author]

  return (
    <motion.div variants={leadVariants} className='col-span-full'>
      <Link
        href={`/studio/${post.slug}`}
        className='group relative flex min-h-[400px] flex-col justify-end overflow-hidden border border-[#2A2A2A] bg-[#232323] transition-[border-color] duration-200 [@media(hover:hover)]:hover:border-[#00F701]'
      >
        <div className='absolute inset-0'>
          <Image
            src={post.ogImage}
            alt={post.title}
            fill
            sizes='(max-width: 1200px) 100vw, 900px'
            className='object-cover opacity-40 transition-opacity duration-300 [@media(hover:hover)]:group-hover:opacity-50'
            unoptimized
            priority
          />
        </div>
        <div className='absolute inset-0 bg-gradient-to-t from-[#232323] via-[#232323]/80 to-transparent' />
        <div className='relative z-10 flex h-full flex-col justify-between p-8'>
          <div className='flex items-center gap-3'>
            <span
              className='inline-block px-2 py-0.5 font-season text-[10px] font-bold uppercase tracking-wider text-black'
              style={{ backgroundColor: color }}
            >
              {category.label}
            </span>
            {post.readingTime && (
              <span className='font-season text-[10px] uppercase text-[#666]'>
                {post.readingTime} min read
              </span>
            )}
          </div>
          <div className='mt-auto'>
            <h3 className='mb-4 max-w-2xl font-[500] text-[32px] leading-tight tracking-[-0.02em] text-[#ECECEC] transition-colors duration-150 [@media(hover:hover)]:group-hover:text-[#00F701]'>
              {post.title}
            </h3>
            <p className='mb-6 max-w-2xl text-[14px] text-[#999]'>{post.description}</p>
            <div className='flex items-center gap-3 font-season text-[10px] uppercase text-[#666]'>
              <div className='flex items-center gap-2'>
                <div className='flex -space-x-1.5'>
                  {authors.slice(0, 2).map((a, idx) => (
                    <Avatar key={idx} className='size-5 border border-[#1C1C1C]'>
                      <AvatarImage src={a?.avatarUrl} alt={a?.name} />
                      <AvatarFallback className='bg-[#2A2A2A] font-season text-[8px] text-[#999]'>
                        {a?.name.slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                </div>
                <span className='text-[#999]'>
                  {authors
                    .slice(0, 2)
                    .map((a) => a?.name)
                    .join(', ')}
                </span>
              </div>
              <span className='h-1 w-1 bg-[#3d3d3d]' aria-hidden='true' />
              <time dateTime={post.date}>{formatDate(post.date)}</time>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  )
}

export function FeaturedGrid({ posts }: PostGridProps) {
  const shouldReduceMotion = useReducedMotion()
  if (posts.length === 0) return null
  const [lead, ...rest] = posts

  return (
    <motion.div
      className='grid grid-cols-1 gap-6 md:grid-cols-2'
      variants={gridVariants}
      initial={shouldReduceMotion ? 'visible' : 'hidden'}
      whileInView='visible'
      viewport={{ once: true, margin: '-60px' }}
    >
      <FeaturedLeadCard post={lead} />
      {rest.map((p) => (
        <PostCard key={p.slug} post={p} priority />
      ))}
    </motion.div>
  )
}

export function PostGrid({ posts }: PostGridProps) {
  const shouldReduceMotion = useReducedMotion()

  return (
    <motion.div
      className='grid auto-rows-[1fr] grid-cols-1 gap-6 md:grid-cols-2'
      variants={gridVariants}
      initial={shouldReduceMotion ? 'visible' : 'hidden'}
      whileInView='visible'
      viewport={{ once: true, margin: '-60px' }}
    >
      {posts.map((p, index) => (
        <PostCard key={p.slug} post={p} priority={index < 4} />
      ))}
    </motion.div>
  )
}
