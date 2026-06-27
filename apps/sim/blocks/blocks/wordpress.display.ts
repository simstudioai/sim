import { WordpressIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const WordPressBlockDisplay = {
  type: 'wordpress',
  name: 'WordPress',
  description: 'Manage WordPress content',
  category: 'tools',
  bgColor: '#21759B',
  icon: WordpressIcon,
  iconColor: '#21759B',
  longDescription:
    'Integrate with WordPress to create, update, and manage posts, pages, media, comments, categories, tags, and users. Supports WordPress.com sites via OAuth and self-hosted WordPress sites using Application Passwords authentication.',
  docsLink: 'https://docs.sim.ai/integrations/wordpress',
  integrationType: IntegrationType.Marketing,
} satisfies BlockDisplay

export const WordPressBlockMeta = {
  tags: ['content-management', 'seo'],
  url: 'https://wordpress.org',
  templates: [
    {
      icon: WordpressIcon,
      title: 'Blog auto-publisher',
      prompt:
        'Build a workflow that takes a draft document, optimizes it for SEO by researching target keywords, formats it for WordPress with proper headings and meta description, and publishes it as a draft post for final review.',
      modules: ['agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content', 'automation'],
    },
    {
      icon: WordpressIcon,
      title: 'WordPress release-notes publisher',
      prompt:
        'Create a scheduled workflow that runs every Friday, pulls merged GitHub PRs for the week, drafts a user-facing changelog, and publishes it as a WordPress post.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'engineering'],
      alsoIntegrations: ['github'],
    },
    {
      icon: WordpressIcon,
      title: 'WordPress comment moderator',
      prompt:
        'Build a scheduled workflow that polls new WordPress comments, classifies each as spam, question, or constructive, auto-moderates spam, and replies to questions using a knowledge base.',
      modules: ['scheduled', 'knowledge-base', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: WordpressIcon,
      title: 'WordPress SEO refresher',
      prompt:
        'Create a scheduled monthly workflow that finds underperforming WordPress posts, runs Ahrefs keyword analysis, drafts refreshed sections, and stages the update as a draft revision.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
      alsoIntegrations: ['ahrefs'],
    },
    {
      icon: WordpressIcon,
      title: 'WordPress newsletter republisher',
      prompt:
        'Build a workflow that publishes a new WordPress post and then drafts an adapted Mailchimp newsletter version, links back to the post, and queues it for the editor’s review.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'communication'],
      alsoIntegrations: ['mailchimp'],
    },
    {
      icon: WordpressIcon,
      title: 'WordPress broken-link sweeper',
      prompt:
        'Create a scheduled workflow that scans WordPress posts for broken outbound links, proposes replacement URLs via web search, and stages each as a draft revision for approval.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
    },
    {
      icon: WordpressIcon,
      title: 'WordPress media-rich post builder',
      prompt:
        'Build a workflow that takes a draft article and its image files, uploads each image to the WordPress media library, generates a hero image with an image generator, assigns the right categories and tags, and publishes the fully illustrated post as a draft for review.',
      modules: ['agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content', 'automation'],
    },
  ],
  skills: [
    {
      name: 'publish-blog-post',
      description:
        'Create a WordPress post from a draft, assign categories and tags, and set its publish state.',
      content:
        '# Publish a WordPress Post\n\nTurn a finished draft into a WordPress post.\n\n## Steps\n1. Prepare the title, body HTML, and excerpt for the post.\n2. Resolve or create the categories and tags by listing existing ones and matching by name.\n3. Decide the status: draft for review or publish to go live.\n4. Call the create-post operation with the content, taxonomy, and status.\n\n## Output\nReport the new post ID, status, and the post URL. List the categories and tags applied. If publishing directly, confirm the live link.',
    },
    {
      name: 'update-existing-post',
      description:
        'Find a WordPress post and update its content, status, or taxonomy without overwriting the rest.',
      content:
        '# Update a WordPress Post\n\nApply targeted edits to a published or draft post.\n\n## Steps\n1. Locate the post by ID, or list or search posts and match on title.\n2. Get the current post to know its existing content and metadata.\n3. Build an update containing only the fields that change, such as body, status, or tags.\n4. Call the update-post operation and confirm the change.\n\n## Output\nState which fields changed and the post ID. Confirm the resulting status and URL.',
    },
    {
      name: 'upload-and-attach-media',
      description: 'Upload an image or file to the WordPress media library for use in a post.',
      content:
        '# Upload Media to WordPress\n\nAdd an image or file to the media library.\n\n## Steps\n1. Provide the file to upload along with a descriptive title and alt text.\n2. Call the upload-media operation.\n3. Capture the returned media ID and source URL.\n4. If the media is for a specific post, reference the media ID or URL when creating or updating that post.\n\n## Output\nReturn the media ID, the file URL, and the alt text set. Note whether it was attached to a post.',
    },
    {
      name: 'moderate-comments',
      description:
        'List recent WordPress comments and approve, hold, spam, or trash them by policy.',
      content:
        '# Moderate WordPress Comments\n\nKeep the comment queue clean and on-policy.\n\n## Steps\n1. List comments, optionally filtering by status such as hold.\n2. For each comment, judge it against the moderation policy: legitimate, spam, or abusive.\n3. Update each comment to the right status: approved, hold, spam, or trash.\n\n## Output\nReturn a summary of how many comments were approved, held, marked spam, or trashed, with the comment IDs grouped by action taken.',
    },
  ],
} as const satisfies BlockMeta
