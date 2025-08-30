import Image from 'next/image'
import Link from 'next/link'

type BlogCardProps = {
  href: string
  title: string
  description?: string
  date?: Date
  avatar?: string
  author: string
  authorRole?: string
  type: string
  readTime?: string
  image?: string
}

const blogConfig = {
  agents: '#802efc',
  functions: '#FC2E31',
  workflows: '#2E8CFC',
  // ADD MORE
}

export const BlogCard = ({
  href,
  image,
  title,
  description,
  date,
  avatar,
  author,
  authorRole,
  type,
  readTime,
}: BlogCardProps) => {
  return (
    <Link href={href}>
      <div className='flex flex-col rounded-3xl border border-[#606060]/40 bg-[#101010] p-8 transition-all duration-500 hover:bg-[var(--surface-elevated)]'>
        {image ? (
          <Image
            src={image}
            alt='Image'
            width={2000}
            height={2000}
            className='aspect-video h-max w-full rounded-xl'
          />
        ) : (
          <></>
        )}
        {date ? (
          <p className='pb-5 font-light text-[#BBBBBB]/70 text-base tracking-tight'>
            {date.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        ) : (
          <></>
        )}
        <div className='flex flex-col gap-6'>
          <p className='max-w-96 font-medium text-2xl text-white/80 leading-[1.2] tracking-normal lg:text-3xl'>
            {title}
          </p>
          <p className='font-light text-lg text-white/60 leading-[1.5]'>{description}</p>
        </div>
        <div className='flex flex-col gap-6 pt-16'>
          <div className='flex items-center gap-4'>
            {avatar ? (
              <Image
                src={avatar}
                alt='Avatar'
                width={64}
                height={64}
                className='h-16 w-16 rounded-full'
              />
            ) : (
              <></>
            )}

            <div className='flex flex-col gap-0'>
              <p className='font-medium text-white/90 text-xl'>{author}</p>
              <p className='font-normal text-base text-white/60'>{authorRole}</p>
            </div>
          </div>

          <div className='flex items-center gap-5'>
            <div
              className='rounded-lg px-2 py-1'
              style={{
                background: blogConfig[type.toLowerCase() as keyof typeof blogConfig] ?? '#333',
              }}
            >
              <p className='font-light text-base text-white'>{type}</p>
            </div>
            <p className='font-light text-base text-white/60'>{readTime} min-read</p>
          </div>
        </div>
      </div>
    </Link>
  )
}
