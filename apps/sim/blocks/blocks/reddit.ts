import { RedditIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { RedditResponse } from '@/tools/reddit/types'

export const RedditBlock: BlockConfig<RedditResponse> = {
  type: 'reddit',
  name: 'Reddit',
  description: 'Access Reddit data and content',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Reddit into workflows. Read posts, comments, and search content. Submit posts, vote, reply, edit, manage messages, and access user and subreddit info.',
  docsLink: 'https://docs.sim.ai/tools/reddit',
  category: 'tools',
  integrationType: IntegrationType.Social,
  tags: ['content-management', 'web-scraping'],
  bgColor: '#FF5700',
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
      ],
      value: () => 'get_posts',
    },

    // Reddit OAuth Authentication
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

    // ── Get Posts ──────────────────────────────────────────────────────
    {
      id: 'subreddit',
      title: 'Subreddit',
      type: 'short-input',
      placeholder: 'Enter subreddit name (without r/)',
      condition: {
        field: 'operation',
        value: ['get_posts', 'get_comments', 'get_controversial', 'search', 'get_subreddit_info'],
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
        value: ['get_posts', 'get_controversial', 'search', 'get_messages'],
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
        value: ['get_posts', 'get_controversial', 'search', 'get_messages'],
      },
      mode: 'advanced',
    },

    // ── Get Comments ──────────────────────────────────────────────────
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

    // ── Get Controversial ─────────────────────────────────────────────
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

    // ── Search ────────────────────────────────────────────────────────
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
    // ── Submit Post ───────────────────────────────────────────────────
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

    // ── Vote ──────────────────────────────────────────────────────────
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

    // ── Save / Unsave ─────────────────────────────────────────────────
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

    // ── Reply ─────────────────────────────────────────────────────────
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

    // ── Edit ──────────────────────────────────────────────────────────
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

    // ── Delete ────────────────────────────────────────────────────────
    {
      id: 'deleteId',
      title: 'Post/Comment ID',
      type: 'short-input',
      placeholder: 'Thing fullname to delete (e.g., t3_xxxxx or t1_xxxxx)',
      condition: { field: 'operation', value: 'delete' },
      required: true,
    },

    // ── Subscribe ─────────────────────────────────────────────────────
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

    // ── Get User Profile ──────────────────────────────────────────────
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'Reddit username (e.g., spez)',
      condition: { field: 'operation', value: 'get_user' },
      required: true,
    },

    // ── Send Message ──────────────────────────────────────────────────
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

    // ── Get Messages ──────────────────────────────────────────────────
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
  },
  outputs: {
    subreddit: { type: 'string', description: 'Subreddit name' },
    posts: { type: 'json', description: 'Posts data' },
    post: { type: 'json', description: 'Single post data' },
    comments: { type: 'json', description: 'Comments data' },
    success: { type: 'boolean', description: 'Operation success status' },
    message: { type: 'string', description: 'Result message' },
    data: { type: 'json', description: 'Response data' },
    after: { type: 'string', description: 'Pagination cursor (next page)' },
    before: { type: 'string', description: 'Pagination cursor (previous page)' },
    id: { type: 'string', description: 'Entity ID' },
    name: { type: 'string', description: 'Entity fullname' },
    messages: { type: 'json', description: 'Messages data' },
    display_name: { type: 'string', description: 'Subreddit display name' },
    subscribers: { type: 'number', description: 'Subscriber count' },
    description: { type: 'string', description: 'Description text' },
    link_karma: { type: 'number', description: 'Link karma' },
    comment_karma: { type: 'number', description: 'Comment karma' },
    total_karma: { type: 'number', description: 'Total karma' },
    icon_img: { type: 'string', description: 'Icon image URL' },
  },
}
