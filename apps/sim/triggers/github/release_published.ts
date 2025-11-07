import { GithubIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const githubReleasePublishedTrigger: TriggerConfig = {
  id: 'github_release_published',
  name: 'GitHub Release Published',
  provider: 'github',
  description: 'Trigger workflow when a new release is published in a GitHub repository',
  version: '1.0.0',
  icon: GithubIcon,

  subBlocks: [
    {
      id: 'webhookUrlDisplay',
      title: 'Webhook URL',
      type: 'short-input',
      readOnly: true,
      showCopyButton: true,
      useWebhookUrl: true,
      placeholder: 'Webhook URL will be generated',
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'github_release_published',
      },
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'dropdown',
      options: [
        { label: 'application/json', id: 'application/json' },
        {
          label: 'application/x-www-form-urlencoded',
          id: 'application/x-www-form-urlencoded',
        },
      ],
      defaultValue: 'application/json',
      description: 'Format GitHub will use when sending the webhook payload.',
      required: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'github_release_published',
      },
    },
    {
      id: 'webhookSecret',
      title: 'Webhook Secret',
      type: 'short-input',
      placeholder: 'Generate or enter a strong secret',
      description: 'Validates that webhook deliveries originate from GitHub.',
      password: true,
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'github_release_published',
      },
    },
    {
      id: 'sslVerification',
      title: 'SSL Verification',
      type: 'dropdown',
      options: [
        { label: 'Enabled', id: 'enabled' },
        { label: 'Disabled', id: 'disabled' },
      ],
      defaultValue: 'enabled',
      description: 'GitHub verifies SSL certificates when delivering webhooks.',
      required: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'github_release_published',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: [
        'Go to your GitHub Repository > Settings > Webhooks.',
        'Click "Add webhook".',
        'Paste the <strong>Webhook URL</strong> above into the "Payload URL" field.',
        'Select your chosen Content Type from the dropdown.',
        'Enter the <strong>Webhook Secret</strong> into the "Secret" field if you\'ve configured one.',
        'Set SSL verification according to your selection.',
        'Select "Let me select individual events" and check <strong>Releases</strong> event.',
        'Ensure "Active" is checked and click "Add webhook".',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'github_release_published',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'github_release_published',
      condition: {
        field: 'selectedTriggerId',
        value: 'github_release_published',
      },
    },
    {
      id: 'samplePayload',
      title: 'Event Payload Example',
      type: 'code',
      language: 'json',
      defaultValue: JSON.stringify(
        {
          action: 'published',
          release: {
            id: 123456789,
            node_id: 'RE_kwDOABCDEF4HFGijkl',
            tag_name: 'v1.0.0',
            target_commitish: 'main',
            name: 'v1.0.0 - Initial Release',
            body: 'This is the first stable release of our project.\n\n## Features\n- Feature A\n- Feature B\n- Feature C\n\n## Bug Fixes\n- Fixed issue #123\n- Fixed issue #456',
            draft: false,
            prerelease: false,
            created_at: '2025-01-15T10:00:00Z',
            published_at: '2025-01-15T12:00:00Z',
            url: 'https://api.github.com/repos/owner/repo-name/releases/123456789',
            html_url: 'https://github.com/owner/repo-name/releases/tag/v1.0.0',
            assets_url: 'https://api.github.com/repos/owner/repo-name/releases/123456789/assets',
            upload_url:
              'https://uploads.github.com/repos/owner/repo-name/releases/123456789/assets{?name,label}',
            tarball_url: 'https://api.github.com/repos/owner/repo-name/tarball/v1.0.0',
            zipball_url: 'https://api.github.com/repos/owner/repo-name/zipball/v1.0.0',
            discussion_url: 'https://github.com/owner/repo-name/discussions/100',
            author: {
              login: 'releasemanager',
              id: 12345,
              node_id: 'MDQ6VXNlcjEyMzQ1',
              avatar_url: 'https://avatars.githubusercontent.com/u/12345?v=4',
              gravatar_id: '',
              url: 'https://api.github.com/users/releasemanager',
              html_url: 'https://github.com/releasemanager',
              followers_url: 'https://api.github.com/users/releasemanager/followers',
              following_url: 'https://api.github.com/users/releasemanager/following{/other_user}',
              gists_url: 'https://api.github.com/users/releasemanager/gists{/gist_id}',
              starred_url: 'https://api.github.com/users/releasemanager/starred{/owner}{/repo}',
              subscriptions_url: 'https://api.github.com/users/releasemanager/subscriptions',
              organizations_url: 'https://api.github.com/users/releasemanager/orgs',
              repos_url: 'https://api.github.com/users/releasemanager/repos',
              events_url: 'https://api.github.com/users/releasemanager/events{/privacy}',
              received_events_url: 'https://api.github.com/users/releasemanager/received_events',
              user_type: 'User',
              site_admin: false,
            },
            assets: [
              {
                id: 987654321,
                node_id: 'RA_kwDOABCDEF4DcXYZ',
                name: 'release-v1.0.0-linux-amd64.tar.gz',
                label: 'Linux AMD64 Binary',
                content_type: 'application/gzip',
                state: 'uploaded',
                size: 15728640,
                download_count: 42,
                created_at: '2025-01-15T11:30:00Z',
                updated_at: '2025-01-15T11:30:00Z',
                browser_download_url:
                  'https://github.com/owner/repo-name/releases/download/v1.0.0/release-v1.0.0-linux-amd64.tar.gz',
                url: 'https://api.github.com/repos/owner/repo-name/releases/assets/987654321',
                uploader: {
                  login: 'releasemanager',
                  id: 12345,
                  node_id: 'MDQ6VXNlcjEyMzQ1',
                  avatar_url: 'https://avatars.githubusercontent.com/u/12345?v=4',
                  html_url: 'https://github.com/releasemanager',
                  user_type: 'User',
                },
              },
              {
                id: 987654322,
                node_id: 'RA_kwDOABCDEF4DcXYa',
                name: 'release-v1.0.0-darwin-amd64.tar.gz',
                label: 'macOS AMD64 Binary',
                content_type: 'application/gzip',
                state: 'uploaded',
                size: 14680064,
                download_count: 28,
                created_at: '2025-01-15T11:30:00Z',
                updated_at: '2025-01-15T11:30:00Z',
                browser_download_url:
                  'https://github.com/owner/repo-name/releases/download/v1.0.0/release-v1.0.0-darwin-amd64.tar.gz',
                url: 'https://api.github.com/repos/owner/repo-name/releases/assets/987654322',
                uploader: {
                  login: 'releasemanager',
                  id: 12345,
                  node_id: 'MDQ6VXNlcjEyMzQ1',
                  avatar_url: 'https://avatars.githubusercontent.com/u/12345?v=4',
                  html_url: 'https://github.com/releasemanager',
                  user_type: 'User',
                },
              },
            ],
          },
          repository: {
            id: 123456,
            node_id: 'R_kgDOABCDEF',
            name: 'repo-name',
            full_name: 'owner/repo-name',
            private: false,
            html_url: 'https://github.com/owner/repo-name',
            repo_description: 'A sample repository for demonstrating GitHub release webhooks',
            fork: false,
            url: 'https://api.github.com/repos/owner/repo-name',
            archive_url: 'https://api.github.com/repos/owner/repo-name/{archive_format}{/ref}',
            assignees_url: 'https://api.github.com/repos/owner/repo-name/assignees{/user}',
            blobs_url: 'https://api.github.com/repos/owner/repo-name/git/blobs{/sha}',
            branches_url: 'https://api.github.com/repos/owner/repo-name/branches{/branch}',
            collaborators_url:
              'https://api.github.com/repos/owner/repo-name/collaborators{/collaborator}',
            comments_url: 'https://api.github.com/repos/owner/repo-name/comments{/number}',
            commits_url: 'https://api.github.com/repos/owner/repo-name/commits{/sha}',
            compare_url: 'https://api.github.com/repos/owner/repo-name/compare/{base}...{head}',
            contents_url: 'https://api.github.com/repos/owner/repo-name/contents/{+path}',
            contributors_url: 'https://api.github.com/repos/owner/repo-name/contributors',
            deployments_url: 'https://api.github.com/repos/owner/repo-name/deployments',
            downloads_url: 'https://api.github.com/repos/owner/repo-name/downloads',
            events_url: 'https://api.github.com/repos/owner/repo-name/events',
            forks_url: 'https://api.github.com/repos/owner/repo-name/forks',
            git_commits_url: 'https://api.github.com/repos/owner/repo-name/git/commits{/sha}',
            git_refs_url: 'https://api.github.com/repos/owner/repo-name/git/refs{/sha}',
            git_tags_url: 'https://api.github.com/repos/owner/repo-name/git/tags{/sha}',
            hooks_url: 'https://api.github.com/repos/owner/repo-name/hooks',
            issue_comment_url:
              'https://api.github.com/repos/owner/repo-name/issues/comments{/number}',
            issue_events_url: 'https://api.github.com/repos/owner/repo-name/issues/events{/number}',
            issues_url: 'https://api.github.com/repos/owner/repo-name/issues{/number}',
            keys_url: 'https://api.github.com/repos/owner/repo-name/keys{/key_id}',
            labels_url: 'https://api.github.com/repos/owner/repo-name/labels{/name}',
            languages_url: 'https://api.github.com/repos/owner/repo-name/languages',
            merges_url: 'https://api.github.com/repos/owner/repo-name/merges',
            milestones_url: 'https://api.github.com/repos/owner/repo-name/milestones{/number}',
            notifications_url:
              'https://api.github.com/repos/owner/repo-name/notifications{?since,all,participating}',
            pulls_url: 'https://api.github.com/repos/owner/repo-name/pulls{/number}',
            releases_url: 'https://api.github.com/repos/owner/repo-name/releases{/id}',
            stargazers_url: 'https://api.github.com/repos/owner/repo-name/stargazers',
            statuses_url: 'https://api.github.com/repos/owner/repo-name/statuses/{sha}',
            subscribers_url: 'https://api.github.com/repos/owner/repo-name/subscribers',
            subscription_url: 'https://api.github.com/repos/owner/repo-name/subscription',
            tags_url: 'https://api.github.com/repos/owner/repo-name/tags',
            teams_url: 'https://api.github.com/repos/owner/repo-name/teams',
            trees_url: 'https://api.github.com/repos/owner/repo-name/git/trees{/sha}',
            homepage: 'https://example.com',
            size: 1024,
            stargazers_count: 350,
            watchers_count: 350,
            language: 'TypeScript',
            has_issues: true,
            has_projects: true,
            has_downloads: true,
            has_wiki: true,
            has_pages: false,
            forks_count: 42,
            mirror_url: null,
            archived: false,
            disabled: false,
            open_issues_count: 12,
            license: {
              key: 'mit',
              name: 'MIT License',
              spdx_id: 'MIT',
              url: 'https://api.github.com/licenses/mit',
              node_id: 'MDc6TGljZW5zZTEz',
            },
            allow_forking: true,
            is_template: false,
            topics: ['javascript', 'typescript', 'nodejs'],
            visibility: 'public',
            forks: 42,
            open_issues: 12,
            watchers: 350,
            default_branch: 'main',
            created_at: '2020-01-01T00:00:00Z',
            updated_at: '2025-01-15T12:00:00Z',
            pushed_at: '2025-01-15T11:45:00Z',
            owner: {
              login: 'owner',
              id: 7890,
              node_id: 'MDQ6VXNlcjc4OTA=',
              avatar_url: 'https://avatars.githubusercontent.com/u/7890?v=4',
              gravatar_id: '',
              url: 'https://api.github.com/users/owner',
              html_url: 'https://github.com/owner',
              followers_url: 'https://api.github.com/users/owner/followers',
              following_url: 'https://api.github.com/users/owner/following{/other_user}',
              gists_url: 'https://api.github.com/users/owner/gists{/gist_id}',
              starred_url: 'https://api.github.com/users/owner/starred{/owner}{/repo}',
              subscriptions_url: 'https://api.github.com/users/owner/subscriptions',
              organizations_url: 'https://api.github.com/users/owner/orgs',
              repos_url: 'https://api.github.com/users/owner/repos',
              events_url: 'https://api.github.com/users/owner/events{/privacy}',
              received_events_url: 'https://api.github.com/users/owner/received_events',
              owner_type: 'User',
              site_admin: false,
            },
          },
          sender: {
            login: 'releasemanager',
            id: 12345,
            node_id: 'MDQ6VXNlcjEyMzQ1',
            avatar_url: 'https://avatars.githubusercontent.com/u/12345?v=4',
            gravatar_id: '',
            url: 'https://api.github.com/users/releasemanager',
            html_url: 'https://github.com/releasemanager',
            followers_url: 'https://api.github.com/users/releasemanager/followers',
            following_url: 'https://api.github.com/users/releasemanager/following{/other_user}',
            gists_url: 'https://api.github.com/users/releasemanager/gists{/gist_id}',
            starred_url: 'https://api.github.com/users/releasemanager/starred{/owner}{/repo}',
            subscriptions_url: 'https://api.github.com/users/releasemanager/subscriptions',
            organizations_url: 'https://api.github.com/users/releasemanager/orgs',
            repos_url: 'https://api.github.com/users/releasemanager/repos',
            events_url: 'https://api.github.com/users/releasemanager/events{/privacy}',
            received_events_url: 'https://api.github.com/users/releasemanager/received_events',
            user_type: 'User',
            site_admin: false,
          },
        },
        null,
        2
      ),
      readOnly: true,
      collapsible: true,
      defaultCollapsed: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'github_release_published',
      },
    },
  ],

  outputs: {
    action: {
      type: 'string',
      description:
        'Action performed (published, unpublished, created, edited, deleted, prereleased, released)',
    },
    release: {
      id: {
        type: 'number',
        description: 'Release ID',
      },
      node_id: {
        type: 'string',
        description: 'Release node ID',
      },
      tag_name: {
        type: 'string',
        description: 'Git tag name for the release',
      },
      target_commitish: {
        type: 'string',
        description: 'Target branch or commit SHA',
      },
      name: {
        type: 'string',
        description: 'Release name/title',
      },
      body: {
        type: 'string',
        description: 'Release description/notes in markdown format',
      },
      draft: {
        type: 'boolean',
        description: 'Whether the release is a draft',
      },
      prerelease: {
        type: 'boolean',
        description: 'Whether the release is a pre-release',
      },
      created_at: {
        type: 'string',
        description: 'Release creation timestamp',
      },
      published_at: {
        type: 'string',
        description: 'Release publication timestamp',
      },
      url: {
        type: 'string',
        description: 'Release API URL',
      },
      html_url: {
        type: 'string',
        description: 'Release HTML URL',
      },
      assets_url: {
        type: 'string',
        description: 'Release assets API URL',
      },
      upload_url: {
        type: 'string',
        description: 'URL for uploading release assets',
      },
      tarball_url: {
        type: 'string',
        description: 'Source code tarball download URL',
      },
      zipball_url: {
        type: 'string',
        description: 'Source code zipball download URL',
      },
      discussion_url: {
        type: 'string',
        description: 'Discussion URL if available',
      },
      author: {
        login: {
          type: 'string',
          description: 'Username',
        },
        id: {
          type: 'number',
          description: 'User ID',
        },
        node_id: {
          type: 'string',
          description: 'User node ID',
        },
        avatar_url: {
          type: 'string',
          description: 'Avatar URL',
        },
        gravatar_id: {
          type: 'string',
          description: 'Gravatar ID',
        },
        url: {
          type: 'string',
          description: 'User API URL',
        },
        html_url: {
          type: 'string',
          description: 'Profile URL',
        },
        followers_url: {
          type: 'string',
          description: 'Followers API URL',
        },
        following_url: {
          type: 'string',
          description: 'Following API URL',
        },
        gists_url: {
          type: 'string',
          description: 'Gists API URL',
        },
        starred_url: {
          type: 'string',
          description: 'Starred repositories API URL',
        },
        subscriptions_url: {
          type: 'string',
          description: 'Subscriptions API URL',
        },
        organizations_url: {
          type: 'string',
          description: 'Organizations API URL',
        },
        repos_url: {
          type: 'string',
          description: 'Repositories API URL',
        },
        events_url: {
          type: 'string',
          description: 'Events API URL',
        },
        received_events_url: {
          type: 'string',
          description: 'Received events API URL',
        },
        user_type: {
          type: 'string',
          description: 'User type (User, Bot, Organization)',
        },
        site_admin: {
          type: 'boolean',
          description: 'Whether user is a site administrator',
        },
      },
      assets: {
        type: 'array',
        description: 'Array of release asset objects with download URLs',
      },
    },
    repository: {
      id: {
        type: 'number',
        description: 'Repository ID',
      },
      node_id: {
        type: 'string',
        description: 'Repository node ID',
      },
      name: {
        type: 'string',
        description: 'Repository name',
      },
      full_name: {
        type: 'string',
        description: 'Repository full name (owner/repo)',
      },
      private: {
        type: 'boolean',
        description: 'Whether the repository is private',
      },
      html_url: {
        type: 'string',
        description: 'Repository HTML URL',
      },
      repo_description: {
        type: 'string',
        description: 'Repository description',
      },
      fork: {
        type: 'boolean',
        description: 'Whether the repository is a fork',
      },
      url: {
        type: 'string',
        description: 'Repository API URL',
      },
      archive_url: {
        type: 'string',
        description: 'Archive API URL',
      },
      assignees_url: {
        type: 'string',
        description: 'Assignees API URL',
      },
      blobs_url: {
        type: 'string',
        description: 'Blobs API URL',
      },
      branches_url: {
        type: 'string',
        description: 'Branches API URL',
      },
      collaborators_url: {
        type: 'string',
        description: 'Collaborators API URL',
      },
      comments_url: {
        type: 'string',
        description: 'Comments API URL',
      },
      commits_url: {
        type: 'string',
        description: 'Commits API URL',
      },
      compare_url: {
        type: 'string',
        description: 'Compare API URL',
      },
      contents_url: {
        type: 'string',
        description: 'Contents API URL',
      },
      contributors_url: {
        type: 'string',
        description: 'Contributors API URL',
      },
      deployments_url: {
        type: 'string',
        description: 'Deployments API URL',
      },
      downloads_url: {
        type: 'string',
        description: 'Downloads API URL',
      },
      events_url: {
        type: 'string',
        description: 'Events API URL',
      },
      forks_url: {
        type: 'string',
        description: 'Forks API URL',
      },
      git_commits_url: {
        type: 'string',
        description: 'Git commits API URL',
      },
      git_refs_url: {
        type: 'string',
        description: 'Git refs API URL',
      },
      git_tags_url: {
        type: 'string',
        description: 'Git tags API URL',
      },
      hooks_url: {
        type: 'string',
        description: 'Hooks API URL',
      },
      issue_comment_url: {
        type: 'string',
        description: 'Issue comment API URL',
      },
      issue_events_url: {
        type: 'string',
        description: 'Issue events API URL',
      },
      issues_url: {
        type: 'string',
        description: 'Issues API URL',
      },
      keys_url: {
        type: 'string',
        description: 'Keys API URL',
      },
      labels_url: {
        type: 'string',
        description: 'Labels API URL',
      },
      languages_url: {
        type: 'string',
        description: 'Languages API URL',
      },
      merges_url: {
        type: 'string',
        description: 'Merges API URL',
      },
      milestones_url: {
        type: 'string',
        description: 'Milestones API URL',
      },
      notifications_url: {
        type: 'string',
        description: 'Notifications API URL',
      },
      pulls_url: {
        type: 'string',
        description: 'Pull requests API URL',
      },
      releases_url: {
        type: 'string',
        description: 'Releases API URL',
      },
      stargazers_url: {
        type: 'string',
        description: 'Stargazers API URL',
      },
      statuses_url: {
        type: 'string',
        description: 'Statuses API URL',
      },
      subscribers_url: {
        type: 'string',
        description: 'Subscribers API URL',
      },
      subscription_url: {
        type: 'string',
        description: 'Subscription API URL',
      },
      tags_url: {
        type: 'string',
        description: 'Tags API URL',
      },
      teams_url: {
        type: 'string',
        description: 'Teams API URL',
      },
      trees_url: {
        type: 'string',
        description: 'Trees API URL',
      },
      homepage: {
        type: 'string',
        description: 'Repository homepage URL',
      },
      size: {
        type: 'number',
        description: 'Repository size in KB',
      },
      stargazers_count: {
        type: 'number',
        description: 'Number of stars',
      },
      watchers_count: {
        type: 'number',
        description: 'Number of watchers',
      },
      language: {
        type: 'string',
        description: 'Primary programming language',
      },
      has_issues: {
        type: 'boolean',
        description: 'Whether issues are enabled',
      },
      has_projects: {
        type: 'boolean',
        description: 'Whether projects are enabled',
      },
      has_downloads: {
        type: 'boolean',
        description: 'Whether downloads are enabled',
      },
      has_wiki: {
        type: 'boolean',
        description: 'Whether wiki is enabled',
      },
      has_pages: {
        type: 'boolean',
        description: 'Whether GitHub Pages is enabled',
      },
      forks_count: {
        type: 'number',
        description: 'Number of forks',
      },
      mirror_url: {
        type: 'string',
        description: 'Mirror URL if repository is a mirror',
      },
      archived: {
        type: 'boolean',
        description: 'Whether the repository is archived',
      },
      disabled: {
        type: 'boolean',
        description: 'Whether the repository is disabled',
      },
      open_issues_count: {
        type: 'number',
        description: 'Number of open issues',
      },
      license: {
        key: {
          type: 'string',
          description: 'License key',
        },
        name: {
          type: 'string',
          description: 'License name',
        },
        spdx_id: {
          type: 'string',
          description: 'SPDX license identifier',
        },
        url: {
          type: 'string',
          description: 'License API URL',
        },
        node_id: {
          type: 'string',
          description: 'License node ID',
        },
      },
      allow_forking: {
        type: 'boolean',
        description: 'Whether forking is allowed',
      },
      is_template: {
        type: 'boolean',
        description: 'Whether repository is a template',
      },
      topics: {
        type: 'array',
        description: 'Array of repository topics',
      },
      visibility: {
        type: 'string',
        description: 'Repository visibility (public, private, internal)',
      },
      forks: {
        type: 'number',
        description: 'Number of forks',
      },
      open_issues: {
        type: 'number',
        description: 'Number of open issues',
      },
      watchers: {
        type: 'number',
        description: 'Number of watchers',
      },
      default_branch: {
        type: 'string',
        description: 'Default branch name',
      },
      created_at: {
        type: 'string',
        description: 'Repository creation timestamp',
      },
      updated_at: {
        type: 'string',
        description: 'Repository last update timestamp',
      },
      pushed_at: {
        type: 'string',
        description: 'Repository last push timestamp',
      },
      owner: {
        login: {
          type: 'string',
          description: 'Owner username',
        },
        id: {
          type: 'number',
          description: 'Owner ID',
        },
        node_id: {
          type: 'string',
          description: 'Owner node ID',
        },
        avatar_url: {
          type: 'string',
          description: 'Owner avatar URL',
        },
        gravatar_id: {
          type: 'string',
          description: 'Owner gravatar ID',
        },
        url: {
          type: 'string',
          description: 'Owner API URL',
        },
        html_url: {
          type: 'string',
          description: 'Owner profile URL',
        },
        followers_url: {
          type: 'string',
          description: 'Followers API URL',
        },
        following_url: {
          type: 'string',
          description: 'Following API URL',
        },
        gists_url: {
          type: 'string',
          description: 'Gists API URL',
        },
        starred_url: {
          type: 'string',
          description: 'Starred repositories API URL',
        },
        subscriptions_url: {
          type: 'string',
          description: 'Subscriptions API URL',
        },
        organizations_url: {
          type: 'string',
          description: 'Organizations API URL',
        },
        repos_url: {
          type: 'string',
          description: 'Repositories API URL',
        },
        events_url: {
          type: 'string',
          description: 'Events API URL',
        },
        received_events_url: {
          type: 'string',
          description: 'Received events API URL',
        },
        owner_type: {
          type: 'string',
          description: 'Owner type (User, Organization)',
        },
        site_admin: {
          type: 'boolean',
          description: 'Whether owner is a site administrator',
        },
      },
    },
    sender: {
      login: {
        type: 'string',
        description: 'Username',
      },
      id: {
        type: 'number',
        description: 'User ID',
      },
      node_id: {
        type: 'string',
        description: 'User node ID',
      },
      avatar_url: {
        type: 'string',
        description: 'Avatar URL',
      },
      gravatar_id: {
        type: 'string',
        description: 'Gravatar ID',
      },
      url: {
        type: 'string',
        description: 'User API URL',
      },
      html_url: {
        type: 'string',
        description: 'Profile URL',
      },
      followers_url: {
        type: 'string',
        description: 'Followers API URL',
      },
      following_url: {
        type: 'string',
        description: 'Following API URL',
      },
      gists_url: {
        type: 'string',
        description: 'Gists API URL',
      },
      starred_url: {
        type: 'string',
        description: 'Starred repositories API URL',
      },
      subscriptions_url: {
        type: 'string',
        description: 'Subscriptions API URL',
      },
      organizations_url: {
        type: 'string',
        description: 'Organizations API URL',
      },
      repos_url: {
        type: 'string',
        description: 'Repositories API URL',
      },
      events_url: {
        type: 'string',
        description: 'Events API URL',
      },
      received_events_url: {
        type: 'string',
        description: 'Received events API URL',
      },
      user_type: {
        type: 'string',
        description: 'User type (User, Bot, Organization)',
      },
      site_admin: {
        type: 'boolean',
        description: 'Whether user is a site administrator',
      },
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'release',
      'X-GitHub-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'X-Hub-Signature-256': 'sha256=...',
    },
  },
}
