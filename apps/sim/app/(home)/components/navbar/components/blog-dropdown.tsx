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
  titleSize = '12px',
  className,
}: {
  slug: string
  image: string
  title: string
  imageHeight: string
  titleSize?: string
  className?: string
}) {
  return (
    <Link
      href={`/blog/${slug}`}
      className={cn(
        'group/card flex flex-col overflow-hidden rounded-[5px] border border-[#2A2A2A] bg-[#1C1C1C] transition-colors hover:border-[#3D3D3D] hover:bg-[#2A2A2A]',
        className
      )}
      prefetch={false}
    >
      <div className='w-full overflow-hidden bg-[#141414]' style={{ height: imageHeight }}>
        <img
          src={image}
          alt={title}
          decoding='async'
          className='h-full w-full object-cover transition-transform duration-200 group-hover/card:scale-[1.02]'
        />
      </div>
      <div className='flex-shrink-0 px-[10px] py-[6px]'>
        <span
          className='font-[430] font-season text-[#cdcdcd] leading-[140%]'
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
    <div className='w-[560px] rounded-[5px] border border-[#2A2A2A] bg-[#1C1C1C] p-[16px] shadow-[0_16px_48px_rgba(0,0,0,0.4)]'>
      <div className='grid grid-cols-3 gap-[8px]'>
        <BlogCard
          slug={featured.slug}
          image={featured.ogImage}
          title={featured.title}
          imageHeight='190px'
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
          />
        ))}
      </div>
    </div>
  )
}
