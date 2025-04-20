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
      <div className="p-8 bg-[#101010] border border-[#606060]/40 rounded-3xl flex flex-col transition-all duration-500 hover:bg-[#202020]">
        {image ? (
          <Image
            src={image}
            alt="Image"
            width={2000}
            height={2000}
            className="w-full h-max aspect-video rounded-xl"
          />
        ) : (
          <></>
        )}
        {date ? (
          <p className="text-[#BBBBBB]/70 tracking-tight text-base font-light pb-5">
            {date.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        ) : (
          <></>
        )}
        <div className="flex flex-col gap-6">
          <p className="text-2xl lg:text-3xl font-medium text-white/80 leading-[1.2] tracking-normal max-w-96">
            {title}
          </p>
          <p className="text-lg text-white/60 leading-[1.5] font-light">{description}</p>
        </div>
        <div className="pt-16 flex flex-col gap-6">
          <div className="flex gap-4 items-center">
            {avatar ? (
              <Image
                src={avatar}
                alt="Avatar"
                width={64}
                height={64}
                className="w-16 h-16 rounded-full"
              />
            ) : (
              <></>
            )}

            <div className="flex flex-col gap-0">
              <p className="text-xl font-medium text-white/90">{author}</p>
              <p className="text-base font-normal text-white/60">{authorRole}</p>
            </div>
          </div>

          <div className="flex gap-5 items-center">
            <div
              className="px-2 py-1 rounded-lg"
              style={{
                background: blogConfig[type.toLowerCase() as keyof typeof blogConfig] ?? '#333',
              }}
            >
              <p className="text-white text-base font-light">{type}</p>
            </div>
            <p className="font-light text-base text-white/60">{readTime} min-read</p>
          </div>
        </div>
      </div>
    </Link>
  )
}
