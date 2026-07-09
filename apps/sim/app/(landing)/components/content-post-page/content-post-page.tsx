import { Avatar, AvatarFallback, AvatarImage } from '@sim/emcn'
import Image from 'next/image'
import Link from 'next/link'
import { FAQ } from '@/lib/content/faq'
import type { ContentMeta, ContentPost } from '@/lib/content/schema'
import { BackLink } from '@/app/(landing)/components/back-link'
import { JsonLd } from '@/app/(landing)/components/json-ld'
import { ShareButton } from '@/app/(landing)/components/share-button'

interface ContentPostPageProps {
  /** Route base path, e.g. `/blog` or `/library`. */
  basePath: string
  /** Label for the back-to-index link, e.g. "Back to Blog". */
  backLabel: string
  post: ContentPost
  related: ContentMeta[]
  graphJsonLd: Record<string, unknown>
  shareUrl: string
}

/**
 * Shared post-detail layout for a content section (blog or library): header
 * with cover image/title/authors/share, MDX article body + FAQ, and related
 * posts. Both sections render this exact layout, parameterized by `basePath`.
 */
export function ContentPostPage({
  basePath,
  backLabel,
  post,
  related,
  graphJsonLd,
  shareUrl,
}: ContentPostPageProps) {
  const Article = post.Content

  return (
    <article className='w-full bg-[var(--bg)]' itemScope itemType='https://schema.org/TechArticle'>
      <JsonLd data={graphJsonLd} />
      <header className='mx-auto w-full max-w-[1460px] px-20 pt-[112px] max-sm:px-5 max-sm:pt-20 max-lg:px-8'>
        <div className='mb-6'>
          <BackLink href={basePath} label={backLabel} />
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
              />
            </div>
          </div>
          <div className='flex flex-1 flex-col justify-between'>
            <div>
              <h1
                className='text-balance text-[28px] text-[var(--text-primary)] leading-[110%] tracking-[-0.02em] sm:text-[36px] md:text-[44px] lg:text-[52px]'
                itemProp='headline'
              >
                {post.title}
              </h1>
              <p className='mt-4 text-[var(--text-body)] text-base leading-[150%] tracking-[0.02em] sm:text-lg'>
                {post.description}
              </p>
            </div>
            <div className='mt-6 flex items-center gap-6'>
              <time
                className='text-[var(--text-muted)] text-xs uppercase tracking-[0.1em]'
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
                {(post.authors || [post.author]).map((a) => (
                  <div key={a?.name} className='flex items-center gap-2'>
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
                      className='text-[var(--text-muted)] text-xs uppercase tracking-[0.1em] hover:text-[var(--text-primary)]'
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
                <ShareButton url={shareUrl} title={post.title} />
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className='mt-8 h-px w-full bg-[var(--border)]' />

      <div className='mx-auto w-full max-w-[1460px] px-20 max-sm:px-5 max-lg:px-8'>
        <div className='border-[var(--border)] border-x'>
          <div className='mx-auto max-w-[900px] px-6 py-16' itemProp='articleBody'>
            <div className='prose prose-lg max-w-none prose-blockquote:border-[var(--border-1)] prose-hr:border-[var(--border)] prose-headings:font-season prose-a:text-[var(--text-primary)] prose-blockquote:text-[var(--text-muted)] prose-code:text-[var(--text-primary)] prose-headings:text-[var(--text-primary)] prose-li:text-[var(--text-body)] prose-p:text-[var(--text-body)] prose-strong:text-[var(--text-primary)] prose-headings:tracking-[-0.02em]'>
              <Article />
              {post.faq && post.faq.length > 0 ? <FAQ items={post.faq} /> : null}
            </div>
          </div>

          {related.length > 0 && (
            <>
              <div className='h-px w-full bg-[var(--border)]' />
              <nav aria-label='Related posts' className='flex flex-col sm:flex-row'>
                {related.map((p) => (
                  <Link
                    key={p.slug}
                    href={`${basePath}/${p.slug}`}
                    className='group flex flex-1 flex-col gap-4 border-[var(--border)] border-t p-6 transition-colors first:border-t-0 hover:bg-[var(--surface-hover)] sm:border-t-0 sm:border-l sm:first:border-l-0'
                  >
                    <div className='relative aspect-video w-full overflow-hidden rounded-[5px]'>
                      <Image
                        src={p.ogImage}
                        alt={p.title}
                        fill
                        sizes='(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw'
                        className='object-cover'
                        loading='lazy'
                      />
                    </div>
                    <div className='flex flex-col gap-2'>
                      <span className='text-[var(--text-muted)] text-xs uppercase tracking-[0.1em]'>
                        {new Date(p.date).toLocaleDateString('en-US', {
                          month: 'short',
                          year: '2-digit',
                        })}
                      </span>
                      <h3 className='text-[var(--text-primary)] text-lg leading-tight tracking-[-0.01em]'>
                        {p.title}
                      </h3>
                      <p className='line-clamp-2 text-[var(--text-muted)] text-sm leading-[150%]'>
                        {p.description}
                      </p>
                    </div>
                  </Link>
                ))}
              </nav>
            </>
          )}
        </div>
      </div>

      <div className='-mt-px h-px w-full bg-[var(--border)]' />

      <meta itemProp='publisher' content='Sim' />
      <meta itemProp='inLanguage' content='en-US' />
      <meta itemProp='keywords' content={post.tags.join(', ')} />
      {post.wordCount && <meta itemProp='wordCount' content={String(post.wordCount)} />}
    </article>
  )
}
