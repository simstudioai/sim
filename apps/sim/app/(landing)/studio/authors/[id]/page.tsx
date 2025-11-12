import Image from 'next/image'
import Link from 'next/link'
import { getAllPostMeta } from '@/lib/blog/registry'
import { soehne } from '@/app/fonts/soehne/soehne'

export const revalidate = 3600

export default async function AuthorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const posts = (await getAllPostMeta()).filter((p) => p.author.id === id)
  const author = posts[0]?.author
  if (!author) {
    return (
      <main className={`${soehne.className} mx-auto max-w-[900px] px-6 py-10 sm:px-8 md:px-12`}>
        <h1 className='font-medium text-[32px]'>Author not found</h1>
      </main>
    )
  }
  const personJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: author.name,
    url: `https://sim.ai/studio/authors/${author.id}`,
    sameAs: author.url ? [author.url] : [],
    image: author.avatarUrl,
  }
  return (
    <main className={`${soehne.className} mx-auto max-w-[900px] px-6 py-10 sm:px-8 md:px-12`}>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd) }}
      />
      <div className='mb-6 flex items-center gap-3'>
        {author.avatarUrl ? (
          <Image
            src={author.avatarUrl}
            alt={author.name}
            width={40}
            height={40}
            className='rounded-full'
          />
        ) : null}
        <h1 className='font-medium text-[32px] leading-tight'>{author.name}</h1>
      </div>
      <div className='grid grid-cols-1 gap-8 sm:grid-cols-2'>
        {posts.map((p) => (
          <Link key={p.slug} href={`/studio/${p.slug}`} className='group'>
            <div className='overflow-hidden rounded-lg border border-gray-200'>
              <Image
                src={p.ogImage}
                alt={p.title}
                width={600}
                height={315}
                className='h-[160px] w-full object-cover transition-transform group-hover:scale-[1.02]'
              />
              <div className='p-3'>
                <div className='mb-1 text-gray-600 text-xs'>
                  {new Date(p.date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </div>
                <div className='font-medium text-sm leading-tight'>{p.title}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  )
}
