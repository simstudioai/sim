import { ConfluenceIcon, GoogleDriveIcon, NotionIcon } from '@/components/icons'

export interface KnowledgePreviewChunk {
  title: string
  content: string
}

export interface KnowledgePreviewDocument {
  id: string
  title: string
  updated: string
  size: string
  tokens: number
  chunks: readonly [KnowledgePreviewChunk, ...KnowledgePreviewChunk[]]
}

/** Small, fictional source collections; every document and passage is available locally. */
export const KNOWLEDGE_PREVIEW_SOURCES = [
  {
    id: 'notion',
    name: 'Notion',
    label: 'Notion',
    icon: NotionIcon,
    documents: [
      {
        id: 'getting-started',
        title: 'Getting started',
        updated: 'Today',
        size: '4.2 KB',
        tokens: 128,
        chunks: [
          {
            title: 'Your first workspace',
            content:
              'Create a workspace to bring your team, workflows, and knowledge together. Give it a name your teammates will recognize.',
          },
          {
            title: 'Invite your team',
            content:
              'Open workspace settings and choose Members. Enter a teammate’s email address and select the access they need before sending an invitation.',
          },
        ],
      },
      {
        id: 'release-notes',
        title: 'Release notes',
        updated: 'Yesterday',
        size: '2.1 KB',
        tokens: 64,
        chunks: [
          {
            title: 'September updates',
            content:
              'The new product handbook brings setup instructions and team guides into one collection. Each team owns the pages for its area.',
          },
        ],
      },
      {
        id: 'brand-guidelines',
        title: 'Brand guidelines',
        updated: 'Sep 2',
        size: '1.8 KB',
        tokens: 56,
        chunks: [
          {
            title: 'Writing for customers',
            content:
              'Use short sentences and concrete examples. Explain what customers can do next, and use the same names they see in the product.',
          },
        ],
      },
    ],
  },
  {
    id: 'drive',
    name: 'Google Drive',
    label: 'Drive',
    icon: GoogleDriveIcon,
    documents: [
      {
        id: 'support-handbook',
        title: 'Support handbook.pdf',
        updated: 'Today',
        size: '4.2 KB',
        tokens: 128,
        chunks: [
          {
            title: 'Triage a new request',
            content:
              'Start by checking the customer’s description and any attached screenshots. Record the affected feature and the steps that reproduce the issue.',
          },
          {
            title: 'Hand off to engineering',
            content:
              'Include the reproduction steps, expected behavior, and relevant run details. Keep the customer informed when ownership changes.',
          },
        ],
      },
      {
        id: 'onboarding-checklist',
        title: 'Onboarding checklist',
        updated: 'Yesterday',
        size: '2.1 KB',
        tokens: 64,
        chunks: [
          {
            title: 'A successful first week',
            content:
              'Confirm the customer’s goals, invite the project team, and agree on a first use case. Review the results together before expanding the rollout.',
          },
        ],
      },
      {
        id: 'customer-questions',
        title: 'Customer questions',
        updated: 'Sep 3',
        size: '2.4 KB',
        tokens: 72,
        chunks: [
          {
            title: 'Where to find answers',
            content:
              'Check the product handbook for setup questions and the release notes for recent changes. Send account-specific questions to the support team.',
          },
        ],
      },
    ],
  },
  {
    id: 'confluence',
    name: 'Confluence',
    label: 'Confluence',
    icon: ConfluenceIcon,
    documents: [
      {
        id: 'incident-response',
        title: 'Incident response',
        updated: 'Today',
        size: '4.2 KB',
        tokens: 128,
        chunks: [
          {
            title: 'Assess the impact',
            content:
              'Identify the affected service and when the issue began. Assign an incident owner and capture the first observations in the incident document.',
          },
          {
            title: 'Share an update',
            content:
              'Summarize the customer impact, current investigation, and next update time. After recovery, document the cause and follow-up actions.',
          },
        ],
      },
      {
        id: 'deployment-checklist',
        title: 'Deployment checklist',
        updated: 'Yesterday',
        size: '2.1 KB',
        tokens: 64,
        chunks: [
          {
            title: 'Review before release',
            content:
              'Review the change, confirm the required checks, and identify a rollback path. Monitor the affected workflows after the release is complete.',
          },
        ],
      },
      {
        id: 'service-ownership',
        title: 'Service ownership',
        updated: 'Sep 1',
        size: '1.6 KB',
        tokens: 48,
        chunks: [
          {
            title: 'Find the right team',
            content:
              'Each service has an owning team and a backup contact. Keep the ownership directory current when responsibilities change.',
          },
        ],
      },
    ],
  },
] as const
