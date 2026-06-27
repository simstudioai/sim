import { GoogleBooksIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GoogleBooksBlockDisplay = {
  type: 'google_books',
  name: 'Google Books',
  description: 'Search and retrieve book information',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleBooksIcon,
  longDescription:
    'Search for books using the Google Books API. Find volumes by title, author, ISBN, or keywords, and retrieve detailed information about specific books including descriptions, ratings, and publication details.',
  docsLink: 'https://docs.sim.ai/integrations/google_books',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay
