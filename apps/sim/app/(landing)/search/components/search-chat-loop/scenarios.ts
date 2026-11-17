/** Fictional search examples for the marketing animation; no customer data. */
export const SEARCH_SCENARIOS = [
  {
    kind: 'chat',
    prompt: 'Find the launch plan and summarize the next steps.',
    activity: 'Searching company files…',
    sources: ['Launch plan.pdf', 'Product brief.docx'],
    reply:
      'The launch plan has three next steps: finish the product review, prepare the team, and confirm the launch date. The product brief covers the scope and owners for each milestone.',
  },
  {
    kind: 'files',
    prompt: 'Find the files for our product launch.',
    activity: 'Searching company files…',
    query: 'Product launch',
    files: [
      { name: 'Launch plan.pdf', size: '1.2 MB', owner: 'Morgan' },
      { name: 'Product brief.docx', size: '324 KB', owner: 'Alex' },
      { name: 'Launch checklist.pdf', size: '640 KB', owner: 'Jordan' },
    ],
  },
  {
    kind: 'chat',
    prompt: 'What is our process for onboarding a new teammate?',
    activity: 'Reading company knowledge…',
    sources: ['Onboarding guide.pdf', 'Team handbook.docx'],
    reply:
      'Start with the onboarding checklist: request access, schedule a team introduction, and review the team handbook. The first-week guide brings the setup steps and useful links together.',
  },
  {
    kind: 'files',
    prompt: 'Show me our onboarding documents.',
    activity: 'Finding onboarding files…',
    query: 'Onboarding',
    files: [
      { name: 'Onboarding guide.pdf', size: '864 KB', owner: 'Alex' },
      { name: 'Team handbook.docx', size: '428 KB', owner: 'Morgan' },
      { name: 'First-week checklist.pdf', size: '218 KB', owner: 'Jordan' },
    ],
  },
] as const
