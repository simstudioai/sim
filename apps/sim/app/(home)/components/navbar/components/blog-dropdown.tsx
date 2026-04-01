import Image from 'next/image'
import Link from 'next/link'
import { cn } from '@/lib/core/utils/cn'

export interface NavBlogPost {
  slug: string
  title: string
  ogImage: string
}

function BlogCard({
  slug,
  image,
  title,
  imageHeight,
  sizes,
  titleSize = '12px',
  className,
}: {
  slug: string
  image: string
  title: string
  imageHeight: string
  sizes: string
  titleSize?: string
  className?: string
}) {
  return (
    <Link
      href={`/blog/${slug}`}
      className={cn(
        'group/card flex flex-col overflow-hidden rounded-[5px] border border-[var(--landing-bg-elevated)] bg-[var(--landing-bg)] transition-colors hover:border-[var(--landing-border-strong)] hover:bg-[var(--landing-bg-elevated)]',
        className
      )}
      prefetch={false}
    >
      <div className='relative w-full overflow-hidden bg-[#141414]' style={{ height: imageHeight }}>
        <Image
          src={image}
          alt={title}
          fill
          sizes={sizes}
          className='object-cover transition-transform duration-200 group-hover/card:scale-[1.02]'
          unoptimized
        />
      </div>
      <div className='flex-shrink-0 px-2.5 py-1.5'>
        <span
          className='font-[430] font-season text-[var(--landing-text-body)] leading-[140%]'
          style={{ fontSize: titleSize }}
        >
          {title}
        </span>
      </div>
    </Link>
  )
}

interface BlogDropdownProps {
  posts: NavBlogPost[]
}

export function BlogDropdown({ posts }: BlogDropdownProps) {
  const [featured, ...rest] = posts

  if (!featured) return null

  return (
    <div className='w-[560px] rounded-[5px] border border-[var(--landing-bg-elevated)] bg-[var(--landing-bg)] p-4 shadow-overlay'>
      <div className='grid grid-cols-3 gap-2'>
        <BlogCard
          slug={featured.slug}
          image={featured.ogImage}
          title={featured.title}
          imageHeight='190px'
          sizes='340px'
          titleSize='13px'
          className='col-span-2 row-span-2'
        />

        {rest.map((post) => (
          <BlogCard
            key={post.slug}
            slug={post.slug}
            image={post.ogImage}
            title={post.title}
            imageHeight='72px'
            sizes='170px'
          />
        ))}
      </div>
    </div>
  )
}
