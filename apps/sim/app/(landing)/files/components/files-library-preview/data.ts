export interface LibraryFile {
  id: string
  name: string
  type: string
  size: string
  title: string
  excerpt: string
  owner: string
  created: string
}

export const FILES: readonly LibraryFile[] = [
  {
    id: 'weekly-report',
    name: 'Weekly report.md',
    type: 'Markdown',
    size: '24 KB',
    title: 'A week of progress.',
    excerpt:
      'Campaign results, customer conversations, and the next steps for the team. All in one place.',
    owner: 'Morgan Lee',
    created: 'Sep 4',
  },
  {
    id: 'brand-guidelines',
    name: 'Brand guidelines.pdf',
    type: 'PDF',
    size: '1.2 MB',
    title: 'Make every detail count.',
    excerpt:
      'The colors, typography, and voice that bring our brand to life. A shared reference for every project.',
    owner: 'Morgan Lee',
    created: 'Sep 4',
  },
  {
    id: 'product-brief',
    name: 'Product brief.docx',
    type: 'Document',
    size: '324 KB',
    title: 'The next chapter.',
    excerpt: 'What we are building, who it is for, and how the team will bring it to market.',
    owner: 'Alex Chen',
    created: 'Sep 3',
  },
  {
    id: 'research',
    name: 'Research notes.pdf',
    type: 'PDF',
    size: '860 KB',
    title: 'Start with the people.',
    excerpt:
      'Notes from five customer conversations, the patterns we heard, and the opportunities worth exploring.',
    owner: 'Alex Chen',
    created: 'Sep 3',
  },
  {
    id: 'campaign',
    name: 'Campaign summary.md',
    type: 'Markdown',
    size: '18 KB',
    title: 'From launch to learning.',
    excerpt:
      'A look at what reached the right people, which messages resonated, and what to try next.',
    owner: 'Morgan Lee',
    created: 'Sep 2',
  },
  {
    id: 'voice',
    name: 'Voice and tone.md',
    type: 'Markdown',
    size: '12 KB',
    title: 'Clear, useful, human.',
    excerpt:
      'Write with purpose. Keep sentences direct, make the details concrete, and help people take the next step.',
    owner: 'Morgan Lee',
    created: 'Sep 2',
  },
]
