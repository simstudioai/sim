import { MicrosoftSharepointIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const SharepointBlockDisplay = {
  type: 'sharepoint',
  name: 'Sharepoint',
  description: 'Work with pages and lists',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: MicrosoftSharepointIcon,
  longDescription:
    'Integrate SharePoint into the workflow. Read/create pages, list sites, and work with lists (read, create, update items). Requires OAuth.',
  docsLink: 'https://docs.sim.ai/integrations/sharepoint',
  integrationType: IntegrationType.Documents,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const SharepointV2BlockDisplay = {
  ...SharepointBlockDisplay,
  type: 'sharepoint_v2',
  name: 'SharePoint',
  hideFromToolbar: false,
} satisfies BlockDisplay

export const SharepointBlockMeta = {
  tags: ['microsoft-365', 'content-management', 'document-processing'],
  url: 'https://www.microsoft.com/microsoft-365/sharepoint/collaboration',
  templates: [
    {
      icon: MicrosoftSharepointIcon,
      title: 'SharePoint policy publisher',
      prompt:
        'Build a workflow that turns a Google Docs policy update into a published SharePoint page, posts the change diff to the policies team in Microsoft Teams, and writes the version history.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'sync'],
      alsoIntegrations: ['google_docs', 'microsoft_teams'],
    },
    {
      icon: MicrosoftSharepointIcon,
      title: 'SharePoint stale-page sweeper',
      prompt:
        'Create a scheduled workflow that lists SharePoint pages not updated in 180 days, opens an owner-review thread in Teams, and archives pages once the owner approves.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'team'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: MicrosoftSharepointIcon,
      title: 'SharePoint knowledge agent',
      prompt:
        'Build an agent that indexes SharePoint sites into a knowledge base, answers internal questions with cited links, and deploys as a Teams chat endpoint.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'support',
      tags: ['enterprise', 'research'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: MicrosoftSharepointIcon,
      title: 'SharePoint external-share audit',
      prompt:
        'Create a scheduled workflow that audits SharePoint external sharing, flags items above the sensitivity threshold, and posts a security report to Teams compliance channel.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: MicrosoftSharepointIcon,
      title: 'SharePoint onboarding hub',
      prompt:
        'Build a workflow triggered by a new hire in Workday that creates a personalized SharePoint onboarding hub with role-relevant docs and shares it with the hire and their manager.',
      modules: ['files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: MicrosoftSharepointIcon,
      title: 'SharePoint search-relevance auditor',
      prompt:
        'Create a scheduled workflow that runs benchmark queries against SharePoint search weekly, scores the top result relevance, and writes a quality report to Teams.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'analysis'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: MicrosoftSharepointIcon,
      title: 'SharePoint to Confluence migrator',
      prompt:
        'Build a workflow that imports SharePoint pages into Confluence under matching spaces, preserves attachments, and writes a mapping table so links can be redirected.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'sync'],
      alsoIntegrations: ['confluence'],
    },
  ],
  skills: [
    {
      name: 'publish-site-page',
      description: 'Create a new SharePoint page on a site with a title and content body.',
      content:
        '# Publish Site Page\n\nCreate a new page on a SharePoint site, for example an announcement or knowledge article.\n\n## Steps\n1. Run List Sites to find the target site and note its identifier.\n2. Run Create Page on that site with a clear title and the page content body.\n3. Optionally run Read Page afterward to confirm the page was created as intended.\n\n## Output\nReturn the created page title and its URL or identifier so the page can be shared.',
    },
    {
      name: 'append-list-items',
      description:
        'Add rows to a SharePoint list, creating the list first if it does not yet exist.',
      content:
        '# Append List Items\n\nWrite structured rows into a SharePoint list.\n\n## Steps\n1. Run List Sites to locate the site, then Read List to confirm the target list and its column schema.\n2. If the list does not exist, run Create List with the needed columns.\n3. Run Add List Items with the field values mapped to the list columns.\n\n## Output\nReturn the list name and the number of items added, and confirm the field values matched the list schema.',
    },
    {
      name: 'read-list-data',
      description: 'Read items from a SharePoint list and summarize the rows for downstream use.',
      content:
        '# Read List Data\n\nPull the contents of a SharePoint list into the workflow.\n\n## Steps\n1. Run List Sites to find the site, then Read List against the target list.\n2. Inspect the returned items and their column values.\n3. Filter or summarize the rows as needed for the task.\n\n## Output\nReturn the list items with their relevant column values and a count of rows read.',
    },
    {
      name: 'upload-file-to-site',
      description: 'Upload a file to a SharePoint site document library from a previous block.',
      content:
        '# Upload File to Site\n\nStore a file in a SharePoint document library.\n\n## Steps\n1. Run List Sites to identify the destination site.\n2. Provide the file from a previous block and run Upload File to the target site library.\n3. Confirm the upload completed.\n\n## Output\nReturn the uploaded file name and its location on the SharePoint site.',
    },
  ],
} as const satisfies BlockMeta
