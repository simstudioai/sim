export interface CustomerStory {
  slug: string
  company: string
  industry: string
  focus: readonly string[]
  heroImage?: string
  heroAlt: string
  logo: { src: string; alt: string; width: number; height: number }
}

/** Customer identity and artwork shared by the story index and detail pages. */
export const CUSTOMER_STORIES: readonly CustomerStory[] = [
  {
    slug: 'rivian',
    company: 'Rivian',
    industry: 'Automotive',
    focus: ['Connected systems', 'Enterprise AI agents', 'Governance'],
    heroImage: '/landing/customers/rivian-trail.jpg',
    heroAlt: 'A Rivian on a winding trail through a mountain landscape',
    logo: {
      src: '/landing/logos/rivian-vw.svg',
      alt: 'Rivian | Volkswagen Group Technologies',
      width: 300,
      height: 28,
    },
  },
  {
    slug: 'exp-realty',
    company: 'eXp Realty',
    industry: 'Real estate',
    focus: ['Real estate operations', 'AI workflows', 'Governance'],
    heroAlt: 'eXp Realty',
    logo: {
      src: '/landing/logos/exp-realty.svg',
      alt: 'eXp Realty',
      width: 150,
      height: 82,
    },
  },
]

export const CUSTOMER_SECTION = {
  name: 'Customer stories',
  basePath: '/customers',
  description: 'How teams connect their systems, build AI agents, and govern their work with Sim.',
} as const
