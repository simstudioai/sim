import { FigmaIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalBooleanInput, parseOptionalNumberInput } from '@/blocks/utils'

export const FigmaBlock: BlockConfig = {
  type: 'figma',
  name: 'Figma',
  description: 'Read designs, export assets, and manage Figma feedback',
  authMode: AuthMode.OAuth,
  longDescription:
    'Connect a Figma account to read file metadata, document contents, selected nodes, image fills, comments, versions, and published library components/styles, export nodes, and create or delete your own comments. Supply a file key or an HTTPS Figma file URL; node reads and exports require comma-separated node IDs. Sim limits each node-ID input to 1000 IDs and 64 Ki characters before normalization. Advanced mode supports version, depth, geometry, plugin data, branch data, rendering controls, comment positioning, and version cursors. Export URLs expire after 30 days, and image-fill URLs expire within 14 days; null render entries indicate nodes that could not be rendered. The integration returns URLs without downloading assets. Version history returns one page (30 entries by default, maximum 50); use string before/after cursors from pagination links to request another page. Published components/styles require a main-file key and a published library; local unpublished resources are available through file contents. OAuth requires current_user:read, file_metadata:read, file_content:read, file_comments:read, file_comments:write, file_versions:read, and library_content:read. Self-hosted deployments need FIGMA_CLIENT_ID and FIGMA_CLIENT_SECRET with /api/auth/oauth2/callback/figma registered on the deployment URL. Draft OAuth apps can be used by their owners; public app approval is required for wider use. Figma plan and seat rate limits apply; permission errors and failed responses use standard workflow error handling. Each response is limited to 10 MiB; narrow large document requests with node IDs/depth. Account-wide file discovery, canvas editing, variables, and triggers are outside this integration.',
  docsLink: 'https://docs.sim.ai/integrations/figma',
  category: 'tools',
  integrationType: IntegrationType.Productivity,
  bgColor: '#FFFFFF',
  icon: FigmaIcon,
  canvasPresentation: {
    defaultTitle: 'Figma',
    sentences: {
      byOperation: {
        get_file_metadata: [{ text: 'Read metadata for', field: 'fileKey', core: true }],
        get_file: [
          { text: 'Read contents of', field: 'fileKey', core: true },
          { text: ', limited to nodes', field: 'nodeIds' },
        ],
        get_file_nodes: [
          { text: 'Read nodes in', field: 'fileKey', core: true },
          { text: ', with IDs', field: 'nodeIds', core: true },
        ],
        export_nodes: [
          { text: 'Export nodes in', field: 'fileKey', core: true },
          { text: ', with IDs', field: 'nodeIds', core: true },
          { text: ', as', field: 'format' },
        ],
        get_image_fills: [{ text: 'Read image fills in', field: 'fileKey', core: true }],
        list_comments: [{ text: 'List comments in', field: 'fileKey', core: true }],
        create_comment: [
          { text: 'Post feedback in', field: 'fileKey', core: true },
          { text: ', saying', field: 'message', core: true },
        ],
        delete_comment: [
          { text: 'Delete a comment in', field: 'fileKey', core: true },
          { text: ', with ID', field: 'commentId', core: true },
        ],
        list_file_versions: [{ text: 'List versions of', field: 'fileKey', core: true }],
        list_file_components: [
          { text: 'List published components in', field: 'fileKey', core: true },
        ],
        list_file_styles: [{ text: 'List published styles in', field: 'fileKey', core: true }],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { id: 'get_file_metadata', label: 'Get File Metadata' },
        { id: 'get_file', label: 'Get File Contents' },
        { id: 'get_file_nodes', label: 'Get File Nodes' },
        { id: 'export_nodes', label: 'Export Nodes' },
        { id: 'get_image_fills', label: 'Get Image Fills' },
        { id: 'list_comments', label: 'List Comments' },
        { id: 'create_comment', label: 'Create Comment' },
        { id: 'delete_comment', label: 'Delete Comment' },
        { id: 'list_file_versions', label: 'List File Versions' },
        { id: 'list_file_components', label: 'List File Components' },
        { id: 'list_file_styles', label: 'List File Styles' },
      ],
      value: () => 'get_file_metadata',
    },
    {
      id: 'credential',
      title: 'Figma Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      serviceId: 'figma',
      placeholder: 'Connect a Figma account',
      required: true,
      mode: 'basic',
      requiredScopes: getScopesForService('figma'),
    },
    {
      id: 'manualCredential',
      title: 'Figma Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      placeholder: 'Enter credential ID',
      required: true,
      mode: 'advanced',
    },
    {
      id: 'fileKey',
      title: 'File URL or Key',
      type: 'short-input',
      placeholder: 'https://www.figma.com/design/FILE_KEY/Design',
      required: true,
    },
    {
      id: 'nodeIds',
      title: 'Node IDs',
      type: 'short-input',
      placeholder: '12:34,56:78 (URL node-id=12-34 is accepted)',
      wandConfig: {
        enabled: true,
        placeholder: 'Paste node IDs or links to format',
        prompt:
          'Format the supplied Figma node IDs as a comma-separated list. Convert numeric URL node-id values such as 12-34 to 12:34. Preserve IDs and do not invent them. Return ONLY the comma-separated IDs.',
      },
      required: { field: 'operation', value: ['get_file_nodes', 'export_nodes'] },
      condition: { field: 'operation', value: ['get_file', 'get_file_nodes', 'export_nodes'] },
    },
    {
      id: 'version',
      title: 'Version ID',
      type: 'short-input',
      placeholder: 'Specific version ID; empty uses current version',
      condition: { field: 'operation', value: ['get_file', 'get_file_nodes', 'export_nodes'] },
      mode: 'advanced',
    },
    {
      id: 'depth',
      title: 'Depth',
      type: 'short-input',
      placeholder: 'Positive integer; empty includes all descendants',
      condition: { field: 'operation', value: ['get_file', 'get_file_nodes'] },
      mode: 'advanced',
    },
    {
      id: 'geometry',
      title: 'Vector Geometry',
      type: 'dropdown',
      placeholder: 'Optional vector paths',
      options: [
        { label: 'Default', id: '' },
        { label: 'Include Paths', id: 'paths' },
      ],
      condition: { field: 'operation', value: ['get_file', 'get_file_nodes'] },
      mode: 'advanced',
    },
    {
      id: 'pluginData',
      title: 'Plugin Data',
      type: 'short-input',
      placeholder: 'Plugin IDs separated by commas, optionally shared',
      wandConfig: {
        enabled: true,
        placeholder: 'Plugin IDs and whether shared data is needed',
        prompt:
          'Format supplied Figma plugin IDs and optionally shared as a comma-separated list. Preserve supplied IDs and do not invent them. Return ONLY the comma-separated values.',
      },
      condition: { field: 'operation', value: ['get_file', 'get_file_nodes'] },
      mode: 'advanced',
    },
    {
      id: 'branchData',
      title: 'Include Branch Data',
      type: 'switch',
      placeholder: '',
      condition: { field: 'operation', value: ['get_file'] },
      mode: 'advanced',
    },
    {
      id: 'format',
      title: 'Format',
      type: 'dropdown',
      placeholder: 'Select export format',
      options: [
        { id: 'png', label: 'PNG' },
        { id: 'jpg', label: 'JPG' },
        { id: 'svg', label: 'SVG' },
        { id: 'pdf', label: 'PDF' },
      ],
      condition: { field: 'operation', value: ['export_nodes'] },
      value: () => 'png',
    },
    {
      id: 'scale',
      title: 'Scale',
      type: 'short-input',
      placeholder: '0.01–4; empty uses Figma default',
      condition: { field: 'operation', value: ['export_nodes'] },
      mode: 'advanced',
    },
    {
      id: 'svgOutlineText',
      title: 'Outline SVG Text',
      type: 'switch',
      placeholder: '',
      condition: {
        field: 'operation',
        value: ['export_nodes'],
        and: { field: 'format', value: 'svg' },
      },
      mode: 'advanced',
      value: () => 'true',
    },
    {
      id: 'svgIncludeId',
      title: 'Include SVG Layer IDs',
      type: 'switch',
      placeholder: '',
      condition: {
        field: 'operation',
        value: ['export_nodes'],
        and: { field: 'format', value: 'svg' },
      },
      mode: 'advanced',
      value: () => 'false',
    },
    {
      id: 'svgIncludeNodeId',
      title: 'Include SVG Node IDs',
      type: 'switch',
      placeholder: '',
      condition: {
        field: 'operation',
        value: ['export_nodes'],
        and: { field: 'format', value: 'svg' },
      },
      mode: 'advanced',
      value: () => 'false',
    },
    {
      id: 'svgSimplifyStroke',
      title: 'Simplify SVG Strokes',
      type: 'switch',
      placeholder: '',
      condition: {
        field: 'operation',
        value: ['export_nodes'],
        and: { field: 'format', value: 'svg' },
      },
      mode: 'advanced',
      value: () => 'true',
    },
    {
      id: 'contentsOnly',
      title: 'Export Contents Only',
      type: 'switch',
      placeholder: '',
      condition: { field: 'operation', value: ['export_nodes'] },
      mode: 'advanced',
      value: () => 'true',
    },
    {
      id: 'useAbsoluteBounds',
      title: 'Use Absolute Bounds',
      type: 'switch',
      placeholder: '',
      condition: { field: 'operation', value: ['export_nodes'] },
      mode: 'advanced',
      value: () => 'false',
    },
    {
      id: 'asMarkdown',
      title: 'Markdown Comments',
      type: 'switch',
      placeholder: '',
      condition: { field: 'operation', value: ['list_comments'] },
      mode: 'advanced',
    },
    {
      id: 'message',
      title: 'Message',
      type: 'long-input',
      placeholder: 'Feedback for the design',
      required: true,
      condition: { field: 'operation', value: ['create_comment'] },
    },
    {
      id: 'replyToCommentId',
      title: 'Reply to Root Comment',
      type: 'short-input',
      placeholder: 'Root comment ID; empty creates a new thread',
      condition: { field: 'operation', value: ['create_comment'] },
      mode: 'advanced',
    },
    {
      id: 'clientMeta',
      title: 'Position',
      type: 'code',
      placeholder: '{"node_id":"12:34","node_offset":{"x":20,"y":30}}',
      language: 'json',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe coordinates or a supplied node and offset',
        prompt:
          'Generate JSON for a Figma comment position. Use either {"x":number,"y":number} for canvas coordinates or {"node_id":string,"node_offset":{"x":number,"y":number}} for frame-relative coordinates. For regions add positive region_width and region_height and optionally comment_pin_corner (top-left, top-right, bottom-left, bottom-right). Do not invent node IDs. Return ONLY the JSON.',
      },
      condition: { field: 'operation', value: ['create_comment'] },
      mode: 'advanced',
    },
    {
      id: 'commentId',
      title: 'Comment ID',
      type: 'short-input',
      placeholder: 'Comment ID to delete; only your own comments',
      required: true,
      condition: { field: 'operation', value: ['delete_comment'] },
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '30 (maximum 50)',
      condition: { field: 'operation', value: ['list_file_versions'] },
      mode: 'advanced',
    },
    {
      id: 'before',
      title: 'Before Version ID',
      type: 'short-input',
      placeholder: 'String version ID from the previous page link',
      condition: { field: 'operation', value: ['list_file_versions'] },
      mode: 'advanced',
    },
    {
      id: 'after',
      title: 'After Version ID',
      type: 'short-input',
      placeholder: 'String version ID from the next page link',
      condition: { field: 'operation', value: ['list_file_versions'] },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'figma_get_file_metadata',
      'figma_get_file',
      'figma_get_file_nodes',
      'figma_export_nodes',
      'figma_get_image_fills',
      'figma_list_comments',
      'figma_create_comment',
      'figma_delete_comment',
      'figma_list_file_versions',
      'figma_list_file_components',
      'figma_list_file_styles',
    ],
    config: {
      tool: (params) => {
        const operation = params.operation ?? 'get_file_metadata'
        if (
          ![
            'get_file_metadata',
            'get_file',
            'get_file_nodes',
            'export_nodes',
            'get_image_fills',
            'list_comments',
            'create_comment',
            'delete_comment',
            'list_file_versions',
            'list_file_components',
            'list_file_styles',
          ].includes(operation)
        )
          throw new Error(`Invalid Figma operation: ${operation}`)
        return `figma_${operation}`
      },
      params: (params) => {
        const operation = params.operation ?? 'get_file_metadata'
        const common = { fileKey: params.fileKey, credential: params.oauthCredential }
        switch (operation) {
          case 'get_file':
          case 'get_file_nodes':
            return {
              ...common,
              nodeIds: params.nodeIds,
              version: params.version,
              geometry: params.geometry,
              pluginData: params.pluginData,
              depth: parseOptionalNumberInput(params.depth, 'Depth', { min: 1, integer: true }),
              ...(operation === 'get_file'
                ? { branchData: parseOptionalBooleanInput(params.branchData) }
                : {}),
            }
          case 'export_nodes':
            return {
              ...common,
              nodeIds: params.nodeIds,
              version: params.version,
              format: params.format,
              scale: parseOptionalNumberInput(params.scale, 'Scale', { min: 0.01, max: 4 }),
              contentsOnly: parseOptionalBooleanInput(params.contentsOnly),
              useAbsoluteBounds: parseOptionalBooleanInput(params.useAbsoluteBounds),
              ...(params.format === 'svg'
                ? {
                    svgOutlineText: parseOptionalBooleanInput(params.svgOutlineText),
                    svgIncludeId: parseOptionalBooleanInput(params.svgIncludeId),
                    svgIncludeNodeId: parseOptionalBooleanInput(params.svgIncludeNodeId),
                    svgSimplifyStroke: parseOptionalBooleanInput(params.svgSimplifyStroke),
                  }
                : {}),
            }
          case 'list_comments':
            return { ...common, asMarkdown: parseOptionalBooleanInput(params.asMarkdown) }
          case 'create_comment':
            return {
              ...common,
              message: params.message,
              replyToCommentId: params.replyToCommentId,
              clientMeta: params.clientMeta,
            }
          case 'delete_comment':
            return { ...common, commentId: params.commentId }
          case 'list_file_versions':
            return {
              ...common,
              before: params.before,
              after: params.after,
              pageSize: parseOptionalNumberInput(params.pageSize, 'Page Size', {
                min: 1,
                max: 50,
                integer: true,
              }),
            }
          default:
            return common
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Figma operation' },
    oauthCredential: { type: 'string', description: 'Figma OAuth credential ID' },
    fileKey: { type: 'string', description: 'File URL or Key' },
    nodeIds: { type: 'string', description: 'Node IDs' },
    version: { type: 'string', description: 'Version ID' },
    depth: { type: 'number', description: 'Depth' },
    geometry: { type: 'string', description: 'Vector Geometry' },
    pluginData: { type: 'string', description: 'Plugin Data' },
    branchData: { type: 'boolean', description: 'Include Branch Data' },
    format: { type: 'string', description: 'Format' },
    scale: { type: 'number', description: 'Scale' },
    svgOutlineText: { type: 'boolean', description: 'Outline SVG Text' },
    svgIncludeId: { type: 'boolean', description: 'Include SVG Layer IDs' },
    svgIncludeNodeId: { type: 'boolean', description: 'Include SVG Node IDs' },
    svgSimplifyStroke: { type: 'boolean', description: 'Simplify SVG Strokes' },
    contentsOnly: { type: 'boolean', description: 'Export Contents Only' },
    useAbsoluteBounds: { type: 'boolean', description: 'Use Absolute Bounds' },
    asMarkdown: { type: 'boolean', description: 'Markdown Comments' },
    message: { type: 'string', description: 'Message' },
    replyToCommentId: { type: 'string', description: 'Reply to Root Comment' },
    clientMeta: { type: 'json', description: 'Position' },
    commentId: { type: 'string', description: 'Comment ID' },
    pageSize: { type: 'number', description: 'Page Size' },
    before: { type: 'string', description: 'Before Version ID' },
    after: { type: 'string', description: 'After Version ID' },
  },
  outputs: {
    file: {
      type: 'json',
      description: 'Lightweight file metadata, including creator and last editor',
      condition: { field: 'operation', value: ['get_file_metadata'] },
    },
    name: {
      type: 'string',
      description: 'File name',
      condition: { field: 'operation', value: ['get_file', 'get_file_nodes'] },
    },
    role: {
      type: 'string',
      description: 'Caller role',
      condition: { field: 'operation', value: ['get_file', 'get_file_nodes'] },
    },
    lastModified: {
      type: 'string',
      description: 'Last modification timestamp',
      condition: { field: 'operation', value: ['get_file', 'get_file_nodes'] },
    },
    editorType: {
      type: 'string',
      description: 'Figma editor type',
      condition: { field: 'operation', value: ['get_file', 'get_file_nodes'] },
    },
    thumbnailUrl: {
      type: 'string',
      description: 'Thumbnail URL or null',
      condition: { field: 'operation', value: ['get_file', 'get_file_nodes'] },
    },
    version: {
      type: 'string',
      description: 'File version ID',
      condition: { field: 'operation', value: ['get_file', 'get_file_nodes'] },
    },
    document: {
      type: 'json',
      description: 'Recursive document tree with native node properties',
      condition: { field: 'operation', value: ['get_file'] },
    },
    schemaVersion: {
      type: 'number',
      description: 'Document schema version',
      condition: { field: 'operation', value: ['get_file'] },
    },
    linkAccess: {
      type: 'string',
      description: 'Link access policy or null',
      condition: { field: 'operation', value: ['get_file'] },
    },
    mainFileKey: {
      type: 'string',
      description: 'Main file key for a branch, or null',
      condition: { field: 'operation', value: ['get_file'] },
    },
    branches: {
      type: 'json',
      description: 'Requested branch metadata',
      condition: { field: 'operation', value: ['get_file'] },
    },
    components: {
      type: 'json',
      description:
        'Component metadata map for contents; published component array for library listings',
      condition: { field: 'operation', value: ['get_file', 'list_file_components'] },
    },
    componentSets: {
      type: 'json',
      description: 'Component-set metadata keyed by node ID',
      condition: { field: 'operation', value: ['get_file'] },
    },
    styles: {
      type: 'json',
      description: 'Style metadata map for contents; published style array for library listings',
      condition: { field: 'operation', value: ['get_file', 'list_file_styles'] },
    },
    nodes: {
      type: 'json',
      description: 'Node data keyed by requested node ID; missing nodes are null',
      condition: { field: 'operation', value: ['get_file_nodes'] },
    },
    images: {
      type: 'json',
      description:
        'Temporary export URLs by node ID (null for failed renders), or original image-fill URLs by image reference',
      condition: { field: 'operation', value: ['export_nodes', 'get_image_fills'] },
    },
    err: {
      type: 'string',
      description: 'Rendering error message or null',
      condition: { field: 'operation', value: ['export_nodes'] },
    },
    status: {
      type: 'number',
      description: 'Optional rendering status or null',
      condition: { field: 'operation', value: ['export_nodes'] },
    },
    comments: {
      type: 'json',
      description: 'File comments and replies, including positions, authors, and reactions',
      condition: { field: 'operation', value: ['list_comments'] },
    },
    comment: {
      type: 'json',
      description: 'Created comment or reply',
      condition: { field: 'operation', value: ['create_comment'] },
    },
    deleted: {
      type: 'boolean',
      description: 'Whether Figma accepted comment deletion',
      condition: { field: 'operation', value: ['delete_comment'] },
    },
    versions: {
      type: 'json',
      description: 'One page of version history with string IDs and author metadata',
      condition: { field: 'operation', value: ['list_file_versions'] },
    },
    pagination: {
      type: 'json',
      description:
        'Previous and next page URLs or null; parse the before/after cursors without numeric conversion',
      condition: { field: 'operation', value: ['list_file_versions'] },
    },
  },
}

export const FigmaBlockMeta = {
  tags: ['content-management', 'project-management', 'automation'],
  url: 'https://www.figma.com',
  templates: [
    {
      title: 'Design handoff brief',
      prompt:
        'Build a manually started workflow that reads selected Figma nodes, summarizes layout/text/assets with an Agent, and writes a developer handoff brief to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['design', 'automation'],
      icon: FigmaIcon,
    },
    {
      title: 'Asset export manifest',
      prompt:
        'Build a manually started workflow that exports supplied Figma nodes as PNG, checks for null renderings, and records temporary URLs with their file and node IDs in a table.',
      modules: ['tables', 'workflows'],
      category: 'engineering',
      tags: ['design', 'automation'],
      icon: FigmaIcon,
    },
    {
      title: 'Feedback digest',
      prompt:
        'Create a scheduled workflow that lists Figma file comments, groups unresolved feedback with an Agent, and sends a digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['design', 'automation'],
      alsoIntegrations: ['slack'],
      icon: FigmaIcon,
    },
    {
      title: 'Version review summary',
      prompt:
        'Build a manually started workflow that lists one page of Figma versions, reads two selected versions of the same nodes, and summarizes design changes with an Agent.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['design', 'automation'],
      icon: FigmaIcon,
    },
    {
      title: 'Published component inventory',
      prompt:
        'Create a scheduled workflow that lists published components from a main Figma library file, groups components by containing frame, and upserts an inventory table.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['design', 'automation'],
      icon: FigmaIcon,
    },
    {
      title: 'Published style inventory',
      prompt:
        'Create a scheduled workflow that lists published Figma styles, groups them by style_type, and writes a design-system inventory to a table.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'engineering',
      tags: ['design', 'automation'],
      icon: FigmaIcon,
    },
    {
      title: 'Design review follow-up',
      prompt:
        'Build a manually started workflow that reads selected Figma nodes, drafts actionable feedback with an Agent, and posts a comment at a supplied node-relative position.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['design', 'automation'],
      icon: FigmaIcon,
    },
  ],
  skills: [
    {
      name: 'prepare-design-handoff',
      description: 'Summarize selected design nodes for an implementation handoff.',
      content:
        '# Design handoff\n\n## Steps\n\n1. Ask for a file URL/key and the node IDs being handed off.\n2. Read those nodes at a supplied version, using depth when a bounded summary is enough.\n3. Summarize native text, layout, paints, and component references. Preserve IDs and flag missing nodes.\n4. Export requested assets separately; report temporary URLs and null renderings. Do not claim to edit the canvas or mark designs ready for development.\n\n## Output\n\nReturn an implementation brief with node IDs, layout/text details, asset references, and unresolved questions. Flag missing nodes and keep the summary scoped to the selected version and depth.\n\nSource: https://www.figma.com/best-practices/guide-to-developer-handoff/',
    },
    {
      name: 'export-design-assets',
      description: 'Export selected Figma nodes and report unavailable renderings.',
      content:
        '# Export assets\n\n## Steps\n\n1. Confirm file, node IDs, output format, and scale.\n2. Export only the requested nodes; SVG options apply to SVG.\n3. Return URLs with node IDs, label null entries as failed renderings, and report tool failures.\n4. Explain that URLs expire after 30 days. This block does not download or store them.\n\n## Output\n\nReturn an asset manifest with node IDs, format, temporary URLs, and failed renderings. Explain expiration and keep asset downloads outside this block.\n\nSource: https://help.figma.com/hc/en-us/articles/15023124644247-Guide-to-Dev-Mode\nAPI: https://developers.figma.com/docs/rest-api/file-endpoints/',
    },
    {
      name: 'summarize-design-feedback',
      description:
        'Group unresolved design feedback while retaining comment and author identifiers.',
      content:
        '# Summarize feedback\n\n## Steps\n\n1. List comments for the supplied file.\n2. Separate resolved threads from unresolved feedback and associate replies using parent_id.\n3. Group actionable requests by referenced node/position and preserve comment IDs.\n4. If asked to reply, create a comment using the root-comment ID. Delete only comments the user explicitly selects and owns.\n\n## Output\n\nReturn grouped actionable feedback with comment IDs, authors, referenced nodes, and root-thread IDs. Keep resolved threads separate and preserve reply context.\n\nSource: https://www.figma.com/best-practices/tips-on-developer-handoff/\nAPI: https://developers.figma.com/docs/rest-api/comments-endpoints/',
    },
    {
      name: 'review-design-versions',
      description: 'Read explicit file versions to produce a scoped change summary.',
      content:
        '# Review versions\n\n## Steps\n\n1. List one version-history page for the file.\n2. If needed, parse before/after from pagination links and request additional pages individually, keeping cursor IDs as strings.\n3. Confirm the two version IDs and relevant nodes; read each version.\n4. Compare those nodes and describe changes without claiming a complete diff for omitted descendants or nodes.\n\n## Output\n\nReturn a scoped change summary referencing both version IDs and compared node IDs. Describe pagination or depth limits and avoid claiming a complete file diff.\n\nSource: https://help.figma.com/hc/en-us/articles/15023124644247-Guide-to-Dev-Mode\nAPI: https://developers.figma.com/docs/rest-api/version-history-endpoints/',
    },
    {
      name: 'inventory-published-library',
      description: 'Inventory published components and styles from a main library file.',
      content:
        '# Published library inventory\n\n## Steps\n\n1. Confirm a main-file key, not a branch key.\n2. List published components and styles separately.\n3. Record stable keys, names, descriptions, node IDs, timestamps, authors, style types, and containing-frame metadata.\n4. An empty published list does not mean the file has no local resources. Read file contents to inspect local maps if needed. This block does not publish a library.\n\n## Output\n\nReturn published component and style inventories with stable keys and source node IDs. Explain empty published lists separately from local unpublished resources.\n\nSource: https://help.figma.com/hc/en-us/articles/360025508373-Publish-a-library\nAPI: https://developers.figma.com/docs/rest-api/component-endpoints/',
    },
  ],
} as const satisfies BlockMeta
