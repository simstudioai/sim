import type { FAQItem } from '@/lib/integrations'
import { LandingFAQ } from '@/app/(landing)/components/landing-faq'

interface IntegrationFAQProps {
  faqs: FAQItem[]
}

export function IntegrationFAQ({ faqs }: IntegrationFAQProps) {
  return <LandingFAQ faqs={faqs} />
}
