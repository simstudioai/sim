import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { FAQ } from '@/lib/blog/faq'
import { getAllPostMeta, getPostBySlug, getRelatedPosts } from '@/lib/blog/registry'
import { buildArticleJsonLd, buildBreadcrumbJsonLd, buildPostMetadata } from '@/lib/blog/seo'
import { soehne } from '@/app/fonts/soehne/soehne'

export async function generateStaticParams() {
  const posts = await getAllPostMeta()
  return posts.map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const post = await getPostBySlug(slug)
  return buildPostMetadata(post)
}

export const revalidate = 86400

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await getPostBySlug(slug)
  const Article = post.Content
  const jsonLd = buildArticleJsonLd(post)
  const breadcrumbLd = buildBreadcrumbJsonLd(post)
  const related = await getRelatedPosts(slug, 3)

  return (
    <article
      className={`${soehne.className} w-full`}
      itemScope
      itemType='https://schema.org/BlogPosting'
    >
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <header className='mx-auto max-w-[1450px] px-6 pt-8 sm:px-8 sm:pt-12 md:px-12 md:pt-16'>
        <div className='mb-6'>
          <Link href='/studio' className='text-gray-600 text-sm hover:text-gray-900'>
            ← Back to Sim Studio
          </Link>
        </div>
        <div className='flex flex-col gap-8 md:flex-row md:gap-12'>
          <div className='w-full flex-shrink-0 md:w-[450px]'>
            <div className='relative w-full overflow-hidden rounded-lg'>
              <Image
                src={post.ogImage}
                alt={post.title}
                width={450}
                height={360}
                className='h-auto w-full'
                priority
                itemProp='image'
              />
            </div>
          </div>
          <div className='flex flex-1 flex-col justify-between'>
            <h1
              className='font-medium text-[36px] leading-tight tracking-tight sm:text-[48px] md:text-[56px] lg:text-[64px]'
              itemProp='headline'
            >
              {post.title}
            </h1>
            <div className='mt-4 flex items-center gap-3'>
              {(post.authors || [post.author]).map((a, idx) => (
                <div key={idx} className='flex items-center gap-2'>
                  {a?.avatarUrl ? (
                    <Avatar className='size-6'>
                      <AvatarImage src={a.avatarUrl} alt={a.name} />
                      <AvatarFallback>{a.name.slice(0, 2)}</AvatarFallback>
                    </Avatar>
                  ) : null}
                  <Link
                    href={a?.url || '#'}
                    target='_blank'
                    rel='noopener noreferrer author'
                    className='text-[14px] text-gray-600 leading-[1.5] hover:text-gray-900 sm:text-[16px]'
                    itemProp='author'
                    itemScope
                    itemType='https://schema.org/Person'
                  >
                    <span itemProp='name'>{a?.name}</span>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </div>
        <hr className='mt-8 border-gray-200 border-t sm:mt-12' />
        <div className='flex flex-col gap-6 py-8 sm:flex-row sm:items-start sm:justify-between sm:gap-8 sm:py-10'>
          <div className='flex flex-shrink-0 items-center gap-4'>
            <time
              className='block text-[14px] text-gray-600 leading-[1.5] sm:text-[16px]'
              dateTime={post.date}
              itemProp='datePublished'
            >
              {new Date(post.date).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </time>
            <meta itemProp='dateModified' content={post.updated ?? post.date} />
          </div>
          <div className='flex-1'>
            <p className='m-0 block translate-y-[-4px] font-[400] text-[18px] leading-[1.5] sm:text-[20px] md:text-[26px]'>
              {post.description}
            </p>
          </div>
        </div>
      </header>

      <div className='mx-auto max-w-[900px] px-6 pb-20 sm:px-8 md:px-12' itemProp='articleBody'>
        <div className='prose prose-lg max-w-none'>
          <Article />
          {post.faq && post.faq.length > 0 ? <FAQ items={post.faq} /> : null}
        </div>
      </div>
      {related.length > 0 && (
        <div className='mx-auto max-w-[900px] px-6 pb-24 sm:px-8 md:px-12'>
          <h2 className='mb-4 font-medium text-[24px]'>Related posts</h2>
          <div className='grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3'>
            {related.map((p) => (
              <Link key={p.slug} href={`/studio/${p.slug}`} className='group'>
                <div className='overflow-hidden rounded-lg border border-gray-200'>
                  <Image
                    src={p.ogImage}
                    alt={p.title}
                    width={600}
                    height={315}
                    className='h-[160px] w-full object-cover'
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
        </div>
      )}
      <meta itemProp='publisher' content='Sim' />
      <meta itemProp='inLanguage' content='en-US' />
      <meta itemProp='keywords' content={post.tags.join(', ')} />
    </article>
  )
}
