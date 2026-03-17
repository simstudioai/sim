import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { FAQ } from '@/lib/blog/faq'
import '@/app/(landing)/studio/[slug]/prose-studio.css'
import { getAllPostMeta, getPostBySlug, getRelatedPosts } from '@/lib/blog/registry'
import { buildArticleJsonLd, buildBreadcrumbJsonLd, buildPostMetadata } from '@/lib/blog/seo'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  AnimatedColorBlocks,
  AnimatedColorBlocksVertical,
} from '@/app/(landing)/blog/[slug]/animated-blocks'
import { ArticleSidebar } from '@/app/(landing)/blog/[slug]/article-sidebar'
import { ShareButtons } from '@/app/(landing)/blog/[slug]/share-button'
import { getPrimaryCategory, getTagCategory } from '@/app/(landing)/blog/tag-colors'

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

  const category = getPrimaryCategory(post.tags)
  const categoryColor = category.color
  const displayAuthors = post.authors && post.authors.length > 0 ? post.authors : [post.author]
  const shareUrl = `${getBaseUrl()}/studio/${slug}`

  return (
    <article className='w-full' itemScope itemType='https://schema.org/BlogPosting'>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />

      <div className='mx-auto flex w-full max-w-[1400px] flex-col items-start gap-8 px-6 pb-24 pt-16 xl:flex-row'>
        <div className='max-w-4xl flex-grow xl:mx-auto'>
          <Link
            href='/studio'
            className='group mb-8 inline-flex items-center gap-2 border border-[#2A2A2A] bg-[#232323] px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-[#999] transition-colors hover:text-[#ECECEC]'
            style={{ borderRadius: '5px' }}
          >
            <ArrowLeft
              className='h-3 w-3 transition-transform group-hover:-translate-x-1'
              aria-hidden='true'
            />
            All Posts
          </Link>
          <header className='relative mb-12 border-b border-[#2A2A2A] pb-8'>
            <div className='absolute right-0 top-0'>
              <AnimatedColorBlocks />
              <div className='absolute right-0 top-[12px]'>
                <AnimatedColorBlocksVertical />
              </div>
            </div>
            <div className='mb-6 flex items-center gap-3'>
              <span
                className='inline-block h-3 w-3'
                style={{ backgroundColor: categoryColor }}
                aria-hidden='true'
              />
              <div className='font-mono text-[11px] uppercase tracking-widest text-[#999]'>
                <time dateTime={post.date} itemProp='datePublished'>
                  {new Date(post.date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: '2-digit',
                    year: 'numeric',
                  })}
                </time>
                {' // '}
                <span style={{ color: categoryColor }}>{category.label}</span>
              </div>
            </div>
            <h1
              className='mb-6 font-[500] text-[36px] leading-[1.15] tracking-tight text-[#ECECEC] sm:text-[40px] md:text-[48px]'
              itemProp='headline'
            >
              {post.title}
            </h1>
            <p className='mb-6 text-[18px] leading-relaxed text-[#999]' itemProp='description'>
              {post.description}
            </p>
            {post.tags.length > 0 && (
              <div className='flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[11px] text-[#666]'>
                {post.tags.map((tag, i) => (
                  <span key={tag}>
                    <Link
                      href={`/studio?tag=${encodeURIComponent(getTagCategory(tag))}`}
                      className='transition-colors hover:text-[#999]'
                    >
                      {tag}
                    </Link>
                    {i < post.tags.length - 1 && <span className='ml-1.5 text-[#3d3d3d]'>/</span>}
                  </span>
                ))}
              </div>
            )}

            <meta itemProp='dateModified' content={post.updated ?? post.date} />
          </header>
          <div itemProp='articleBody'>
            <div className='prose-studio prose prose-lg prose-invert max-w-none'>
              <Article />
              {post.faq && post.faq.length > 0 ? <FAQ items={post.faq} /> : null}
            </div>
          </div>
          <div className='mt-16 flex items-center justify-between border-t border-[#2A2A2A] pt-8'>
            <div className='font-mono text-[11px] text-[#999]'>Share this entry:</div>
            <ShareButtons url={shareUrl} title={post.title} />
          </div>
        </div>
        <ArticleSidebar
          author={post.author}
          authors={displayAuthors}
          headings={post.headings ?? []}
          related={related}
        />
      </div>

      <meta itemProp='publisher' content='Sim' />
      <meta itemProp='inLanguage' content='en-US' />
      <meta itemProp='keywords' content={post.tags.join(', ')} />
      {displayAuthors.map((a, idx) => (
        <span key={idx} itemProp='author' itemScope itemType='https://schema.org/Person'>
          <meta itemProp='name' content={a.name} />
          {a.url && <meta itemProp='url' content={a.url} />}
        </span>
      ))}
    </article>
  )
}
