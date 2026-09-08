/** The seeded prompt shared by the opening composer and its first suggested action. */
export const DEFAULT_USER_MESSAGE =
  'When a new lead signs up, enrich it with company data and post it to #sales.'

/** The seeded reply, so the hero and the platform card tell one story. */
export const DEFAULT_REPLY_MESSAGE =
  'Built Lead enrichment — it enriches each signup, scores company fit, posts qualified leads to Slack, and saves the full record to Tables.\n\nThe workflow is ready to test with a sample lead.'

export const PREVIEW_SUGGESTIONS = [
  { title: 'Enrich new leads', prompt: DEFAULT_USER_MESSAGE },
  {
    title: 'Post deal alerts to #sales',
    prompt: 'Post an alert to #sales when a qualified lead is ready for follow-up.',
  },
  {
    title: 'Build a weekly pipeline report',
    prompt: 'Summarize qualified leads and send a weekly pipeline report to the sales team.',
  },
] as const
