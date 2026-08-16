import { ZohoDeskIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

/** Default ceiling on tickets pulled per sync when the user leaves Max Tickets blank. */
export const DEFAULT_MAX_TICKETS = 500

/** Default ceiling on Help Center articles pulled per sync. */
export const DEFAULT_MAX_ARTICLES = 500

/**
 * Zoho Desk REST hosts per data center. Zoho scopes every portal to the data
 * center it was created in, and a token minted in one is rejected by the others,
 * so the host is part of the connector configuration rather than a constant.
 *
 * Kept as a closed map (never a user-supplied host) so the OAuth token can only
 * ever be sent to a Zoho-owned origin.
 */
export const ZOHO_DESK_DATA_CENTER_BASES = {
  us: 'https://desk.zoho.com',
  eu: 'https://desk.zoho.eu',
  in: 'https://desk.zoho.in',
  au: 'https://desk.zoho.com.au',
  jp: 'https://desk.zoho.jp',
  uk: 'https://desk.zoho.uk',
  // Canada is the one region that is not a `zoho.<tld>` host: Zoho serves it from
  // `zohocloud.ca` (accounts.zohocloud.ca / www.zohoapis.ca). `desk.zoho.ca` does
  // not resolve at all.
  ca: 'https://desk.zohocloud.ca',
  sa: 'https://desk.zoho.sa',
  cn: 'https://desk.zoho.com.cn',
  sg: 'https://desk.zoho.sg',
  ae: 'https://desk.zoho.ae',
} as const

export type ZohoDeskDataCenter = keyof typeof ZOHO_DESK_DATA_CENTER_BASES

/** Data center assumed when the user has not chosen one. */
export const DEFAULT_ZOHO_DESK_DATA_CENTER: ZohoDeskDataCenter = 'us'

export const zohoDeskConnectorMeta: ConnectorMeta = {
  id: 'zoho_desk',
  name: 'Zoho Desk',
  description: 'Sync Help Center articles and support tickets from Zoho Desk',
  version: '1.0.0',
  icon: ZohoDeskIcon,

  auth: {
    mode: 'oauth',
    provider: 'zoho-desk',
    requiredScopes: [
      'Desk.basic.READ',
      'Desk.tickets.READ',
      'Desk.articles.READ',
      'Desk.organization.READ',
    ],
  },

  configFields: [
    {
      id: 'orgSelector',
      title: 'Organization',
      type: 'selector',
      selectorKey: 'zoho_desk.organizations',
      canonicalParamId: 'orgId',
      mode: 'basic',
      placeholder: 'Select an organization',
      required: true,
      description: 'Zoho Desk portal to sync from',
    },
    {
      id: 'orgId',
      title: 'Organization ID',
      type: 'short-input',
      canonicalParamId: 'orgId',
      mode: 'advanced',
      placeholder: 'e.g. 706989253',
      required: true,
      description: 'Zoho Desk organization ID',
    },
    {
      id: 'dataCenter',
      title: 'Data Center',
      type: 'dropdown',
      required: true,
      description: 'Zoho data center your portal was created in',
      options: [
        { label: 'United States (desk.zoho.com)', id: 'us' },
        { label: 'Europe (desk.zoho.eu)', id: 'eu' },
        { label: 'India (desk.zoho.in)', id: 'in' },
        { label: 'Australia (desk.zoho.com.au)', id: 'au' },
        { label: 'Japan (desk.zoho.jp)', id: 'jp' },
        { label: 'United Kingdom (desk.zoho.uk)', id: 'uk' },
        { label: 'Canada (desk.zohocloud.ca)', id: 'ca' },
        { label: 'Saudi Arabia (desk.zoho.sa)', id: 'sa' },
        { label: 'China (desk.zoho.com.cn)', id: 'cn' },
        { label: 'Singapore (desk.zoho.sg)', id: 'sg' },
        { label: 'United Arab Emirates (desk.zoho.ae)', id: 'ae' },
      ],
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'dropdown',
      required: true,
      description: 'What content to sync from Zoho Desk',
      options: [
        { label: 'Articles & Tickets', id: 'both' },
        { label: 'Help Center Articles Only', id: 'articles' },
        { label: 'Support Tickets Only', id: 'tickets' },
      ],
    },
    {
      id: 'ticketStatus',
      title: 'Ticket Status Filter',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. Open,On Hold (default: all statuses)',
      description:
        'Comma-separated ticket statuses. Free text because a Zoho Desk portal can define its own statuses.',
    },
    {
      id: 'departmentIds',
      title: 'Department IDs',
      type: 'short-input',
      required: false,
      multi: true,
      placeholder: 'e.g. 1892000000006907 (default: all departments)',
      description: 'Restrict the ticket sync to specific departments',
    },
    {
      id: 'articleStatus',
      title: 'Article Status Filter',
      type: 'dropdown',
      required: false,
      description: 'Publishing status of the Help Center articles to sync',
      options: [
        { label: 'All Statuses', id: 'all' },
        { label: 'Published', id: 'Published' },
        { label: 'Draft', id: 'Draft' },
        { label: 'Review', id: 'Review' },
        { label: 'Expired', id: 'Expired' },
        { label: 'Unpublished', id: 'Unpublished' },
      ],
    },
    {
      id: 'articleCategoryId',
      title: 'Article Category ID',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 4000000013240 (default: all categories)',
      description: 'Restrict the article sync to a single knowledge base category',
    },
    {
      id: 'maxTickets',
      title: 'Max Tickets',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 200 (default: ${DEFAULT_MAX_TICKETS})`,
      description: 'Maximum number of tickets to sync',
    },
    {
      id: 'maxArticles',
      title: 'Max Articles',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 200 (default: ${DEFAULT_MAX_ARTICLES})`,
      description: 'Maximum number of Help Center articles to sync',
    },
  ],

  tagDefinitions: [
    { id: 'contentType', displayName: 'Content Type', fieldType: 'text' },
    { id: 'status', displayName: 'Status', fieldType: 'text' },
    { id: 'priority', displayName: 'Priority', fieldType: 'text' },
    { id: 'category', displayName: 'Category', fieldType: 'text' },
    { id: 'tags', displayName: 'Tags', fieldType: 'text' },
    { id: 'updatedAt', displayName: 'Last Updated', fieldType: 'date' },
    { id: 'commentCount', displayName: 'Comment Count', fieldType: 'number' },
  ],
}
