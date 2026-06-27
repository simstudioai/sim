import { ElevenLabsIcon, YouTubeIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const YouTubeBlockDisplay = {
  type: 'youtube',
  name: 'YouTube',
  description: 'Interact with YouTube videos, channels, and playlists',
  category: 'tools',
  bgColor: '#FF0000',
  icon: YouTubeIcon,
  longDescription:
    'Integrate YouTube into the workflow. Can search for videos, get trending videos, get video details, get video categories, get channel information, get all videos from a channel, get channel playlists, get playlist items, and get video comments.',
  docsLink: 'https://docs.sim.ai/integrations/youtube',
  integrationType: IntegrationType.Communication,
} satisfies BlockDisplay

export const YouTubeBlockMeta = {
  tags: ['marketing', 'content-management'],
  url: 'https://www.youtube.com',
  templates: [
    {
      icon: YouTubeIcon,
      title: 'Content repurposer',
      prompt:
        'Build a workflow that takes a YouTube video URL, pulls the video details and description, researches the topic on the web for additional context, and generates a Twitter thread, LinkedIn post, and blog summary optimized for each platform.',
      modules: ['agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content', 'automation'],
    },
    {
      icon: ElevenLabsIcon,
      title: 'YouTube video audio brief',
      prompt:
        'Build a workflow that takes a YouTube URL, pulls the video details and top comments, summarizes them with an agent, narrates the summary with ElevenLabs, and saves the audio file for distribution.',
      modules: ['agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['content', 'automation'],
      alsoIntegrations: ['elevenlabs'],
    },
    {
      icon: YouTubeIcon,
      title: 'YouTube channel performance digest',
      prompt:
        'Create a scheduled weekly workflow that pulls a YouTube channel’s public stats and recent videos, ranks the top performers by views, writes a digest file, and emails it to the content team.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: YouTubeIcon,
      title: 'YouTube comment triage',
      prompt:
        'Build a scheduled workflow that pulls recent YouTube comments on a video, classifies each as helpful, question, or spam, drafts suggested answers to questions using a knowledge base, and routes them to the community team in Slack for review.',
      modules: ['scheduled', 'knowledge-base', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'community'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: YouTubeIcon,
      title: 'YouTube upload-to-blog',
      prompt:
        'Create a scheduled workflow that polls a YouTube channel for new uploads, pulls each video’s details and description, generates a long-form blog post with proper SEO structure, and stages it as a WordPress draft.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
      alsoIntegrations: ['wordpress'],
    },
    {
      icon: YouTubeIcon,
      title: 'YouTube competitor watcher',
      prompt:
        'Build a scheduled workflow that monitors competitor YouTube channels, flags videos that exceed average performance, and writes outline of their format to a content-research table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: YouTubeIcon,
      title: 'YouTube video curation finder',
      prompt:
        'Create a workflow that reads a tables-based topic list, finds matching YouTube videos via search, scores each for relevance, writes the candidates back to the table, and pings the editorial team for the final cut.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
    },
    {
      icon: YouTubeIcon,
      title: 'YouTube video recap to Notion',
      prompt:
        'Build a workflow that takes a YouTube video URL, pulls the video details, description, and top comments, summarizes the highlights and audience reaction, and saves a recap to a Notion page for the marketing team.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
      alsoIntegrations: ['notion'],
    },
  ],
  skills: [
    {
      name: 'find-videos-on-topic',
      description:
        'Search YouTube for videos on a topic with filters for duration, recency, and quality.',
      content:
        '# Find YouTube Videos on a Topic\n\nSurface the most relevant videos for a subject.\n\n## Steps\n1. Build a search query and choose filters: order (relevance, date, view count), duration, and definition.\n2. Call the search operation with a result limit.\n3. For promising results, get video details to read title, channel, view count, and publish date.\n4. Rank the results by relevance and signal.\n\n## Output\nReturn a ranked list of videos with title, channel, URL, view count, and publish date. Note the query and filters applied.',
    },
    {
      name: 'analyze-channel',
      description:
        'Pull a YouTube channel profile and recent uploads to summarize its content and cadence.',
      content:
        '# Analyze a YouTube Channel\n\nProfile a channel and its recent output.\n\n## Steps\n1. Get channel info to retrieve subscriber count, total views, and description.\n2. Get channel videos to list recent uploads.\n3. Summarize the content themes, upload cadence, and the best-performing recent videos.\n\n## Output\nReturn a channel summary with key stats, dominant content themes, posting frequency, and the top recent videos by views. Cite the channel and video IDs used.',
    },
    {
      name: 'summarize-video-comments',
      description:
        'Fetch comments on a YouTube video and summarize sentiment, questions, and recurring feedback.',
      content:
        '# Summarize YouTube Video Comments\n\nUnderstand audience reaction to a video.\n\n## Steps\n1. Identify the video ID, searching or using video details if only a title is known.\n2. Call the comments operation to fetch top or recent comments.\n3. Group comments into sentiment, recurring questions, and feature or content requests.\n\n## Output\nReturn a summary with sentiment breakdown, the most common questions, and notable feedback themes. Quote a few representative comments and cite the video ID.',
    },
  ],
} as const satisfies BlockMeta
