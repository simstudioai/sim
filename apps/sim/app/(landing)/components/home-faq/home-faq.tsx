import { ChevronDown, cn } from '@sim/emcn'
import { SITE_URL } from '@/lib/core/utils/urls'
import { HOME_FAQS } from '@/app/(landing)/components/home-faq/faqs'
import { JsonLd } from '@/app/(landing)/components/json-ld'
import {
  HOME_INSET,
  HOME_TYPE,
  LANDING_CONTENT_WIDTH,
  LANDING_GUTTER,
} from '@/app/(landing)/components/landing-layout'

const HOME_FAQ_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  '@id': `${SITE_URL}#faq`,
  mainEntity: HOME_FAQS.map(({ question, answer }) => ({
    '@type': 'Question',
    name: question,
    acceptedAnswer: { '@type': 'Answer', text: answer },
  })),
}

/**
 * Homepage FAQ with matching `FAQPage` JSON-LD. Native `<details>` rows keep it a server
 * component: the homepage loads its animated islands with `next/dynamic`, and the animated
 * `LandingFAQ` would put framer-motion in the initial bundle. Closed answers stay in the HTML.
 */
export function HomeFAQ() {
  return (
    <section
      id='faq'
      aria-labelledby='home-faq-heading'
      className={cn('flex w-full flex-col', LANDING_CONTENT_WIDTH, LANDING_GUTTER)}
    >
      <JsonLd data={HOME_FAQ_JSON_LD} />
      <div
        className={cn(
          'flex items-start justify-between gap-10 max-sm:gap-5 max-xl:flex-col',
          HOME_INSET
        )}
      >
        <h2
          id='home-faq-heading'
          className={cn(
            'max-w-[16ch] text-balance text-[var(--text-primary)] md:w-1/2',
            HOME_TYPE.h2
          )}
        >
          Questions teams ask about Sim
        </h2>
        <div className='w-full divide-y divide-[var(--border)] xl:w-1/2'>
          {HOME_FAQS.map(({ question, answer }, index) => (
            <details key={question} open={index === 0} className='group'>
              <summary className='flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[var(--text-body)] transition-colors hover:text-[var(--text-primary)] group-open:text-[var(--text-primary)] [&::-webkit-details-marker]:hidden'>
                <h3 className='text-[15px] leading-snug tracking-[-0.02em]'>{question}</h3>
                <ChevronDown
                  className='size-3 shrink-0 text-[var(--text-muted)] transition-transform duration-200 group-open:rotate-180'
                  aria-hidden='true'
                />
              </summary>
              <p className='pb-4 text-[14px] text-[var(--text-body)] leading-[1.75]'>{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
