import { RedditIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { RedditResponse } from '@/tools/reddit/types'

export const RedditBlock: BlockConfig<RedditResponse> = {
  type: 'reddit',
  name: 'Reddit',
  description: 'Access Reddit data and content',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Reddit into workflows. Read posts, comments, and search content. Submit posts, vote, reply, edit, manage messages, and access user and subreddit info.',
  docsLink: 'https://docs.sim.ai/integrations/reddit',
  category: 'tools',
  integrationType: IntegrationType.Communication,
  bgColor: '#FF5700',
  iconColor: '#FF5700',
  icon: RedditIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Posts', id: 'get_posts' },
        { label: 'Get Comments', id: 'get_comments' },
        { label: 'Get Controversial Posts', id: 'get_controversial' },
        { label: 'Search Subreddit', id: 'search' },
        { label: 'Submit Post', id: 'submit_post' },
        { label: 'Vote', id: 'vote' },
        { label: 'Save', id: 'save' },
        { label: 'Unsave', id: 'unsave' },
        { label: 'Reply', id: 'reply' },
        { label: 'Edit', id: 'edit' },
        { label: 'Delete', id: 'delete' },
        { label: 'Subscribe', id: 'subscribe' },
        { label: 'Get My Profile', id: 'get_me' },
        { label: 'Get User Profile', id: 'get_user' },
        { label: 'Send Message', id: 'send_message' },
        { label: 'Get Messages', id: 'get_messages' },
        { label: 'Get Subreddit Info', id: 'get_subreddit_info' },
        { label: 'Get Subreddit Rules', id: 'get_subreddit_rules' },
        { label: 'Get User Posts', id: 'get_user_posts' },
        { label: 'Get User Comments', id: 'get_user_comments' },
        { label: 'Get Saved Items', id: 'get_saved' },
        { label: 'Get Info by ID', id: 'get_info' },
        { label: 'Search Subreddits', id: 'search_subreddits' },
        { label: 'List My Subreddits', id: 'list_my_subreddits' },
        { label: 'Report', id: 'report' },
        { label: 'Hide', id: 'hide' },
        { label: 'Unhide', id: 'unhide' },
        { label: 'Mark NSFW', id: 'marknsfw' },
        { label: 'Unmark NSFW', id: 'unmarknsfw' },
        { label: 'Mark Messages Read', id: 'mark_read' },
        { label: 'Mark All Messages Read', id: 'mark_all_read' },
        { label: 'Approve (Mod)', id: 'mod_approve' },
        { label: 'Remove (Mod)', id: 'mod_remove' },
        { label: 'Distinguish (Mod)', id: 'mod_distinguish' },
        { label: 'Lock (Mod)', id: 'lock' },
        { label: 'Unlock (Mod)', id: 'unlock' },
        { label: 'Sticky (Mod)', id: 'mod_sticky' },
      ],
      value: () => 'get_posts',
    },

    {
      id: 'credential',
      title: 'Reddit Account',
      type: 'oauth-input',
      serviceId: 'reddit',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      requiredScopes: getScopesForService('reddit'),
      placeholder: 'Select Reddit account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Reddit Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },

    {
      id: 'subreddit',
      title: 'Subreddit',
      type: 'short-input',
      placeholder: 'Enter subreddit name (without r/)',
      condition: {
        field: 'operation',
        value: [
          'get_posts',
          'get_comments',
          'get_controversial',
          'search',
          'get_subreddit_info',
          'get_subreddit_rules',
        ],
      },
      required: true,
    },
    {
      id: 'sort',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Hot', id: 'hot' },
        { label: 'New', id: 'new' },
        { label: 'Top', id: 'top' },
        { label: 'Rising', id: 'rising' },
        { label: 'Controversial', id: 'controversial' },
      ],
      condition: { field: 'operation', value: 'get_posts' },
      value: () => 'hot',
      required: true,
    },
    {
      id: 'time',
      title: 'Time Filter',
      type: 'dropdown',
      options: [
        { label: 'Hour', id: 'hour' },
        { label: 'Day', id: 'day' },
        { label: 'Week', id: 'week' },
        { label: 'Month', id: 'month' },
        { label: 'Year', id: 'year' },
        { label: 'All Time', id: 'all' },
      ],
      condition: {
        field: 'operation',
        value: 'get_posts',
        and: { field: 'sort', value: ['top', 'controversial'] },
      },
    },
    {
      id: 'limit',
      title: 'Max Posts',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'get_posts' },
    },
    {
      id: 'after',
      title: 'After',
      type: 'short-input',
      placeholder: 'Fullname for forward pagination (e.g., t3_xxxxx)',
      condition: {
        field: 'operation',
        value: [
          'get_posts',
          'get_controversial',
          'search',
          'get_messages',
          'get_user_posts',
          'get_user_comments',
          'get_saved',
          'search_subreddits',
          'list_my_subreddits',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'before',
      title: 'Before',
      type: 'short-input',
      placeholder: 'Fullname for backward pagination (e.g., t3_xxxxx)',
      condition: {
        field: 'operation',
        value: [
          'get_posts',
          'get_controversial',
          'search',
          'get_messages',
          'get_user_posts',
          'get_user_comments',
          'get_saved',
          'search_subreddits',
          'list_my_subreddits',
        ],
      },
      mode: 'advanced',
    },

    {
      id: 'postId',
      title: 'Post ID',
      type: 'short-input',
      placeholder: 'Enter post ID (e.g., abc123)',
      condition: { field: 'operation', value: 'get_comments' },
      required: true,
    },
    {
      id: 'commentSort',
      title: 'Sort Comments By',
      type: 'dropdown',
      options: [
        { label: 'Best', id: 'confidence' },
        { label: 'Top', id: 'top' },
        { label: 'New', id: 'new' },
        { label: 'Controversial', id: 'controversial' },
        { label: 'Old', id: 'old' },
        { label: 'Random', id: 'random' },
        { label: 'Q&A', id: 'qa' },
      ],
      condition: { field: 'operation', value: 'get_comments' },
      value: () => 'confidence',
    },
    {
      id: 'commentLimit',
      title: 'Number of Comments',
      type: 'short-input',
      placeholder: '50',
      condition: { field: 'operation', value: 'get_comments' },
    },
    {
      id: 'commentDepth',
      title: 'Max Reply Depth',
      type: 'short-input',
      placeholder: 'Max depth of nested replies',
      condition: { field: 'operation', value: 'get_comments' },
      mode: 'advanced',
    },
    {
      id: 'commentFocus',
      title: 'Focus Comment ID',
      type: 'short-input',
      placeholder: 'ID36 of a specific comment to focus on',
      condition: { field: 'operation', value: 'get_comments' },
      mode: 'advanced',
    },

    {
      id: 'controversialTime',
      title: 'Time Filter',
      type: 'dropdown',
      options: [
        { label: 'Hour', id: 'hour' },
        { label: 'Day', id: 'day' },
        { label: 'Week', id: 'week' },
        { label: 'Month', id: 'month' },
        { label: 'Year', id: 'year' },
        { label: 'All Time', id: 'all' },
      ],
      condition: { field: 'operation', value: 'get_controversial' },
    },
    {
      id: 'controversialLimit',
      title: 'Max Posts',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'get_controversial' },
    },

    {
      id: 'searchQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter search query',
      condition: { field: 'operation', value: 'search' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a Reddit search query based on the user's description.

Reddit search supports:
- Simple text: "machine learning"
- Field searches: title:question, author:username, selftext:content, subreddit:name, url:example.com, site:example.com, flair:discussion
- Boolean operators: AND, OR, NOT (must be uppercase)
- Grouping with parentheses: (cats OR dogs) AND cute
- Exact phrases with quotes: "exact phrase"

Examples:
- "posts about AI from last month" -> artificial intelligence
- "questions about Python" -> title:question python
- "posts linking to github" -> site:github.com
- "posts by user spez" -> author:spez

Return ONLY the search query - no explanations, no extra text.`,
        placeholder: 'Describe what you want to search for...',
      },
    },
    {
      id: 'searchSort',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Relevance', id: 'relevance' },
        { label: 'Hot', id: 'hot' },
        { label: 'Top', id: 'top' },
        { label: 'New', id: 'new' },
        { label: 'Comments', id: 'comments' },
      ],
      condition: { field: 'operation', value: 'search' },
      value: () => 'relevance',
    },
    {
      id: 'searchTime',
      title: 'Time Filter',
      type: 'dropdown',
      options: [
        { label: 'Hour', id: 'hour' },
        { label: 'Day', id: 'day' },
        { label: 'Week', id: 'week' },
        { label: 'Month', id: 'month' },
        { label: 'Year', id: 'year' },
        { label: 'All Time', id: 'all' },
      ],
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'searchLimit',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'submitSubreddit',
      title: 'Subreddit',
      type: 'short-input',
      placeholder: 'Enter subreddit name (without r/)',
      condition: { field: 'operation', value: 'submit_post' },
      required: true,
    },
    {
      id: 'title',
      title: 'Post Title',
      type: 'short-input',
      placeholder: 'Enter post title (max 300 characters)',
      condition: { field: 'operation', value: 'submit_post' },
      required: true,
    },
    {
      id: 'postType',
      title: 'Post Type',
      type: 'dropdown',
      options: [
        { label: 'Text Post', id: 'text' },
        { label: 'Link Post', id: 'link' },
      ],
      condition: { field: 'operation', value: 'submit_post' },
      value: () => 'text',
      required: true,
    },
    {
      id: 'text',
      title: 'Post Text (Markdown)',
      type: 'long-input',
      placeholder: 'Enter post text in markdown format',
      condition: {
        field: 'operation',
        value: 'submit_post',
        and: { field: 'postType', value: 'text' },
      },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate Reddit post content in markdown format based on the user's description.

Reddit markdown supports:
- **bold**, *italic*, ~~strikethrough~~
- [links](url), ![images](url)
- > blockquotes
- - bullet lists, 1. numbered lists
- \`inline code\`, code blocks with triple backticks
- Headers with # (use sparingly)
- Horizontal rules with ---
- Tables with | pipes |
- Superscript with ^

Write engaging, well-formatted content appropriate for the subreddit context.
Return ONLY the markdown content - no meta-commentary.`,
        placeholder: 'Describe what your post should say...',
      },
    },
    {
      id: 'url',
      title: 'URL',
      type: 'short-input',
      placeholder: 'Enter URL to share',
      condition: {
        field: 'operation',
        value: 'submit_post',
        and: { field: 'postType', value: 'link' },
      },
    },
    {
      id: 'nsfw',
      title: 'Mark as NSFW',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      condition: { field: 'operation', value: 'submit_post' },
      value: () => 'false',
    },
    {
      id: 'spoiler',
      title: 'Mark as Spoiler',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      condition: { field: 'operation', value: 'submit_post' },
      value: () => 'false',
    },
    {
      id: 'flairId',
      title: 'Flair ID',
      type: 'short-input',
      placeholder: 'Flair template ID (max 36 characters)',
      condition: { field: 'operation', value: 'submit_post' },
      mode: 'advanced',
    },
    {
      id: 'flairText',
      title: 'Flair Text',
      type: 'short-input',
      placeholder: 'Flair text to display (max 64 characters)',
      condition: { field: 'operation', value: 'submit_post' },
      mode: 'advanced',
    },
    {
      id: 'sendReplies',
      title: 'Send Reply Notifications',
      type: 'dropdown',
      options: [
        { label: 'Yes (default)', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      condition: { field: 'operation', value: 'submit_post' },
      mode: 'advanced',
      value: () => 'true',
    },

    {
      id: 'voteId',
      title: 'Post/Comment ID',
      type: 'short-input',
      placeholder: 'Thing fullname (e.g., t3_xxxxx for post, t1_xxxxx for comment)',
      condition: { field: 'operation', value: 'vote' },
      required: true,
    },
    {
      id: 'voteDirection',
      title: 'Vote Direction',
      type: 'dropdown',
      options: [
        { label: 'Upvote', id: '1' },
        { label: 'Unvote', id: '0' },
        { label: 'Downvote', id: '-1' },
      ],
      condition: { field: 'operation', value: 'vote' },
      value: () => '1',
      required: true,
    },

    {
      id: 'saveId',
      title: 'Post/Comment ID',
      type: 'short-input',
      placeholder: 'Thing fullname (e.g., t3_xxxxx for post, t1_xxxxx for comment)',
      condition: { field: 'operation', value: ['save', 'unsave'] },
      required: true,
    },
    {
      id: 'saveCategory',
      title: 'Category',
      type: 'short-input',
      placeholder: 'Category name (Reddit Premium feature)',
      condition: { field: 'operation', value: 'save' },
      mode: 'advanced',
    },

    {
      id: 'replyParentId',
      title: 'Parent Post/Comment ID',
      type: 'short-input',
      placeholder: 'Thing fullname to reply to (e.g., t3_xxxxx or t1_xxxxx)',
      condition: { field: 'operation', value: 'reply' },
      required: true,
    },
    {
      id: 'replyText',
      title: 'Reply Text (Markdown)',
      type: 'long-input',
      placeholder: 'Enter reply text in markdown format',
      condition: { field: 'operation', value: 'reply' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate a Reddit comment reply in markdown format based on the user's description.

Reddit markdown supports:
- **bold**, *italic*, ~~strikethrough~~
- [links](url)
- > blockquotes (for quoting parent)
- - bullet lists, 1. numbered lists
- \`inline code\`, code blocks with triple backticks

Write a natural, conversational reply. Match the tone to the context.
Return ONLY the markdown content - no meta-commentary.`,
        placeholder: 'Describe what your reply should say...',
      },
    },

    {
      id: 'editThingId',
      title: 'Post/Comment ID',
      type: 'short-input',
      placeholder: 'Thing fullname to edit (e.g., t3_xxxxx or t1_xxxxx)',
      condition: { field: 'operation', value: 'edit' },
      required: true,
    },
    {
      id: 'editText',
      title: 'New Text (Markdown)',
      type: 'long-input',
      placeholder: 'Enter new text in markdown format',
      condition: { field: 'operation', value: 'edit' },
      required: true,
    },

    {
      id: 'deleteId',
      title: 'Post/Comment ID',
      type: 'short-input',
      placeholder: 'Thing fullname to delete (e.g., t3_xxxxx or t1_xxxxx)',
      condition: { field: 'operation', value: 'delete' },
      required: true,
    },

    {
      id: 'subscribeSubreddit',
      title: 'Subreddit',
      type: 'short-input',
      placeholder: 'Enter subreddit name (without r/)',
      condition: { field: 'operation', value: 'subscribe' },
      required: true,
    },
    {
      id: 'subscribeAction',
      title: 'Action',
      type: 'dropdown',
      options: [
        { label: 'Subscribe', id: 'sub' },
        { label: 'Unsubscribe', id: 'unsub' },
      ],
      condition: { field: 'operation', value: 'subscribe' },
      value: () => 'sub',
      required: true,
    },

    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'Reddit username (e.g., spez)',
      condition: { field: 'operation', value: 'get_user' },
      required: true,
    },

    {
      id: 'messageTo',
      title: 'Recipient',
      type: 'short-input',
      placeholder: 'Username or /r/subreddit',
      condition: { field: 'operation', value: 'send_message' },
      required: true,
    },
    {
      id: 'messageSubject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Message subject (max 100 characters)',
      condition: { field: 'operation', value: 'send_message' },
      required: true,
    },
    {
      id: 'messageText',
      title: 'Message Body (Markdown)',
      type: 'long-input',
      placeholder: 'Enter message in markdown format',
      condition: { field: 'operation', value: 'send_message' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a Reddit private message in markdown format based on the user's description.

Write a clear, polite message. Reddit markdown supports **bold**, *italic*, [links](url), > quotes, lists, and code blocks.
Return ONLY the message content - no meta-commentary.`,
        placeholder: 'Describe what your message should say...',
      },
    },
    {
      id: 'messageFromSr',
      title: 'Send From Subreddit',
      type: 'short-input',
      placeholder: 'Subreddit name (requires mod mail permission)',
      condition: { field: 'operation', value: 'send_message' },
      mode: 'advanced',
    },

    {
      id: 'messageWhere',
      title: 'Message Folder',
      type: 'dropdown',
      options: [
        { label: 'Inbox (all)', id: 'inbox' },
        { label: 'Unread', id: 'unread' },
        { label: 'Sent', id: 'sent' },
        { label: 'Direct Messages', id: 'messages' },
        { label: 'Comment Replies', id: 'comments' },
        { label: 'Self-Post Replies', id: 'selfreply' },
        { label: 'Username Mentions', id: 'mentions' },
      ],
      condition: { field: 'operation', value: 'get_messages' },
      value: () => 'inbox',
    },
    {
      id: 'messageLimit',
      title: 'Max Messages',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: 'get_messages' },
    },
    {
      id: 'messageMark',
      title: 'Mark as Read',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      condition: { field: 'operation', value: 'get_messages' },
      mode: 'advanced',
    },

    {
      id: 'userListUsername',
      title: 'Username',
      type: 'short-input',
      placeholder: 'Reddit username (use your own for Saved Items)',
      condition: {
        field: 'operation',
        value: ['get_user_posts', 'get_user_comments', 'get_saved'],
      },
      required: true,
    },
    {
      id: 'userListSort',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'New', id: 'new' },
        { label: 'Hot', id: 'hot' },
        { label: 'Top', id: 'top' },
        { label: 'Controversial', id: 'controversial' },
      ],
      condition: { field: 'operation', value: ['get_user_posts', 'get_user_comments'] },
      value: () => 'new',
    },
    {
      id: 'userListTime',
      title: 'Time Filter',
      type: 'dropdown',
      options: [
        { label: 'Hour', id: 'hour' },
        { label: 'Day', id: 'day' },
        { label: 'Week', id: 'week' },
        { label: 'Month', id: 'month' },
        { label: 'Year', id: 'year' },
        { label: 'All Time', id: 'all' },
      ],
      condition: {
        field: 'operation',
        value: ['get_user_posts', 'get_user_comments'],
        and: { field: 'userListSort', value: ['top', 'controversial'] },
      },
      mode: 'advanced',
    },
    {
      id: 'userListLimit',
      title: 'Max Items',
      type: 'short-input',
      placeholder: '25',
      condition: {
        field: 'operation',
        value: ['get_user_posts', 'get_user_comments', 'get_saved'],
      },
    },

    {
      id: 'infoIds',
      title: 'Thing Fullnames',
      type: 'short-input',
      placeholder: 'Comma-separated fullnames (e.g., t3_abc123,t1_xyz789,t5_2qh33)',
      condition: { field: 'operation', value: 'get_info' },
      required: true,
    },

    {
      id: 'searchSubredditsQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Search subreddits by name and description',
      condition: { field: 'operation', value: 'search_subreddits' },
      required: true,
    },
    {
      id: 'searchSubredditsSort',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Relevance', id: 'relevance' },
        { label: 'Activity', id: 'activity' },
      ],
      condition: { field: 'operation', value: 'search_subreddits' },
      value: () => 'relevance',
    },
    {
      id: 'searchSubredditsLimit',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: 'search_subreddits' },
    },

    {
      id: 'listMineLimit',
      title: 'Max Subreddits',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: 'list_my_subreddits' },
    },

    {
      id: 'reportThingId',
      title: 'Post/Comment ID',
      type: 'short-input',
      placeholder: 'Thing fullname to report (e.g., t3_xxxxx or t1_xxxxx)',
      condition: { field: 'operation', value: 'report' },
      required: true,
    },
    {
      id: 'reportReason',
      title: 'Reason',
      type: 'short-input',
      placeholder: 'Rule the content violates (max 100 characters)',
      condition: { field: 'operation', value: 'report' },
      mode: 'advanced',
    },
    {
      id: 'reportOtherReason',
      title: 'Custom Reason',
      type: 'short-input',
      placeholder: 'Free-form custom reason (max 100 characters)',
      condition: { field: 'operation', value: 'report' },
      mode: 'advanced',
    },

    {
      id: 'hideId',
      title: 'Post ID(s)',
      type: 'short-input',
      placeholder: 'Comma-separated post fullnames (e.g., t3_abc123,t3_def456)',
      condition: { field: 'operation', value: ['hide', 'unhide'] },
      required: true,
    },

    {
      id: 'nsfwId',
      title: 'Post ID',
      type: 'short-input',
      placeholder: 'Post fullname (e.g., t3_xxxxx)',
      condition: { field: 'operation', value: ['marknsfw', 'unmarknsfw'] },
      required: true,
    },

    {
      id: 'markReadId',
      title: 'Message ID(s)',
      type: 'short-input',
      placeholder: 'Comma-separated message fullnames (e.g., t4_abc123,t4_def456)',
      condition: { field: 'operation', value: 'mark_read' },
      required: true,
    },

    {
      id: 'modThingId',
      title: 'Post/Comment ID',
      type: 'short-input',
      placeholder: 'Thing fullname (e.g., t3_xxxxx for post, t1_xxxxx for comment)',
      condition: {
        field: 'operation',
        value: ['mod_approve', 'mod_remove', 'mod_distinguish', 'lock', 'unlock'],
      },
      required: true,
    },
    {
      id: 'removeSpam',
      title: 'Mark as Spam',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      condition: { field: 'operation', value: 'mod_remove' },
      value: () => 'false',
      mode: 'advanced',
    },
    {
      id: 'distinguishHow',
      title: 'Distinguish Type',
      type: 'dropdown',
      options: [
        { label: 'Moderator', id: 'yes' },
        { label: 'Remove Distinction', id: 'no' },
        { label: 'Admin', id: 'admin' },
        { label: 'Special', id: 'special' },
      ],
      condition: { field: 'operation', value: 'mod_distinguish' },
      value: () => 'yes',
      required: true,
    },
    {
      id: 'distinguishSticky',
      title: 'Sticky Comment',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      condition: { field: 'operation', value: 'mod_distinguish' },
      mode: 'advanced',
    },

    {
      id: 'stickyId',
      title: 'Post ID',
      type: 'short-input',
      placeholder: 'Post fullname (e.g., t3_xxxxx)',
      condition: { field: 'operation', value: 'mod_sticky' },
      required: true,
    },
    {
      id: 'stickyState',
      title: 'Action',
      type: 'dropdown',
      options: [
        { label: 'Sticky', id: 'true' },
        { label: 'Unsticky', id: 'false' },
      ],
      condition: { field: 'operation', value: 'mod_sticky' },
      value: () => 'true',
      required: true,
    },
    {
      id: 'stickyNum',
      title: 'Sticky Slot',
      type: 'short-input',
      placeholder: 'Slot 1-4 (1 is top). Only applies when stickying',
      condition: { field: 'operation', value: 'mod_sticky' },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'reddit_get_posts',
      'reddit_get_comments',
      'reddit_get_controversial',
      'reddit_search',
      'reddit_submit_post',
      'reddit_vote',
      'reddit_save',
      'reddit_unsave',
      'reddit_reply',
      'reddit_edit',
      'reddit_delete',
      'reddit_subscribe',
      'reddit_get_me',
      'reddit_get_user',
      'reddit_send_message',
      'reddit_get_messages',
      'reddit_get_subreddit_info',
      'reddit_get_subreddit_rules',
      'reddit_get_user_posts',
      'reddit_get_user_comments',
      'reddit_get_saved',
      'reddit_get_info',
      'reddit_search_subreddits',
      'reddit_list_my_subreddits',
      'reddit_report',
      'reddit_hide',
      'reddit_unhide',
      'reddit_marknsfw',
      'reddit_unmarknsfw',
      'reddit_mark_read',
      'reddit_mark_all_read',
      'reddit_mod_approve',
      'reddit_mod_remove',
      'reddit_mod_distinguish',
      'reddit_lock',
      'reddit_unlock',
      'reddit_mod_sticky',
    ],
    config: {
      tool: (inputs) => {
        const operation = inputs.operation || 'get_posts'
        const toolMap: Record<string, string> = {
          get_posts: 'reddit_get_posts',
          get_comments: 'reddit_get_comments',
          get_controversial: 'reddit_get_controversial',
          search: 'reddit_search',
          submit_post: 'reddit_submit_post',
          vote: 'reddit_vote',
          save: 'reddit_save',
          unsave: 'reddit_unsave',
          reply: 'reddit_reply',
          edit: 'reddit_edit',
          delete: 'reddit_delete',
          subscribe: 'reddit_subscribe',
          get_me: 'reddit_get_me',
          get_user: 'reddit_get_user',
          send_message: 'reddit_send_message',
          get_messages: 'reddit_get_messages',
          get_subreddit_info: 'reddit_get_subreddit_info',
          get_subreddit_rules: 'reddit_get_subreddit_rules',
          get_user_posts: 'reddit_get_user_posts',
          get_user_comments: 'reddit_get_user_comments',
          get_saved: 'reddit_get_saved',
          get_info: 'reddit_get_info',
          search_subreddits: 'reddit_search_subreddits',
          list_my_subreddits: 'reddit_list_my_subreddits',
          report: 'reddit_report',
          hide: 'reddit_hide',
          unhide: 'reddit_unhide',
          marknsfw: 'reddit_marknsfw',
          unmarknsfw: 'reddit_unmarknsfw',
          mark_read: 'reddit_mark_read',
          mark_all_read: 'reddit_mark_all_read',
          mod_approve: 'reddit_mod_approve',
          mod_remove: 'reddit_mod_remove',
          mod_distinguish: 'reddit_mod_distinguish',
          lock: 'reddit_lock',
          unlock: 'reddit_unlock',
          mod_sticky: 'reddit_mod_sticky',
        }
        return toolMap[operation] || 'reddit_get_posts'
      },
      params: (inputs) => {
        const operation = inputs.operation || 'get_posts'
        const { oauthCredential } = inputs

        if (operation === 'get_posts') {
          return {
            subreddit: inputs.subreddit,
            sort: inputs.sort,
            time:
              inputs.sort === 'top' || inputs.sort === 'controversial' ? inputs.time : undefined,
            limit: inputs.limit ? Number.parseInt(inputs.limit) : undefined,
            after: inputs.after || undefined,
            before: inputs.before || undefined,
            oauthCredential,
          }
        }

        if (operation === 'get_comments') {
          return {
            postId: inputs.postId,
            subreddit: inputs.subreddit,
            sort: inputs.commentSort,
            limit: inputs.commentLimit ? Number.parseInt(inputs.commentLimit) : undefined,
            depth: inputs.commentDepth ? Number.parseInt(inputs.commentDepth) : undefined,
            comment: inputs.commentFocus || undefined,
            oauthCredential,
          }
        }

        if (operation === 'get_controversial') {
          return {
            subreddit: inputs.subreddit,
            time: inputs.controversialTime,
            limit: inputs.controversialLimit
              ? Number.parseInt(inputs.controversialLimit)
              : undefined,
            after: inputs.after || undefined,
            before: inputs.before || undefined,
            oauthCredential,
          }
        }

        if (operation === 'search') {
          return {
            subreddit: inputs.subreddit,
            query: inputs.searchQuery,
            sort: inputs.searchSort,
            time: inputs.searchTime,
            limit: inputs.searchLimit ? Number.parseInt(inputs.searchLimit) : undefined,
            after: inputs.after || undefined,
            before: inputs.before || undefined,
            oauthCredential,
          }
        }

        if (operation === 'submit_post') {
          return {
            subreddit: inputs.submitSubreddit,
            title: inputs.title,
            text: inputs.postType === 'text' ? inputs.text : undefined,
            url: inputs.postType === 'link' ? inputs.url : undefined,
            nsfw: inputs.nsfw === 'true',
            spoiler: inputs.spoiler === 'true',
            send_replies:
              inputs.sendReplies !== undefined ? inputs.sendReplies === 'true' : undefined,
            flair_id: inputs.flairId || undefined,
            flair_text: inputs.flairText || undefined,
            oauthCredential,
          }
        }

        if (operation === 'vote') {
          return {
            id: inputs.voteId,
            dir: Number.parseInt(inputs.voteDirection),
            oauthCredential,
          }
        }

        if (operation === 'save') {
          return {
            id: inputs.saveId,
            category: inputs.saveCategory || undefined,
            oauthCredential,
          }
        }

        if (operation === 'unsave') {
          return {
            id: inputs.saveId,
            oauthCredential,
          }
        }

        if (operation === 'reply') {
          return {
            parent_id: inputs.replyParentId,
            text: inputs.replyText,
            oauthCredential,
          }
        }

        if (operation === 'edit') {
          return {
            thing_id: inputs.editThingId,
            text: inputs.editText,
            oauthCredential,
          }
        }

        if (operation === 'delete') {
          return {
            id: inputs.deleteId,
            oauthCredential,
          }
        }

        if (operation === 'subscribe') {
          return {
            subreddit: inputs.subscribeSubreddit,
            action: inputs.subscribeAction,
            oauthCredential,
          }
        }

        if (operation === 'get_me') {
          return { oauthCredential }
        }

        if (operation === 'get_user') {
          return {
            username: inputs.username,
            oauthCredential,
          }
        }

        if (operation === 'send_message') {
          return {
            to: inputs.messageTo,
            subject: inputs.messageSubject,
            text: inputs.messageText,
            from_sr: inputs.messageFromSr || undefined,
            oauthCredential,
          }
        }

        if (operation === 'get_messages') {
          return {
            where: inputs.messageWhere,
            limit: inputs.messageLimit ? Number.parseInt(inputs.messageLimit) : undefined,
            mark: inputs.messageMark !== undefined ? inputs.messageMark === 'true' : undefined,
            after: inputs.after || undefined,
            before: inputs.before || undefined,
            oauthCredential,
          }
        }

        if (operation === 'get_subreddit_info') {
          return {
            subreddit: inputs.subreddit,
            oauthCredential,
          }
        }

        if (operation === 'get_subreddit_rules') {
          return {
            subreddit: inputs.subreddit,
            oauthCredential,
          }
        }

        if (operation === 'get_user_posts' || operation === 'get_user_comments') {
          return {
            username: inputs.userListUsername,
            sort: inputs.userListSort,
            time:
              inputs.userListSort === 'top' || inputs.userListSort === 'controversial'
                ? inputs.userListTime
                : undefined,
            limit: inputs.userListLimit ? Number.parseInt(inputs.userListLimit) : undefined,
            after: inputs.after || undefined,
            before: inputs.before || undefined,
            oauthCredential,
          }
        }

        if (operation === 'get_saved') {
          return {
            username: inputs.userListUsername,
            limit: inputs.userListLimit ? Number.parseInt(inputs.userListLimit) : undefined,
            after: inputs.after || undefined,
            before: inputs.before || undefined,
            oauthCredential,
          }
        }

        if (operation === 'get_info') {
          return {
            id: inputs.infoIds,
            oauthCredential,
          }
        }

        if (operation === 'search_subreddits') {
          return {
            q: inputs.searchSubredditsQuery,
            sort: inputs.searchSubredditsSort,
            limit: inputs.searchSubredditsLimit
              ? Number.parseInt(inputs.searchSubredditsLimit)
              : undefined,
            after: inputs.after || undefined,
            before: inputs.before || undefined,
            oauthCredential,
          }
        }

        if (operation === 'list_my_subreddits') {
          return {
            limit: inputs.listMineLimit ? Number.parseInt(inputs.listMineLimit) : undefined,
            after: inputs.after || undefined,
            before: inputs.before || undefined,
            oauthCredential,
          }
        }

        if (operation === 'report') {
          return {
            thing_id: inputs.reportThingId,
            reason: inputs.reportReason || undefined,
            other_reason: inputs.reportOtherReason || undefined,
            oauthCredential,
          }
        }

        if (operation === 'hide' || operation === 'unhide') {
          return {
            id: inputs.hideId,
            oauthCredential,
          }
        }

        if (operation === 'marknsfw' || operation === 'unmarknsfw') {
          return {
            id: inputs.nsfwId,
            oauthCredential,
          }
        }

        if (operation === 'mark_read') {
          return {
            id: inputs.markReadId,
            oauthCredential,
          }
        }

        if (operation === 'mark_all_read') {
          return { oauthCredential }
        }

        if (operation === 'mod_approve' || operation === 'lock' || operation === 'unlock') {
          return {
            id: inputs.modThingId,
            oauthCredential,
          }
        }

        if (operation === 'mod_remove') {
          return {
            id: inputs.modThingId,
            spam: inputs.removeSpam === 'true',
            oauthCredential,
          }
        }

        if (operation === 'mod_distinguish') {
          return {
            id: inputs.modThingId,
            how: inputs.distinguishHow,
            sticky:
              inputs.distinguishSticky !== undefined
                ? inputs.distinguishSticky === 'true'
                : undefined,
            oauthCredential,
          }
        }

        if (operation === 'mod_sticky') {
          return {
            id: inputs.stickyId,
            state: inputs.stickyState === 'true',
            num: inputs.stickyNum ? Number.parseInt(inputs.stickyNum) : undefined,
            oauthCredential,
          }
        }

        return {
          subreddit: inputs.subreddit,
          sort: inputs.sort,
          limit: inputs.limit ? Number.parseInt(inputs.limit) : undefined,
          oauthCredential,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Reddit access token' },
    subreddit: { type: 'string', description: 'Subreddit name' },
    sort: { type: 'string', description: 'Sort order' },
    time: { type: 'string', description: 'Time filter' },
    limit: { type: 'number', description: 'Maximum posts' },
    after: { type: 'string', description: 'Pagination cursor (after)' },
    before: { type: 'string', description: 'Pagination cursor (before)' },
    postId: { type: 'string', description: 'Post identifier' },
    commentSort: { type: 'string', description: 'Comment sort order' },
    commentLimit: { type: 'number', description: 'Maximum comments' },
    commentDepth: { type: 'number', description: 'Maximum reply depth' },
    commentFocus: { type: 'string', description: 'Focus on specific comment' },
    controversialTime: { type: 'string', description: 'Time filter for controversial posts' },
    controversialLimit: { type: 'number', description: 'Maximum controversial posts' },
    searchQuery: { type: 'string', description: 'Search query text' },
    searchSort: { type: 'string', description: 'Search result sort order' },
    searchTime: { type: 'string', description: 'Time filter for search results' },
    searchLimit: { type: 'number', description: 'Maximum search results' },
    submitSubreddit: { type: 'string', description: 'Subreddit to submit post to' },
    title: { type: 'string', description: 'Post title' },
    postType: { type: 'string', description: 'Type of post (text or link)' },
    text: { type: 'string', description: 'Post text content in markdown' },
    url: { type: 'string', description: 'URL for link posts' },
    nsfw: { type: 'boolean', description: 'Mark post as NSFW' },
    spoiler: { type: 'boolean', description: 'Mark post as spoiler' },
    sendReplies: { type: 'boolean', description: 'Send reply notifications' },
    flairId: { type: 'string', description: 'Flair template ID' },
    flairText: { type: 'string', description: 'Flair display text' },
    voteId: { type: 'string', description: 'Post or comment ID to vote on' },
    voteDirection: {
      type: 'number',
      description: 'Vote direction (1=upvote, 0=unvote, -1=downvote)',
    },
    saveId: { type: 'string', description: 'Post or comment ID to save/unsave' },
    saveCategory: { type: 'string', description: 'Category for saved items' },
    replyParentId: { type: 'string', description: 'Parent post or comment ID to reply to' },
    replyText: { type: 'string', description: 'Reply text in markdown' },
    editThingId: { type: 'string', description: 'Post or comment ID to edit' },
    editText: { type: 'string', description: 'New text content in markdown' },
    deleteId: { type: 'string', description: 'Post or comment ID to delete' },
    subscribeSubreddit: { type: 'string', description: 'Subreddit to subscribe/unsubscribe' },
    subscribeAction: { type: 'string', description: 'Subscribe action (sub or unsub)' },
    username: { type: 'string', description: 'Reddit username to look up' },
    messageTo: { type: 'string', description: 'Message recipient' },
    messageSubject: { type: 'string', description: 'Message subject' },
    messageText: { type: 'string', description: 'Message body in markdown' },
    messageFromSr: { type: 'string', description: 'Send from subreddit (mod mail)' },
    messageWhere: { type: 'string', description: 'Message folder' },
    messageLimit: { type: 'number', description: 'Maximum messages' },
    messageMark: { type: 'boolean', description: 'Mark messages as read' },
    userListUsername: { type: 'string', description: 'Reddit username for user listings' },
    userListSort: { type: 'string', description: 'Sort order for user listings' },
    userListTime: { type: 'string', description: 'Time filter for user listings' },
    userListLimit: { type: 'number', description: 'Maximum items in user listings' },
    infoIds: { type: 'string', description: 'Comma-separated thing fullnames to look up' },
    searchSubredditsQuery: { type: 'string', description: 'Subreddit search query' },
    searchSubredditsSort: { type: 'string', description: 'Subreddit search sort order' },
    searchSubredditsLimit: { type: 'number', description: 'Maximum subreddit search results' },
    listMineLimit: { type: 'number', description: 'Maximum subscribed subreddits' },
    reportThingId: { type: 'string', description: 'Post or comment ID to report' },
    reportReason: { type: 'string', description: 'Reason for reporting' },
    reportOtherReason: { type: 'string', description: 'Custom reason for reporting' },
    hideId: { type: 'string', description: 'Post ID(s) to hide/unhide' },
    nsfwId: { type: 'string', description: 'Post ID to mark/unmark NSFW' },
    markReadId: { type: 'string', description: 'Message ID(s) to mark as read' },
    modThingId: { type: 'string', description: 'Post or comment ID for moderation action' },
    removeSpam: { type: 'boolean', description: 'Mark removed item as spam' },
    distinguishHow: { type: 'string', description: 'Distinguish type' },
    distinguishSticky: { type: 'boolean', description: 'Sticky distinguished comment' },
    stickyId: { type: 'string', description: 'Post ID to sticky/unsticky' },
    stickyState: { type: 'boolean', description: 'Sticky (true) or unsticky (false)' },
    stickyNum: { type: 'number', description: 'Sticky slot (1-4)' },
  },
  outputs: {
    subreddit: { type: 'string', description: 'Subreddit name' },
    posts: {
      type: 'json',
      description:
        '[{id, name, title, author, url, permalink, score, num_comments, created_utc, is_self, selftext, thumbnail, subreddit}]',
    },
    post: {
      type: 'json',
      description: 'Single post (id, name, title, author, selftext, score, created_utc, permalink)',
    },
    comments: {
      type: 'json',
      description:
        '[{id, name, author, body, score, created_utc, permalink, replies}] with nested replies',
    },
    success: { type: 'boolean', description: 'Operation success status' },
    message: { type: 'string', description: 'Result message' },
    data: {
      type: 'json',
      description: 'Write-operation result (id, name, url, permalink, body — varies by operation)',
    },
    after: { type: 'string', description: 'Pagination cursor (next page)' },
    before: { type: 'string', description: 'Pagination cursor (previous page)' },
    id: { type: 'string', description: 'Entity ID' },
    name: { type: 'string', description: 'Entity fullname' },
    messages: {
      type: 'json',
      description:
        '[{id, name, author, dest, subject, body, created_utc, new, was_comment, context, distinguished}]',
    },
    display_name: { type: 'string', description: 'Subreddit display name' },
    subscribers: { type: 'number', description: 'Subscriber count' },
    description: { type: 'string', description: 'Description text' },
    link_karma: { type: 'number', description: 'Link karma' },
    comment_karma: { type: 'number', description: 'Comment karma' },
    total_karma: { type: 'number', description: 'Total karma' },
    icon_img: { type: 'string', description: 'Icon image URL' },
    subreddit_type: { type: 'string', description: 'Subreddit type (public, private, restricted)' },
    subreddits: {
      type: 'json',
      description:
        '[{id, name, display_name, title, public_description, subscribers, accounts_active, created_utc, over18, url, subreddit_type, icon_img}]',
    },
    rules: {
      type: 'json',
      description:
        '[{short_name, description, description_html, violation_reason, kind, created_utc, priority}]',
    },
    site_rules: { type: 'json', description: 'Reddit site-wide rules (string[])' },
  },
}

export const RedditBlockMeta = {
  tags: ['content-management', 'web-scraping'],
  url: 'https://www.reddit.com',
  templates: [
    {
      icon: RedditIcon,
      title: 'Reddit mention tracker',
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
