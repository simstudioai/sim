import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/emcn'
import { FAQ } from '@/lib/blog/faq'
import { getAllPostMeta, getPostBySlug, getRelatedPosts } from '@/lib/blog/registry'
import { buildPostGraphJsonLd, buildPostMetadata } from '@/lib/blog/seo'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { BackLink } from '@/app/(landing)/blog/[slug]/back-link'
import { ShareButton } from '@/app/(landing)/blog/[slug]/share-button'

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
  const graphJsonLd = buildPostGraphJsonLd(post)
  const related = await getRelatedPosts(slug, 3)

  return (
    <article
      className='w-full bg-[var(--landing-bg)]'
      itemScope
      itemType='https://schema.org/TechArticle'
    >
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(graphJsonLd) }}
      />
      <header className='px-5 pt-[60px] lg:px-16 lg:pt-[100px]'>
        <div className='mb-6'>
          <BackLink />
        </div>

        <div className='flex flex-col gap-8 md:flex-row md:gap-12'>
          <div className='w-full flex-shrink-0 md:w-[450px]'>
            <div className='relative w-full overflow-hidden rounded-[5px]'>
              <Image
                src={post.ogImage}
                alt={post.title}
                width={450}
                height={360}
                className='h-auto w-full'
                sizes='(max-width: 768px) 100vw, 450px'
                priority
                itemProp='image'
                unoptimized
              />
            </div>
          </div>
          <div className='flex flex-1 flex-col justify-between'>
            <div>
              <h1
                className='text-balance font-[430] font-season text-[28px] text-white leading-[110%] tracking-[-0.02em] sm:text-[36px] md:text-[44px] lg:text-[52px]'
                itemProp='headline'
              >
                {post.title}
              </h1>
              <p className='mt-4 font-[430] font-season text-[var(--landing-text-body)] text-base leading-[150%] tracking-[0.02em] sm:text-lg'>
                {post.description}
              </p>
            </div>
            <div className='mt-6 flex items-center gap-6'>
              <time
                className='font-martian-mono text-[var(--landing-text-subtle)] text-xs uppercase tracking-[0.1em]'
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
              <div className='flex items-center gap-3'>
                {(post.authors || [post.author]).map((a, idx) => (
                  <div key={idx} className='flex items-center gap-2'>
                    {a?.avatarUrl ? (
                      <Avatar className='size-5'>
                        <AvatarImage src={a.avatarUrl} alt={a.name} />
                        <AvatarFallback>{a.name.slice(0, 2)}</AvatarFallback>
                      </Avatar>
                    ) : null}
                    <Link
                      href={a?.url || '#'}
                      target='_blank'
                      rel='noopener noreferrer author'
                      className='font-martian-mono text-[var(--landing-text-muted)] text-xs uppercase tracking-[0.1em] hover:text-white'
                      itemProp='author'
                      itemScope
                      itemType='https://schema.org/Person'
                    >
                      <span itemProp='name'>{a?.name}</span>
                    </Link>
                  </div>
                ))}
              </div>
              <div className='ml-auto'>
                <ShareButton url={`${getBaseUrl()}/blog/${slug}`} title={post.title} />
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className='mt-8 h-px w-full bg-[var(--landing-bg-elevated)]' />

      <div className='mx-5 border-[var(--landing-bg-elevated)] border-x lg:mx-16'>
        <div className='mx-auto max-w-[900px] px-6 py-16' itemProp='articleBody'>
          <div className='prose prose-lg prose-invert max-w-none prose-blockquote:border-[var(--landing-border-strong)] prose-hr:border-[var(--landing-bg-elevated)] prose-headings:font-[430] prose-headings:font-season prose-a:text-white prose-blockquote:text-[var(--landing-text-muted)] prose-code:text-white prose-headings:text-white prose-li:text-[var(--landing-text-body)] prose-p:text-[var(--landing-text-body)] prose-strong:text-white prose-headings:tracking-[-0.02em]'>
            <Article />
            {post.faq && post.faq.length > 0 ? <FAQ items={post.faq} /> : null}
          </div>
        </div>

        {related.length > 0 && (
          <>
            <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />
            <nav aria-label='Related posts' className='flex flex-col sm:flex-row'>
              {related.map((p) => (
                <Link
                  key={p.slug}
                  href={`/blog/${p.slug}`}
                  className='group flex flex-1 flex-col gap-4 border-[var(--landing-bg-elevated)] border-t p-6 transition-colors first:border-t-0 hover:bg-[var(--landing-bg-elevated)] sm:border-t-0 sm:border-l sm:first:border-l-0'
                >
                  <div className='relative aspect-video w-full overflow-hidden rounded-[5px]'>
                    <Image
                      src={p.ogImage}
                      alt={p.title}
                      fill
                      sizes='(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw'
                      className='object-cover'
                      loading='lazy'
                      unoptimized
                    />
                  </div>
                  <div className='flex flex-col gap-2'>
                    <span className='font-martian-mono text-[var(--landing-text-subtle)] text-xs uppercase tracking-[0.1em]'>
                      {new Date(p.date).toLocaleDateString('en-US', {
                        month: 'short',
                        year: '2-digit',
                      })}
                    </span>
                    <h3 className='font-[430] font-season text-lg text-white leading-tight tracking-[-0.01em]'>
                      {p.title}
                    </h3>
                    <p className='line-clamp-2 text-[#F6F6F0]/50 text-sm leading-[150%]'>
                      {p.description}
                    </p>
                  </div>
                </Link>
              ))}
            </nav>
          </>
        )}
      </div>

      <div className='-mt-px h-px w-full bg-[var(--landing-bg-elevated)]' />

      <meta itemProp='publisher' content='Sim' />
      <meta itemProp='inLanguage' content='en-US' />
      <meta itemProp='keywords' content={post.tags.join(', ')} />
      {post.wordCount && <meta itemProp='wordCount' content={String(post.wordCount)} />}
    </article>
  )
}
