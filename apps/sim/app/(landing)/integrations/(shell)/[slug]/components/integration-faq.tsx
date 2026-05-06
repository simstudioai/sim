import { LandingFAQ } from '@/app/(landing)/components/landing-faq'
import type { FAQItem } from '@/app/(landing)/integrations/data/types'

interface IntegrationFAQProps {
  faqs: FAQItem[]
}

export function IntegrationFAQ({ faqs }: IntegrationFAQProps) {
  return <LandingFAQ faqs={faqs} />
}
