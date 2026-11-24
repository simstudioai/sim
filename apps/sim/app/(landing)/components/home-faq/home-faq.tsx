import { cn } from '@sim/emcn'
import { SITE_URL } from '@/lib/core/utils/urls'
import { HOME_FAQS } from '@/app/(landing)/components/home-faq/faqs'
import { JsonLd } from '@/app/(landing)/components/json-ld'
import { LandingFAQ } from '@/app/(landing)/components/landing-faq'
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

/** Homepage FAQ with matching `FAQPage` JSON-LD. */
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
        <div className='w-full xl:w-1/2'>
          <LandingFAQ faqs={[...HOME_FAQS]} />
        </div>
      </div>
    </section>
  )
}
