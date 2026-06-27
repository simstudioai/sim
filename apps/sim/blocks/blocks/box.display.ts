import { BoxCompanyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const BoxBlockDisplay = {
  type: 'box',
  name: 'Box',
  description: 'Manage files, folders, and e-signatures with Box',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: BoxCompanyIcon,
  longDescription:
    'Integrate Box into your workflow to manage files, folders, and e-signatures. Upload and download files, search content, create folders, send documents for e-signature, track signing status, and more.',
  docsLink: 'https://docs.sim.ai/integrations/box',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay

export const BoxBlockMeta = {
  tags: ['cloud', 'content-management', 'e-signatures'],
  url: 'https://www.box.com',
  templates: [
    {
      icon: BoxCompanyIcon,
      title: 'Box folder onboarding',
      prompt:
        'Create a workflow that watches a Box folder for new customer subfolders, applies the standard permissions matrix, seeds template files, and notifies the account owner.',
      modules: ['files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
    },
    {
      icon: BoxCompanyIcon,
      title: 'Box external-share auditor',
      prompt:
        'Build a scheduled weekly workflow that lists Box shared links shared with external collaborators, flags items above the sensitivity threshold, and writes a security review.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: BoxCompanyIcon,
      title: 'Box compliance retention',
      prompt:
        'Create a scheduled workflow that finds Box documents past retention, applies legal hold or archives them, and writes the disposition record to an audit table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: BoxCompanyIcon,
      title: 'Box document Q&A agent',
      prompt:
        'Build an agent that indexes Box content into a knowledge base, answers user questions with sourced citations, and deploys as a chat endpoint for internal teams.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'enterprise'],
    },
    {
      icon: BoxCompanyIcon,
      title: 'Box to S3 backup',
      prompt:
        'Create a scheduled workflow that mirrors a Box folder tree into S3 nightly with incremental sync, captures the manifest, and pings Slack on any failed files.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'sync'],
      alsoIntegrations: ['s3'],
    },
    {
      icon: BoxCompanyIcon,
      title: 'Box new-vendor folder setup',
      prompt:
        'Build a workflow triggered when a new vendor is created in a CRM that provisions a standard Box folder structure for that vendor, invites the right users, and writes the folder link to the vendor record.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: BoxCompanyIcon,
      title: 'Box approval-flow router',
      prompt:
        'Create a workflow that watches a Box approval folder, posts a Slack request with quick-action buttons for each new doc, captures the decision, and labels the file accordingly.',
      modules: ['files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'send-document-for-signature',
      description:
        'Send a Box document for e-signature and confirm the request. Use for contracts, NDAs, and approval forms that need a signer.',
      content:
        '# Send Document For Signature\n\nKick off a Box Sign request for one or more documents.\n\n## Steps\n1. Identify the Box file id(s) to sign (use Search or List Folder Items if you only have a name).\n2. Use Create Sign Request with the source file ids and the primary signer email; set the signer role (signer, approver, or final copy reader).\n3. Add a clear email subject and message, and add any additional signers as a JSON array of email/role objects.\n4. Optionally set a destination folder for the signed copy, days valid, and reminders.\n\n## Output\nReturn the sign request id, status, signer list, and the prepare/sign URL. Tell the user the request was sent and how to track it. If a file id cannot be resolved, ask for clarification.',
    },
    {
      name: 'track-signature-status',
      description:
        'Check the status of Box Sign requests and follow up on pending signers. Use to monitor outstanding e-signature requests.',
      content:
        '# Track Signature Status\n\nReport on outstanding and completed Box Sign requests.\n\n## Steps\n1. Use List Sign Requests to retrieve recent requests, paging with the marker when needed.\n2. For a specific request, use Get Sign Request with the sign request id to read per-signer status.\n3. Identify requests that are still pending versus signed, declined, or expired.\n4. For stalled requests, use Resend Sign Request to nudge signers, or Cancel Sign Request if it is no longer needed.\n\n## Output\nReturn a status summary per request: name, overall status, which signers have signed, and which are outstanding. Recommend resend or cancel actions for stale requests.',
    },
    {
      name: 'organize-files-into-folder',
      description:
        'Upload files into a structured Box folder, creating folders as needed. Use to file documents into a standard organized layout.',
      content:
        '# Organize Files Into Folder\n\nPlace documents into the correct Box folder structure.\n\n## Steps\n1. Determine the destination. Use List Folder Items or Search to find an existing folder, or Create Folder under the right parent (use "0" for root) if it does not exist.\n2. Upload each file with Upload File, setting the parent folder id and an explicit file name when needed.\n3. To reorganize existing files, use Update File to rename, move (set Move to Folder ID), tag, or describe them.\n4. Use Copy File when a document must live in more than one folder.\n\n## Output\nReturn the created folder id (if any) and a list of the files placed, each with its id, name, and final folder. Confirm the resulting structure.',
    },
    {
      name: 'search-box-content',
      description:
        'Find files and folders in Box matching a query and return their details. Use to locate documents before acting on them.',
      content:
        '# Search Box Content\n\nLocate documents in Box.\n\n## Steps\n1. Use Search with the query string. Narrow with optional filters: ancestor folder id, file extensions (e.g. pdf,docx), and content type (file, folder, or web link).\n2. Page through results with limit and offset if there are many matches.\n3. For promising hits, use Get File Info to confirm name, size, owner, and modified date.\n\n## Output\nReturn the matching items with id, name, type, owner, and last-modified date. If the query is ambiguous or returns too many results, suggest a tighter query or folder scope.',
    },
  ],
} as const satisfies BlockMeta
