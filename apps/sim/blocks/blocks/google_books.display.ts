import { GoogleBooksIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

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

export const GoogleBooksBlockMeta = {
  tags: ['google-workspace', 'knowledge-base', 'content-management'],
  url: 'https://books.google.com',
  templates: [
    {
      icon: GoogleBooksIcon,
      title: 'Google Books citation finder',
      prompt:
        'Build a workflow that takes a topic, queries Google Books for relevant titles and quotes, and writes a citations bibliography file for research papers.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research', 'content'],
    },
    {
      icon: GoogleBooksIcon,
      title: 'Google Books reading list builder',
      prompt:
        'Create a workflow that takes a topic, finds top-rated Google Books titles, writes a curated reading-list file with summaries, and emails it to the user.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'research'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: GoogleBooksIcon,
      title: 'Google Books research enricher',
      prompt:
        'Build a workflow that for each topic in a research table queries Google Books for foundational works, captures the key passages, and writes them to a knowledge base.',
      modules: ['knowledge-base', 'tables', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'sync'],
    },
    {
      icon: GoogleBooksIcon,
      title: 'Google Books quote miner',
      prompt:
        'Create a workflow that searches Google Books for quotes on a topic, scores by relevance, and writes the top quotes to a marketing content table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
    },
    {
      icon: GoogleBooksIcon,
      title: 'Google Books bibliographic agent',
      prompt:
        'Build a research agent that uses Google Books as one of its tools to find canonical sources and properly cite them in answers with ISBN and page references.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research'],
    },
    {
      icon: GoogleBooksIcon,
      title: 'Google Books due-diligence helper',
      prompt:
        'Create a workflow that for a tracked person or company searches Google Books for prior publications and citations, and writes the findings to a CRM intel record.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: GoogleBooksIcon,
      title: 'Google Books topic explorer',
      prompt:
        'Build an agent that explores a topic across Google Books, identifies adjacent themes from book metadata, and writes a topic map to a research file.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research'],
    },
  ],
  skills: [
    {
      name: 'find-books-on-topic',
      description:
        'Search Google Books for the most relevant titles on a topic and return a ranked, summarized list.',
      content:
        '# Find Books on a Topic\n\nUse Google Books to discover authoritative titles for a subject and present a clean shortlist.\n\n## Steps\n1. Take the topic or question from the request.\n2. Run a Search Volumes operation with a focused query. Use field operators when helpful: `intitle:`, `inauthor:`, `subject:`. Set Order By to `relevance` (or `newest` for recent works).\n3. Set Max Results (1-40) and optionally filter by Print Type (books) or eBook availability.\n4. For the top hits, read title, authors, publisher, published date, average rating, and a short description.\n5. Rank by relevance and rating; drop clearly off-topic results.\n\n## Output\nA numbered list of up to 10 books, each with title, author(s), year, rating (if present), one-line summary, and the preview/info link. Note if a result set is thin so the requester can broaden the query.',
    },
    {
      name: 'lookup-book-by-isbn',
      description:
        'Resolve an ISBN or title into a single canonical book record with full metadata.',
      content:
        '# Look Up a Book by ISBN or Title\n\nResolve a specific book to its canonical Google Books record.\n\n## Steps\n1. If you have an ISBN, run Search Volumes with query `isbn:<the isbn>`. Otherwise search by `intitle:` plus `inauthor:` to disambiguate.\n2. Pick the best-matching volume and capture its volume ID.\n3. Run Get Volume Details on that volume ID for the fullest metadata.\n4. Collect title, subtitle, authors, publisher, published date, page count, categories, language, ISBN-10/13, and description.\n\n## Output\nA single structured record: title, authors, publisher, year, ISBNs, page count, categories, and the info link. If multiple editions match, list them and flag which is most likely intended.',
    },
    {
      name: 'build-reading-list',
      description:
        'Assemble a curated, themed reading list with summaries from Google Books search results.',
      content:
        '# Build a Reading List\n\nTurn a topic into a curated reading list a person can act on.\n\n## Steps\n1. Identify the theme and any constraints (level, recency, language) from the request.\n2. Run one or more Search Volumes queries covering the main subtopics; use `langRestrict` and `orderBy` as needed.\n3. For each candidate, capture authors, year, rating, and description.\n4. Deduplicate editions of the same work and keep the best edition.\n5. Group the final picks into 2-4 logical sections (e.g., foundational, advanced, recent).\n\n## Output\nA grouped reading list. Each entry: title, author(s), year, a one-sentence reason it is included, and the preview link. Keep it to 8-15 titles unless asked otherwise.',
    },
  ],
} as const satisfies BlockMeta
