import { RedditIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const RedditBlockDisplay = {
  type: 'reddit',
  name: 'Reddit',
  description: 'Access Reddit data and content',
  category: 'tools',
  bgColor: '#FF5700',
  icon: RedditIcon,
  iconColor: '#FF5700',
  longDescription:
    'Integrate Reddit into workflows. Read posts, comments, and search content. Submit posts, vote, reply, edit, manage messages, and access user and subreddit info.',
  docsLink: 'https://docs.sim.ai/integrations/reddit',
  integrationType: IntegrationType.Communication,
} satisfies BlockDisplay

export const RedditBlockMeta = {
  tags: ['content-management', 'web-scraping'],
  url: 'https://www.reddit.com',
  templates: [
    {
      icon: RedditIcon,
      title: 'Social mention tracker',
      prompt:
        'Create a scheduled workflow that monitors Reddit and X for mentions of my brand and competitors, scores each mention by sentiment and reach, logs them to a table, and sends a daily Slack digest of notable mentions.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring', 'analysis'],
      alsoIntegrations: ['x', 'slack'],
    },
    {
      icon: RedditIcon,
      title: 'Reddit subreddit monitor',
      prompt:
        'Build a scheduled workflow that uses Reddit to watch target subreddits for posts matching brand or product keywords, scores each for relevance and sentiment, and posts notable hits to Slack with the original link.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RedditIcon,
      title: 'Reddit user-question knowledge mining',
      prompt:
        'Create a workflow that pulls top questions from Reddit industry subreddits weekly, classifies by theme, and writes a content-opportunity table the marketing team can prioritize.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: RedditIcon,
      title: 'Reddit AMA preparer',
      prompt:
        'Build a workflow that aggregates top Reddit AMA-style questions for a topic, clusters them, drafts polished answers using a knowledge base, and posts a Q&A document for review.',
      modules: ['knowledge-base', 'agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
    },
    {
      icon: RedditIcon,
      title: 'Reddit competitor watch',
      prompt:
        'Create a scheduled workflow that monitors Reddit threads mentioning competitors weekly, summarizes sentiment and pain points, and writes a competitive intelligence note to a tracking table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: RedditIcon,
      title: 'Reddit crisis-signal alerter',
      prompt:
        'Build a scheduled workflow that polls Reddit for sudden bursts of negative posts about the brand, classifies severity, and pages the PR team via Slack and PagerDuty when a real crisis emerges.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack', 'pagerduty'],
    },
    {
      icon: RedditIcon,
      title: 'Reddit content-idea collector',
      prompt:
        'Create a scheduled workflow that polls marketing-relevant Reddit subreddits, captures upvoted long-form posts, summarizes each, and adds them to a content-ideas table with effort and impact scores.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
    },
  ],
  skills: [
    {
      name: 'monitor-subreddit-mentions',
      description:
        'Search a subreddit for brand or keyword mentions and summarize what people say.',
      content:
        '# Monitor Subreddit Mentions\n\nTrack what people say about a topic on Reddit.\n\n## Steps\n1. Run search with the brand or keyword query, scoped to the relevant subreddit when appropriate.\n2. For high-signal threads, run get_comments to pull the discussion.\n3. Summarize sentiment, recurring themes, and notable complaints or praise.\n4. Route urgent or negative threads to the right channel.\n\n## Output\nReturn a digest of top mentions with links, sentiment, and key takeaways.',
    },
    {
      name: 'surface-trending-posts',
      description:
        'Pull top and controversial posts from a subreddit for a content or research brief.',
      content:
        '# Surface Trending Posts\n\nFind what is rising and contentious in a community.\n\n## Steps\n1. Run get_posts for the subreddit using a hot or top sort to capture momentum.\n2. Run get_controversial to surface divisive discussions.\n3. Read get_comments on the standouts for context.\n4. Cluster the posts into themes.\n\n## Output\nReturn a ranked brief of trending and controversial posts with titles, links, and a one-line takeaway each.',
    },
    {
      name: 'reply-to-mention',
      description: 'Draft and post a helpful, on-brand reply to a Reddit post or comment.',
      content:
        '# Reply To Mention\n\nRespond to a relevant Reddit thread.\n\n## Steps\n1. Read the target post or comment with get_posts or get_comments for full context.\n2. Draft a concise, non-promotional reply that adds genuine value.\n3. Run reply to post it on the chosen thread.\n4. Optionally save the thread for later follow-up.\n\n## Output\nReturn the posted reply text and a link to the comment. Respect subreddit rules and avoid spammy self-promotion.',
    },
    {
      name: 'submit-announcement-post',
      description: 'Submit a new post to a target subreddit for an announcement or launch.',
      content:
        '# Submit Announcement Post\n\nShare an announcement on Reddit.\n\n## Steps\n1. Run get_subreddit_rules to confirm the target subreddit allows the post type and self-promotion.\n2. Run submit_post with a clear title and body tailored to the community.\n3. Capture the returned post id and link.\n4. Monitor early get_comments and respond to questions.\n\n## Output\nReturn the new post link and an initial engagement check.',
    },
    {
      name: 'research-a-redditor',
      description: 'Profile a Reddit user from their public posts, comments, and karma.',
      content:
        '# Research A Redditor\n\nBuild a picture of a Reddit user for vetting or community research.\n\n## Steps\n1. Run get_user to pull profile, karma, and account age.\n2. Run get_user_posts and get_user_comments to sample their recent activity.\n3. Identify the subreddits, topics, and tone they engage with most.\n4. Flag anything notable (expertise, affiliations, red flags).\n\n## Output\nReturn a short profile: account summary, top communities, themes, and a sample of representative posts/comments with links.',
    },
    {
      name: 'discover-communities',
      description: 'Find the most relevant subreddits for a topic before posting or monitoring.',
      content:
        '# Discover Communities\n\nLocate the right subreddits for a topic or campaign.\n\n## Steps\n1. Run search_subreddits with the topic keywords to find candidate communities.\n2. Run get_subreddit_info on the strongest matches to compare size and activity.\n3. Run get_subreddit_rules to check posting and self-promotion rules.\n4. Optionally run list_my_subreddits to see which you already follow.\n\n## Output\nReturn a ranked shortlist of subreddits with subscriber counts, activity, fit, and key rules.',
    },
    {
      name: 'manage-saved-research',
      description: 'Curate a research reading list from saved Reddit posts and comments.',
      content:
        '# Manage Saved Research\n\nTurn saved Reddit items into an organized research list.\n\n## Steps\n1. Run get_saved to pull your saved posts and comments.\n2. Run get_info to re-hydrate any specific fullnames you are tracking.\n3. Summarize and cluster the items by theme.\n4. Use save / unsave to keep the list current.\n\n## Output\nReturn a themed reading list with titles, links, and one-line summaries.',
    },
    {
      name: 'triage-mod-queue',
      description: 'Moderate a subreddit: review reported content and act on it against the rules.',
      content:
        '# Triage Mod Queue\n\nReview and action content in a subreddit you moderate.\n\n## Steps\n1. Run get_posts / get_comments to pull the content under review.\n2. Run get_subreddit_rules and evaluate each item against them.\n3. Take action: mod_approve to keep, mod_remove (optionally as spam) to remove, lock to stop replies, mod_distinguish or mod_sticky to highlight official posts.\n4. Log each decision and the rule it maps to.\n\n## Output\nReturn a decision list: item link, action taken, and the rule or reason. Only act on subreddits you moderate.',
    },
  ],
} as const satisfies BlockMeta
