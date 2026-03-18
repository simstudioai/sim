import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { FAQ } from '@/lib/blog/faq'
import '@/app/(landing)/blog/[slug]/prose-studio.css'
import { getAllPostMeta, getPostBySlug, getRelatedPosts } from '@/lib/blog/registry'
import type { Author, BlogMeta } from '@/lib/blog/schema'
import { buildArticleJsonLd, buildBreadcrumbJsonLd, buildPostMetadata } from '@/lib/blog/seo'
import { formatDate } from '@/lib/core/utils/formatting'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  AnimatedColorBlocks,
  AnimatedColorBlocksVertical,
} from '@/app/(landing)/blog/[slug]/animated-blocks'
import { ArticleHeaderItem, ArticleHeaderMotion } from '@/app/(landing)/blog/[slug]/article-header'
import { ArticleSidebar } from '@/app/(landing)/blog/[slug]/article-sidebar'
import { ShareButtons } from '@/app/(landing)/blog/[slug]/share-button'
import { getPrimaryCategory, getTagCategory, getTagColor } from '@/app/(landing)/blog/tag-colors'

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

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const [post, related] = await Promise.all([getPostBySlug(slug), getRelatedPosts(slug, 3)])
  const Article = post.Content
  const jsonLd = buildArticleJsonLd(post)
  const breadcrumbLd = buildBreadcrumbJsonLd(post)

  const category = getPrimaryCategory(post.tags)
  const categoryColor = category.color
  const displayAuthors = post.authors && post.authors.length > 0 ? post.authors : [post.author]
  const shareUrl = `${getBaseUrl()}/blog/${slug}`

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

      <div className='mx-auto flex w-full max-w-[1500px] flex-col items-start gap-2 pb-24 pt-16 xl:flex-row'>
        <div data-blog-main-content className='max-w-5xl flex-grow mx-auto'>
          <Link
            href='/blog'
            className='group mb-8 inline-flex items-center gap-2 border border-[#2A2A2A] bg-[#232323] px-4 py-2 font-season text-[11px] uppercase tracking-widest text-[#999] transition-colors hover:text-[#ECECEC]'
            style={{ borderRadius: '5px' }}
          >
            <ArrowLeft
              className='h-3 w-3 transition-transform group-hover:-translate-x-1'
              aria-hidden='true'
            />
            All Posts
          </Link>
          <header className='mb-12 border-b border-[#2A2A2A] pb-8'>
            <ArticleHeaderMotion>
              <ArticleHeaderItem className='mb-6 flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
                <div className='flex items-center gap-3'>
                  <span
                    className='inline-block h-3 w-3'
                    style={{ backgroundColor: categoryColor }}
                    aria-hidden='true'
                  />
                  <div className='font-season text-[11px] uppercase tracking-widest text-[#999]'>
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

                <div className='shrink-0'>
                  <ShareButtons url={shareUrl} title={post.title} />
                </div>
              </ArticleHeaderItem>
              <ArticleHeaderItem>
                <h1
                  className='mb-6 font-[500] text-[36px] leading-[1.15] tracking-tight text-[#ECECEC] sm:text-[40px] md:text-[48px]'
                  itemProp='headline'
                >
                  {post.title}
                </h1>
              </ArticleHeaderItem>
              <ArticleHeaderItem>
                <p className='mb-6 text-[18px] leading-relaxed text-[#999]' itemProp='description'>
                  {post.description}
                </p>
              </ArticleHeaderItem>

              {post.tags.length > 0 && (
                <ArticleHeaderItem>
                  <div className='flex flex-wrap items-center gap-x-1.5 gap-y-1 font-season text-[11px] text-[#666]'>
                    {post.tags.map((tag, i) => (
                      <span key={tag}>
                        <Link
                          href={`/blog?tag=${encodeURIComponent(getTagCategory(tag))}`}
                          className='transition-colors hover:text-[#999]'
                        >
                          {tag}
                        </Link>
                        {i < post.tags.length - 1 && (
                          <span className='ml-1.5 text-[#3d3d3d]'>/</span>
                        )}
                      </span>
                    ))}
                  </div>
                </ArticleHeaderItem>
              )}
            </ArticleHeaderMotion>

            <meta itemProp='dateModified' content={post.updated ?? post.date} />
          </header>
          <div itemProp='articleBody'>
            <div className='prose-studio prose prose-lg prose-invert max-w-none'>
              <Article />
              {post.faq && post.faq.length > 0 ? <FAQ items={post.faq} /> : null}
            </div>
          </div>

          {/* Authors */}
          <ArticleAuthors authors={displayAuthors} />

          {/* Related articles */}
          {related.length > 0 && <RelatedArticles posts={related} />}
        </div>

        <ArticleSidebar headings={post.headings ?? []} />
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

interface ArticleAuthorsProps {
  authors: Author[]
}

function ArticleAuthors({ authors }: ArticleAuthorsProps) {
  return (
    <div className='mt-12'>
      <div className='mb-6 flex items-center gap-2 font-season text-[11px] uppercase tracking-widest text-[#666]'>
        <span className='inline-block h-2 w-2 bg-[#FA4EDF]' aria-hidden='true' />
        {authors.length > 1 ? 'Authors' : 'Written by'}
      </div>
      <div className='flex flex-wrap gap-6'>
        {authors.map((a) => (
          <div
            key={a.id}
            className='flex items-center gap-4 border border-[#2A2A2A] bg-[#232323] p-5'
            style={{ borderRadius: '2px' }}
          >
            <div
              className='flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden border border-[#2A2A2A] bg-[#1C1C1C] font-season text-lg text-[#2ABBF8]'
              style={{ borderRadius: '2px' }}
            >
              {a.avatarUrl ? (
                <Image
                  src={a.avatarUrl}
                  alt={a.name}
                  width={48}
                  height={48}
                  className='h-full w-full object-cover'
                  unoptimized
                />
              ) : (
                a.name.slice(0, 2).toUpperCase()
              )}
            </div>
            <div>
              <h3 className='font-[500] text-[#ECECEC]'>{a.name}</h3>
              {a.url && (
                <Link
                  href={a.url}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='font-season text-[11px] text-[#999] transition-colors hover:text-[#ECECEC]'
                >
                  {a.xHandle ? `@${a.xHandle}` : 'Profile'}
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

interface RelatedArticlesProps {
  posts: BlogMeta[]
}

function RelatedArticles({ posts }: RelatedArticlesProps) {
  return (
    <div className='mt-12 border-t border-[#2A2A2A] pt-8'>
      <div className='mb-6 flex items-center gap-2 font-season text-[11px] uppercase tracking-widest text-[#666]'>
        <span className='inline-block h-2 w-2 bg-[#FFCC02]' aria-hidden='true' />
        Related articles
      </div>
      <div className='grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3'>
        {posts.map((p) => {
          const color = getTagColor(p.tags[0]) || '#999'
          const cat = getPrimaryCategory(p.tags)
          return (
            <Link
              key={p.slug}
              href={`/blog/${p.slug}`}
              className='group flex flex-col border border-[#2A2A2A] bg-[#232323] p-5 transition-[border-color,background-color,transform] duration-200 ease-out [@media(hover:hover)]:hover:border-[#3d3d3d] [@media(hover:hover)]:hover:bg-[#282828] [@media(hover:hover)]:hover:-translate-y-0.5'
              style={{ borderRadius: '2px' }}
            >
              <div className='mb-3 flex items-center gap-3'>
                <span
                  className='inline-block px-2 py-0.5 font-season text-[10px] font-bold uppercase tracking-wider text-black'
                  style={{ backgroundColor: color }}
                >
                  {cat.label}
                </span>
              </div>
              <h4 className='mb-2 text-[15px] font-[500] leading-tight text-[#ECECEC] transition-colors duration-150 [@media(hover:hover)]:group-hover:text-[#FFCC02]'>
                {p.title}
              </h4>
              <p className='mb-4 line-clamp-2 text-[13px] leading-relaxed text-[#999]'>
                {p.description}
              </p>
              <div className='mt-auto font-season text-[10px] text-[#666]'>
                {formatDate(new Date(p.date))}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
