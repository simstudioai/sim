import { SlackIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import { SlackV2Block } from '@/blocks/blocks/slack'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

const CANVAS_OPERATIONS = [
  { label: 'List Canvases', id: 'list_canvases' },
  { label: 'Get Canvas Metadata', id: 'get_canvas' },
  { label: 'Create Canvas', id: 'canvas' },
  { label: 'Create Channel Canvas', id: 'create_channel_canvas' },
  { label: 'Edit Canvas', id: 'edit_canvas' },
  { label: 'Lookup Canvas Sections', id: 'lookup_canvas_sections' },
  { label: 'Delete Canvas', id: 'delete_canvas' },
]
const CANVAS_FIELDS = new Set([
  'channel',
  'manualChannel',
  'title',
  'content',
  'editCanvasId',
  'canvasOperation',
  'canvasContent',
  'sectionId',
  'canvasTitle',
  'channelCanvasTitle',
  'channelCanvasContent',
  'getCanvasId',
  'canvasListCount',
  'canvasListPage',
  'canvasListUser',
  'canvasListTsFrom',
  'canvasListTsTo',
  'canvasListTeamId',
  'lookupCanvasId',
  'sectionCriteria',
  'deleteCanvasId',
])

/** A focused catalog entry sharing the existing Slack editor fields and tool implementations. */
export const SlackCanvasBlock: BlockConfig = {
  type: 'slack_canvas',
  name: 'Slack Canvas',
  description: 'Create, edit, find, and delete Slack canvases',
  longDescription:
    'Create collaborative Slack documents, edit Markdown, find section IDs, and manage channel canvases. Get Canvas Metadata and List Canvases return file metadata, not document contents. Uses the same Slack account or custom bot credentials and tools as the Slack block.',
  docsLink: 'https://docs.sim.ai/integrations/slack_canvas',
  category: 'tools',
  integrationType: IntegrationType.Productivity,
  bgColor: '#611f69',
  icon: SlackIcon,
  authMode: AuthMode.OAuth,
  canvasPresentation: {
    defaultTitle: 'Slack Canvas',
    sentences: {
      byOperation: {
        list_canvases: [
          'List canvases',
          { text: ', up to', field: 'canvasListCount', after: 'at a time' },
        ],
        get_canvas: [{ text: 'Read metadata for canvas', field: 'getCanvasId', core: true }],
        canvas: [
          { text: 'Create canvas', field: 'title', core: true },
          { text: 'in', field: ['channelSelector', 'manualChannel'] },
        ],
        create_channel_canvas: [
          {
            text: 'Create a channel canvas in',
            field: ['channelSelector', 'manualChannel'],
            core: true,
          },
        ],
        edit_canvas: [
          { text: 'Edit canvas', field: 'editCanvasId', core: true },
          { text: ', with', field: 'canvasContent' },
        ],
        lookup_canvas_sections: [
          { text: 'Find sections in canvas', field: 'lookupCanvasId', core: true },
        ],
        delete_canvas: [{ text: 'Delete canvas', field: 'deleteCanvasId', core: true }],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: CANVAS_OPERATIONS,
      value: () => 'list_canvases',
    },
    {
      id: 'credential',
      title: 'Slack Account',
      type: 'oauth-input',
      serviceId: 'slack',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      credentialKind: 'any',
      requiredScopes: getScopesForService('slack'),
      required: true,
      placeholder: 'Select Slack account or bot',
    },
    {
      id: 'manualCredential',
      title: 'Slack Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      required: true,
      placeholder: 'Enter credential ID',
    },
    ...SlackV2Block.subBlocks
      .filter((field) => CANVAS_FIELDS.has(field.id))
      .map((field) => (field.id === 'channel' ? { ...field, id: 'channelSelector' } : field)),
  ],
  tools: {
    access: [
      'slack_canvas',
      'slack_create_channel_canvas',
      'slack_edit_canvas',
      'slack_get_canvas',
      'slack_list_canvases',
      'slack_lookup_canvas_sections',
      'slack_delete_canvas',
    ],
    config: SlackV2Block.tools.config,
  },
  inputs: Object.fromEntries(
    Object.entries(SlackV2Block.inputs).filter(
      ([key]) => CANVAS_FIELDS.has(key) || key === 'oauthCredential' || key === 'channelId'
    )
  ),
  outputs: {
    canvas_id: { type: 'string', description: 'ID of the created canvas' },
    content: { type: 'string', description: 'Edit confirmation' },
    canvas: {
      type: 'json',
      description: 'Canvas file metadata (id, title, permalink, timestamps)',
    },
    canvases: { type: 'json', description: 'Page of canvas file metadata' },
    paging: { type: 'json', description: 'Pagination (count, total, page, pages)' },
    sections: { type: 'json', description: 'Matching section IDs for edits' },
    ok: { type: 'boolean', description: 'Whether Slack deleted the canvas' },
  },
}

export const SlackCanvasBlockMeta = {
  tags: ['note-taking', 'automation'],
  url: 'https://slack.com',
  templates: [
    {
      icon: SlackIcon,
      title: 'Slack Canvas team onboarding',
      prompt:
        'Build a workflow: When a new teammate joins, turn the provided team resources into Markdown and create an onboarding canvas in the selected Slack channel.',
      modules: ['workflows'],
      category: 'productivity',
      tags: ['automation'],
    },
    {
      icon: SlackIcon,
      title: 'Slack Canvas incident notes',
      prompt:
        'Build a workflow: When an incident opens, create a canvas from the supplied incident details; append supplied updates as the response progresses.',
      modules: ['workflows'],
      category: 'productivity',
      tags: ['automation'],
    },
    {
      icon: SlackIcon,
      title: 'Slack Canvas channel resource hub',
      prompt:
        'Build a workflow: When a team channel launches, create its channel canvas with provided links, ownership, and working agreements.',
      modules: ['workflows'],
      category: 'productivity',
      tags: ['automation'],
    },
    {
      icon: SlackIcon,
      title: 'Slack Canvas feedback guidelines',
      prompt:
        'Build a workflow: When feedback guidelines change, find the matching canvas section and replace it with the provided Markdown instructions.',
      modules: ['workflows'],
      category: 'productivity',
      tags: ['automation'],
    },
    {
      icon: SlackIcon,
      title: 'Slack Canvas project status notes',
      prompt:
        'Build a workflow: On a weekly schedule, format the supplied project status as Markdown and append it to the selected canvas.',
      modules: ['workflows'],
      category: 'productivity',
      tags: ['automation'],
    },
    {
      icon: SlackIcon,
      title: 'Slack Canvas canvas inventory',
      prompt:
        'Build a workflow: On a schedule, list all pages of canvases visible to the selected account and return their metadata and links.',
      modules: ['workflows'],
      category: 'productivity',
      tags: ['automation'],
    },
    {
      icon: SlackIcon,
      title: 'Slack Canvas channel faq',
      prompt:
        'Build a workflow: When a new FAQ answer is approved, append the supplied question and answer to the selected channel canvas.',
      modules: ['workflows'],
      category: 'productivity',
      tags: ['automation'],
    },
  ],
  skills: [
    {
      name: 'create-onboarding-canvas',
      description: 'Create an onboarding document from provided resources.',
      content:
        '# Team onboarding\n\nCreate an onboarding document from provided resources.\n\n## Steps\n1. Select a connected Slack account or custom bot with access to the channel or canvas.\n2. When a new teammate joins, turn the provided team resources into Markdown and create an onboarding canvas in the selected Slack channel.\n3. Use Markdown for canvas content. For targeted edits, look up section IDs first. Get Canvas Metadata returns metadata, not the document body.\n4. Return the canvas ID or edit confirmation.\n\n## Output\nReturn the result and source resource IDs.\n\n## Reference\nhttps://docs.slack.dev/surfaces/canvases/',
    },
    {
      name: 'maintain-incident-canvas',
      description: 'Create and append incident notes from supplied facts.',
      content:
        '# Incident notes\n\nCreate and append incident notes from supplied facts.\n\n## Steps\n1. Select a connected Slack account or custom bot with access to the channel or canvas.\n2. When an incident opens, create a canvas from the supplied incident details; append supplied updates as the response progresses.\n3. Use Markdown for canvas content. For targeted edits, look up section IDs first. Get Canvas Metadata returns metadata, not the document body.\n4. Return the canvas ID or edit confirmation.\n\n## Output\nReturn the result and source resource IDs.\n\n## Reference\nhttps://docs.slack.dev/surfaces/canvases/',
    },
    {
      name: 'create-channel-hub',
      description: 'Create a channel canvas containing team resources.',
      content:
        '# Channel resource hub\n\nCreate a channel canvas containing team resources.\n\n## Steps\n1. Select a connected Slack account or custom bot with access to the channel or canvas.\n2. When a team channel launches, create its channel canvas with provided links, ownership, and working agreements.\n3. Use Markdown for canvas content. For targeted edits, look up section IDs first. Get Canvas Metadata returns metadata, not the document body.\n4. Return the canvas ID or edit confirmation.\n\n## Output\nReturn the result and source resource IDs.\n\n## Reference\nhttps://docs.slack.dev/surfaces/canvases/',
    },
    {
      name: 'update-feedback-guidelines',
      description: 'Find and replace a section containing feedback instructions.',
      content:
        '# Feedback guidelines\n\nFind and replace a section containing feedback instructions.\n\n## Steps\n1. Select a connected Slack account or custom bot with access to the channel or canvas.\n2. When feedback guidelines change, find the matching canvas section and replace it with the provided Markdown instructions.\n3. Use Markdown for canvas content. For targeted edits, look up section IDs first. Get Canvas Metadata returns metadata, not the document body.\n4. Return the canvas ID or edit confirmation.\n\n## Output\nReturn the result and source resource IDs.\n\n## Reference\nhttps://docs.slack.dev/surfaces/canvases/',
    },
    {
      name: 'append-project-status',
      description: 'Append provided project status to a Slack canvas.',
      content:
        '# Project status notes\n\nAppend provided project status to a Slack canvas.\n\n## Steps\n1. Select a connected Slack account or custom bot with access to the channel or canvas.\n2. On a weekly schedule, format the supplied project status as Markdown and append it to the selected canvas.\n3. Use Markdown for canvas content. For targeted edits, look up section IDs first. Get Canvas Metadata returns metadata, not the document body.\n4. Return the canvas ID or edit confirmation.\n\n## Output\nReturn the result and source resource IDs.\n\n## Reference\nhttps://docs.slack.dev/surfaces/canvases/',
    },
  ],
} as const satisfies BlockMeta
