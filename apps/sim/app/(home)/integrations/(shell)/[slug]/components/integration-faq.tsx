import type { FAQItem } from '@/lib/integrations'
import { LandingFAQ } from '@/app/(home)/components/landing-faq'

interface IntegrationFAQProps {
  faqs: FAQItem[]
}

export function IntegrationFAQ({ faqs }: IntegrationFAQProps) {
  return <LandingFAQ faqs={faqs} />
}
