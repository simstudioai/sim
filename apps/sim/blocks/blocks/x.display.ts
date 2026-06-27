import { xIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const XBlockDisplay = {
  type: 'x',
  name: 'X',
  description: 'Interact with X',
  category: 'tools',
  bgColor: '#000000',
  icon: xIcon,
  longDescription:
    'Integrate X into the workflow. Search tweets, manage bookmarks, follow/block/mute users, like and retweet, view trends, and more.',
  docsLink: 'https://docs.sim.ai/integrations/x',
  integrationType: IntegrationType.Communication,
} satisfies BlockDisplay

export const XBlockMeta = {
  tags: ['marketing', 'messaging'],
  url: 'https://x.com',
  templates: [
    {
      icon: xIcon,
      title: 'X (Twitter) brand mention triage',
      prompt:
        'Build a scheduled workflow that polls X mentions of the brand, classifies each as praise, support request, or complaint, and routes complaints to the support team with one-tap context.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'support'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: xIcon,
      title: 'X engagement digest',
      prompt:
        'Create a scheduled daily workflow that summarizes top X engagement on the brand account, identifies high-influence engagers, and writes them to a sales-prospect table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'sales'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: xIcon,
      title: 'X content scheduler',
      prompt:
        'Build a workflow that reads a tables-based X content calendar and posts scheduled tweets with media at the right time, retrying transient failures.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: xIcon,
      title: 'X thread expander',
      prompt:
        'Create a workflow that takes a long-form article or blog and drafts a multi-tweet X thread with hooks, key points, and a call-to-action, then queues it for review before posting.',
      modules: ['agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
    },
    {
      icon: xIcon,
      title: 'X competitor watcher',
      prompt:
        'Build a scheduled workflow that tracks tweets from competitor handles and key industry voices, captures notable posts in a table, and surfaces high-engagement items to Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: xIcon,
      title: 'X support ticket creator',
      prompt:
        'Create a scheduled workflow that polls X for tweets directed at the brand support handle, classifies each as a support request, and opens a Zendesk ticket with the tweet context and customer profile.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication'],
      alsoIntegrations: ['zendesk'],
    },
    {
      icon: xIcon,
      title: 'X bookmark research digest',
      prompt:
        'Create a scheduled weekly workflow that pulls my saved X bookmarks, fetches the full text of each bookmarked tweet, groups them by theme, writes a curated reading digest, and emails it to me before clearing the processed bookmarks.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research', 'content', 'individual'],
    },
  ],
  skills: [
    {
      name: 'post-tweet',
      description:
        'Compose and publish a tweet on X, optionally as a reply or with reply restrictions.',
      content:
        '# Post a Tweet on X\n\nPublish a single tweet or a reply.\n\n## Steps\n1. Draft the tweet text, keeping it within the character limit and on-brand.\n2. If it is a reply, identify the tweet ID being replied to. Set reply restrictions if the post should be limited to following or mentioned users.\n3. Call the create-tweet operation.\n4. Capture the returned tweet ID.\n\n## Output\nReturn the posted tweet text and its tweet ID with a link. Confirm whether it was a standalone post or a reply.',
    },
    {
      name: 'monitor-mentions',
      description: 'Fetch recent mentions of a user on X and summarize what needs a response.',
      content:
        '# Monitor X Mentions\n\nTrack who is talking to a profile and surface what matters.\n\n## Steps\n1. Resolve the target user, using get-my-profile or search-users to confirm the user ID.\n2. Call get-user-mentions to fetch recent mentions.\n3. Classify each mention: question, complaint, praise, or noise.\n4. Highlight mentions that need a reply.\n\n## Output\nReturn a grouped summary of mentions by type, with the tweet IDs and authors for any that need a human response, ranked by urgency.',
    },
    {
      name: 'search-and-analyze-tweets',
      description:
        'Search X for tweets matching a query and summarize themes, sentiment, and notable posts.',
      content:
        '# Search and Analyze Tweets on X\n\nUnderstand the conversation around a topic or keyword.\n\n## Steps\n1. Build a focused search query and choose recency or relevancy sorting.\n2. Call search-tweets with a sensible result limit.\n3. Read the results and identify recurring themes, overall sentiment, and high-engagement posts.\n\n## Output\nReturn a short report: dominant themes, sentiment split, and a few notable tweets with their IDs. Note the query and time window covered.',
    },
    {
      name: 'curate-bookmarks-digest',
      description:
        'Pull saved X bookmarks, group them by theme, and produce a curated reading digest.',
      content:
        '# Curate an X Bookmarks Digest\n\nTurn saved bookmarks into an organized reading list.\n\n## Steps\n1. Call get-bookmarks to retrieve saved tweets.\n2. Fetch the full text of each bookmarked tweet where needed using get-tweets-by-IDs.\n3. Group the bookmarks by theme and write a short note on why each cluster matters.\n4. Optionally delete-bookmark for items once they are processed.\n\n## Output\nReturn a themed digest with each tweet linked by ID and a one-line takeaway per item. State how many bookmarks were processed.',
    },
  ],
} as const satisfies BlockMeta
