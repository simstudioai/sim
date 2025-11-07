import { RedditIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { RedditResponse } from '@/tools/reddit/types'

export const RedditBlock: BlockConfig<RedditResponse> = {
  type: 'reddit',
  name: 'Reddit',
  description: 'Access Reddit data and content',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Reddit into workflows. Read posts, comments, and search content. Submit posts, vote, reply, edit, and manage your Reddit account.',
  docsLink: 'https://docs.sim.ai/tools/reddit',
  category: 'tools',
  bgColor: '#FF5700',
  icon: RedditIcon,
  subBlocks: [
    // Operation selection
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
      ],
      value: () => 'get_posts',
    },

    // Reddit OAuth Authentication
    {
      id: 'credential',
      title: 'Reddit Account',
      type: 'oauth-input',
      provider: 'reddit',
      serviceId: 'reddit',
      requiredScopes: [
        'identity',
        'read',
        'submit',
        'vote',
        'save',
        'edit',
        'subscribe',
        'history',
        'privatemessages',
        'account',
        'mysubreddits',
        'flair',
        'report',
        'modposts',
        'modflair',
        'modmail',
      ],
      placeholder: 'Select Reddit account',
      required: true,
    },

    // Common fields - appear for all actions
    {
      id: 'subreddit',
      title: 'Subreddit',
      type: 'short-input',
      placeholder: 'Enter subreddit name (without r/)',
      condition: {
        field: 'operation',
        value: ['get_posts', 'get_comments', 'get_controversial', 'search'],
      },
      required: true,
    },

    // Get Posts specific fields
    {
      id: 'sort',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Hot', id: 'hot' },
        { label: 'New', id: 'new' },
        { label: 'Top', id: 'top' },
        { label: 'Rising', id: 'rising' },
      ],
      condition: {
        field: 'operation',
        value: 'get_posts',
      },
      required: true,
    },
    {
      id: 'time',
      title: 'Time Filter (for Top sort)',
      type: 'dropdown',
      options: [
        { label: 'Day', id: 'day' },
        { label: 'Week', id: 'week' },
        { label: 'Month', id: 'month' },
        { label: 'Year', id: 'year' },
        { label: 'All Time', id: 'all' },
      ],
      condition: {
        field: 'operation',
        value: 'get_posts',
        and: {
          field: 'sort',
          value: 'top',
        },
      },
    },
    {
      id: 'limit',
      title: 'Max Posts',
      type: 'short-input',
      placeholder: '10',
      condition: {
        field: 'operation',
        value: 'get_posts',
      },
    },

    // Get Comments specific fields
    {
      id: 'postId',
      title: 'Post ID',
      type: 'short-input',
      placeholder: 'Enter post ID',
      condition: {
        field: 'operation',
        value: 'get_comments',
      },
      required: true,
    },
    {
      id: 'commentSort',
      title: 'Sort Comments By',
      type: 'dropdown',
      options: [
        { label: 'Confidence', id: 'confidence' },
        { label: 'Top', id: 'top' },
        { label: 'New', id: 'new' },
        { label: 'Controversial', id: 'controversial' },
        { label: 'Old', id: 'old' },
        { label: 'Random', id: 'random' },
        { label: 'Q&A', id: 'qa' },
      ],
      condition: {
        field: 'operation',
        value: 'get_comments',
      },
    },
    {
      id: 'commentLimit',
      title: 'Number of Comments',
      type: 'short-input',
      placeholder: '50',
      condition: {
        field: 'operation',
        value: 'get_comments',
      },
    },

    // Get Controversial specific fields
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
      condition: {
        field: 'operation',
        value: 'get_controversial',
      },
    },
    {
      id: 'controversialLimit',
      title: 'Max Posts',
      type: 'short-input',
      placeholder: '10',
      condition: {
        field: 'operation',
        value: 'get_controversial',
      },
    },

    // Search specific fields
    {
      id: 'searchQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter search query',
      condition: {
        field: 'operation',
        value: 'search',
      },
      required: true,
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
      condition: {
        field: 'operation',
        value: 'search',
      },
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
      condition: {
        field: 'operation',
        value: 'search',
      },
    },
    {
      id: 'searchLimit',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '10',
      condition: {
        field: 'operation',
        value: 'search',
      },
    },

    // Submit Post specific fields
    {
      id: 'submitSubreddit',
      title: 'Subreddit',
      type: 'short-input',
      placeholder: 'Enter subreddit name (without r/)',
      condition: {
        field: 'operation',
        value: 'submit_post',
      },
      required: true,
    },
    {
      id: 'title',
      title: 'Post Title',
      type: 'short-input',
      placeholder: 'Enter post title',
      condition: {
        field: 'operation',
        value: 'submit_post',
      },
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
      condition: {
        field: 'operation',
        value: 'submit_post',
      },
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
        and: {
          field: 'postType',
          value: 'text',
        },
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
        and: {
          field: 'postType',
          value: 'link',
        },
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
      condition: {
        field: 'operation',
        value: 'submit_post',
      },
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
      condition: {
        field: 'operation',
        value: 'submit_post',
      },
      value: () => 'false',
    },

    // Vote specific fields
    {
      id: 'voteId',
      title: 'Post/Comment ID',
      type: 'short-input',
      placeholder: 'Enter thing ID (e.g., t3_xxxxx for post, t1_xxxxx for comment)',
      condition: {
        field: 'operation',
        value: 'vote',
      },
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
      condition: {
        field: 'operation',
        value: 'vote',
      },
      value: () => '1',
      required: true,
    },

    // Save/Unsave specific fields
    {
      id: 'saveId',
      title: 'Post/Comment ID',
      type: 'short-input',
      placeholder: 'Enter thing ID (e.g., t3_xxxxx for post, t1_xxxxx for comment)',
      condition: {
        field: 'operation',
        value: ['save', 'unsave'],
      },
      required: true,
    },
    {
      id: 'saveCategory',
      title: 'Category',
      type: 'short-input',
      placeholder: 'Enter category name',
      condition: {
        field: 'operation',
        value: 'save',
      },
    },

    // Reply specific fields
    {
      id: 'replyParentId',
      title: 'Parent Post/Comment ID',
      type: 'short-input',
      placeholder: 'Enter thing ID to reply to (e.g., t3_xxxxx for post, t1_xxxxx for comment)',
      condition: {
        field: 'operation',
        value: 'reply',
      },
      required: true,
    },
    {
      id: 'replyText',
      title: 'Reply Text (Markdown)',
      type: 'long-input',
      placeholder: 'Enter reply text in markdown format',
      condition: {
        field: 'operation',
        value: 'reply',
      },
      required: true,
    },

    // Edit specific fields
    {
      id: 'editThingId',
      title: 'Post/Comment ID',
      type: 'short-input',
      placeholder: 'Enter thing ID to edit (e.g., t3_xxxxx for post, t1_xxxxx for comment)',
      condition: {
        field: 'operation',
        value: 'edit',
      },
      required: true,
    },
    {
      id: 'editText',
      title: 'New Text (Markdown)',
      type: 'long-input',
      placeholder: 'Enter new text in markdown format',
      condition: {
        field: 'operation',
        value: 'edit',
      },
      required: true,
    },

    // Delete specific fields
    {
      id: 'deleteId',
      title: 'Post/Comment ID',
      type: 'short-input',
      placeholder: 'Enter thing ID to delete (e.g., t3_xxxxx for post, t1_xxxxx for comment)',
      condition: {
        field: 'operation',
        value: 'delete',
      },
      required: true,
    },

    // Subscribe specific fields
    {
      id: 'subscribeSubreddit',
      title: 'Subreddit',
      type: 'short-input',
      placeholder: 'Enter subreddit name (without r/)',
      condition: {
        field: 'operation',
        value: 'subscribe',
      },
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
      condition: {
        field: 'operation',
        value: 'subscribe',
      },
      value: () => 'sub',
      required: true,
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
    ],
    config: {
      tool: (inputs) => {
        const operation = inputs.operation || 'get_posts'

        if (operation === 'get_comments') {
          return 'reddit_get_comments'
        }

        if (operation === 'get_controversial') {
          return 'reddit_get_controversial'
        }

        if (operation === 'search') {
          return 'reddit_search'
        }

        if (operation === 'submit_post') {
          return 'reddit_submit_post'
        }

        if (operation === 'vote') {
          return 'reddit_vote'
        }

        if (operation === 'save') {
          return 'reddit_save'
        }

        if (operation === 'unsave') {
          return 'reddit_unsave'
        }

        if (operation === 'reply') {
          return 'reddit_reply'
        }

        if (operation === 'edit') {
          return 'reddit_edit'
        }

        if (operation === 'delete') {
          return 'reddit_delete'
        }

        if (operation === 'subscribe') {
          return 'reddit_subscribe'
        }

        return 'reddit_get_posts'
      },
      params: (inputs) => {
        const operation = inputs.operation || 'get_posts'
        const { credential, ...rest } = inputs

        if (operation === 'get_comments') {
          return {
            postId: rest.postId,
            subreddit: rest.subreddit,
            sort: rest.commentSort,
            limit: rest.commentLimit ? Number.parseInt(rest.commentLimit) : undefined,
            credential: credential,
          }
        }

        if (operation === 'get_controversial') {
          return {
            subreddit: rest.subreddit,
            time: rest.controversialTime,
            limit: rest.controversialLimit ? Number.parseInt(rest.controversialLimit) : undefined,
            credential: credential,
          }
        }

        if (operation === 'search') {
          return {
            subreddit: rest.subreddit,
            query: rest.searchQuery,
            sort: rest.searchSort,
            time: rest.searchTime,
            limit: rest.searchLimit ? Number.parseInt(rest.searchLimit) : undefined,
            credential: credential,
          }
        }

        if (operation === 'submit_post') {
          return {
            subreddit: rest.submitSubreddit,
            title: rest.title,
            text: rest.postType === 'text' ? rest.text : undefined,
            url: rest.postType === 'link' ? rest.url : undefined,
            nsfw: rest.nsfw === 'true',
            spoiler: rest.spoiler === 'true',
            credential: credential,
          }
        }

        if (operation === 'vote') {
          return {
            id: rest.voteId,
            dir: Number.parseInt(rest.voteDirection),
            credential: credential,
          }
        }

        if (operation === 'save') {
          return {
            id: rest.saveId,
            category: rest.saveCategory,
            credential: credential,
          }
        }

        if (operation === 'unsave') {
          return {
            id: rest.saveId,
            credential: credential,
          }
        }

        if (operation === 'reply') {
          return {
            parent_id: rest.replyParentId,
            text: rest.replyText,
            credential: credential,
          }
        }

        if (operation === 'edit') {
          return {
            thing_id: rest.editThingId,
            text: rest.editText,
            credential: credential,
          }
        }

        if (operation === 'delete') {
          return {
            id: rest.deleteId,
            credential: credential,
          }
        }

        if (operation === 'subscribe') {
          return {
            subreddit: rest.subscribeSubreddit,
            action: rest.subscribeAction,
            credential: credential,
          }
        }

        return {
          subreddit: rest.subreddit,
          sort: rest.sort,
          limit: rest.limit ? Number.parseInt(rest.limit) : undefined,
          time: rest.sort === 'top' ? rest.time : undefined,
          credential: credential,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Reddit access token' },
    subreddit: { type: 'string', description: 'Subreddit name' },
    sort: { type: 'string', description: 'Sort order' },
    time: { type: 'string', description: 'Time filter' },
    limit: { type: 'number', description: 'Maximum posts' },
    postId: { type: 'string', description: 'Post identifier' },
    commentSort: { type: 'string', description: 'Comment sort order' },
    commentLimit: { type: 'number', description: 'Maximum comments' },
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
  },
  outputs: {
    subreddit: { type: 'string', description: 'Subreddit name' },
    posts: { type: 'json', description: 'Posts data' },
    post: { type: 'json', description: 'Single post data' },
    comments: { type: 'json', description: 'Comments data' },
  },
}
