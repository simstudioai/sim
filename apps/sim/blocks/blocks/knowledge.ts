import { isPlainRecord } from '@sim/utils/object'
import { PackageSearchIcon } from '@/components/icons'
import { MAX_KNOWLEDGE_LIST_LIMIT } from '@/lib/api/contracts/knowledge/folders'
import {
  encodeFolderPathSegment,
  MAX_FOLDER_PATH_SEGMENTS,
  ROOT_FOLDER_PATH,
} from '@/lib/folders/paths'
import { DEFAULT_RERANKER_MODEL, SUPPORTED_RERANKER_MODELS } from '@/lib/knowledge/reranker-models'
import { readFolderPath } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/sim-folder-tree-selector/selection'
import type { BlockConfig } from '@/blocks/types'
import { getCohereRerankerApiKeyCondition, parseOptionalNumberInput } from '@/blocks/utils'

/**
 * Canonical basic/advanced pairs, shared by the card sentences below. Listing
 * both members is what keeps the sentence working for an advanced-mode user,
 * who has only the manual field filled.
 */
const KNOWLEDGE_BASE_FIELD = ['knowledgeBaseSelector', 'manualKnowledgeBaseId'] as const
const DOCUMENT_FIELD = ['documentSelector', 'documentId'] as const
const SEARCH_FOLDER_FIELD = ['searchFolder', 'manualSearchFolder'] as const
/**
 * Search takes either a knowledge base or a folder standing for the knowledge
 * bases inside it, so the clause names whichever one the card actually carries.
 */
const SEARCH_TARGET_FIELD = [...KNOWLEDGE_BASE_FIELD, ...SEARCH_FOLDER_FIELD] as const
const FOLDER_FIELD = ['folderPath', 'manualFolderPath'] as const
const CREATE_PARENT_FIELD = ['createParentPath', 'manualCreateParentPath'] as const
const DESTINATION_PARENT_FIELD = ['destinationParentPath', 'manualDestinationParentPath'] as const

/** The operations that address a knowledge base. The folder operations do not. */
const KNOWLEDGE_BASE_OPERATIONS = [
  'search',
  'list_documents',
  'get_document',
  'create_document',
  'upsert_document',
  'delete_document',
  'list_chunks',
  'upload_chunk',
  'update_chunk',
  'delete_chunk',
  'list_tags',
  'list_connectors',
  'get_connector',
  'trigger_sync',
] as const

/**
 * Search is absent: a folder alone is a valid target there, so requiring a
 * knowledge base would reject a well-formed folder-scoped search.
 */
const KNOWLEDGE_BASE_REQUIRED_OPERATIONS = KNOWLEDGE_BASE_OPERATIONS.filter(
  (operation) => operation !== 'search'
)

const FOLDER_OPERATIONS = [
  'list_folders',
  'create_folder',
  'update_folder',
  'delete_folder',
] as const

/**
 * The folder field, and the switch saying how deep it reaches, as the knowledge
 * base picker beside it needs them: a picker offering knowledge bases outside
 * the chosen folder would let a selection be built that the run then ignores.
 */
const SEARCH_FOLDER_SCOPE = {
  fieldId: 'searchFolder',
  /*
   * The advanced half of the same canonical pair. Naming only the basic field
   * would read as "no folder" for anyone typing a path in advanced mode, and the
   * picker would then offer knowledge bases the folder excludes.
   */
  manualFieldId: 'manualSearchFolder',
  recursiveFieldId: 'searchFolderIncludeSubfolders',
} as const

/**
 * An untouched text subblock arrives as '', not undefined, and '' is not a
 * canonical folder path — so an omitted optional path has to be normalized away
 * rather than forwarded. A switch arrives as either a boolean or the string
 * 'true' depending on how it was set.
 */
function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function switchValue(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback
  return value === true || value === 'true'
}

/**
 * The prefix a child path hangs off. The workspace root contributes nothing, so
 * a child of the root is `/name` rather than `//name`.
 */
function folderPathPrefix(parentPath: string | undefined): string {
  return parentPath && parentPath !== ROOT_FOLDER_PATH ? parentPath : ''
}

/**
 * The folder scope on search: which knowledge bases the run looks at.
 *
 * Kept as a path rather than the knowledge bases it holds today, because the
 * tool expands it when the workflow runs — so a folder means whatever is inside
 * it then, and a knowledge base added tomorrow is searched tomorrow.
 *
 * The workspace root reads as no scope at all. Root is the absence of a
 * selection here, not a value: the tree offers no root row, and "the whole
 * workspace" is what the Knowledge Base picker already covers unfiltered. A
 * root path typed into the manual field therefore narrows nothing, and the
 * caller still has to name what to search.
 */
function folderScopePath(value: unknown): string | undefined {
  const path = readFolderPath(value)
  return path === ROOT_FOLDER_PATH ? undefined : path || undefined
}

export const KnowledgeBlock: BlockConfig = {
  type: 'knowledge',
  name: 'Knowledge',
  description: 'Use vector search',
  longDescription:
    'Integrate Knowledge into the workflow. Perform full CRUD operations on documents, chunks, and tags.',
  bestPractices: `
  - Clarify which tags are available for the knowledge base to understand whether to use tag filters on a search.
  - Use List Documents to enumerate documents before operating on them.
  - Use Get Document to retrieve full details including tags, connector metadata, and processing status.
  - Use List Chunks to inspect a document's contents before updating or deleting chunks.
  - Use List Connectors to see which external sources are syncing documents into the knowledge base.
  - Use Get Connector to check sync health and review recent sync logs.
  `,
  bgColor: '#00B0B0',
  icon: PackageSearchIcon,
  canvasPresentation: {
    defaultTitle: 'Knowledge',
    sentences: {
      byOperation: {
        search: [
          { text: 'Search', field: SEARCH_TARGET_FIELD, core: true },
          { text: 'for', field: 'query' },
          { text: ', returning top', field: 'topK', after: 'matches' },
        ],
        list_documents: [
          { text: 'List documents in', field: KNOWLEDGE_BASE_FIELD, core: true },
          { text: ', matching', field: 'search' },
          { text: ', up to', field: 'limit', after: 'documents' },
        ],
        get_document: [
          { text: 'Read document', field: DOCUMENT_FIELD, core: true },
          { text: 'from', field: KNOWLEDGE_BASE_FIELD },
        ],
        create_document: [
          { text: 'Create document', field: 'name', core: true },
          { text: 'in', field: KNOWLEDGE_BASE_FIELD, core: true },
        ],
        upsert_document: [
          { text: 'Upsert document', field: 'name', core: true },
          { text: 'into', field: KNOWLEDGE_BASE_FIELD, core: true },
        ],
        delete_document: [
          { text: 'Delete document', field: DOCUMENT_FIELD, core: true },
          { text: 'from', field: KNOWLEDGE_BASE_FIELD },
        ],
        list_chunks: [
          { text: 'List chunks of document', field: DOCUMENT_FIELD, core: true },
          { text: ', matching', field: 'chunkSearch' },
          { text: ', up to', field: 'limit', after: 'chunks' },
        ],
        upload_chunk: [
          { text: 'Add a chunk to document', field: DOCUMENT_FIELD, core: true },
          { text: 'in', field: KNOWLEDGE_BASE_FIELD },
        ],
        update_chunk: [
          { text: 'Rewrite chunk', field: 'chunkId', core: true },
          { text: 'of document', field: DOCUMENT_FIELD },
        ],
        delete_chunk: [
          { text: 'Delete chunk', field: 'chunkId', core: true },
          { text: 'from document', field: DOCUMENT_FIELD },
        ],
        list_tags: [{ text: 'List tags defined on', field: KNOWLEDGE_BASE_FIELD, core: true }],
        list_connectors: [
          { text: 'List connectors syncing into', field: KNOWLEDGE_BASE_FIELD, core: true },
        ],
        get_connector: [
          { text: 'Read connector', field: 'connectorId', core: true },
          { text: 'on', field: KNOWLEDGE_BASE_FIELD },
        ],
        trigger_sync: [
          { text: 'Start a sync on connector', field: 'connectorId', core: true },
          { text: 'in', field: KNOWLEDGE_BASE_FIELD },
        ],
        list_folders: ['List folders', { text: 'in', field: FOLDER_FIELD }],
        create_folder: [
          { text: 'Create folder', field: 'folderName', core: true },
          { text: 'in', field: CREATE_PARENT_FIELD },
        ],
        update_folder: [
          { text: 'Move folder', field: FOLDER_FIELD, core: true },
          { text: 'into', field: DESTINATION_PARENT_FIELD },
        ],
        delete_folder: [{ text: 'Delete folder', field: FOLDER_FIELD, core: true }],
      },
    },
  },
  category: 'blocks',
  docsLink: 'https://docs.sim.ai/integrations/knowledge',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search', id: 'search' },
        { label: 'List Documents', id: 'list_documents' },
        { label: 'Get Document', id: 'get_document' },
        { label: 'Create Document', id: 'create_document' },
        { label: 'Upsert Document', id: 'upsert_document' },
        { label: 'Delete Document', id: 'delete_document' },
        { label: 'List Chunks', id: 'list_chunks' },
        { label: 'Upload Chunk', id: 'upload_chunk' },
        { label: 'Update Chunk', id: 'update_chunk' },
        { label: 'Delete Chunk', id: 'delete_chunk' },
        { label: 'List Tags', id: 'list_tags' },
        { label: 'List Connectors', id: 'list_connectors' },
        { label: 'Get Connector', id: 'get_connector' },
        { label: 'Trigger Sync', id: 'trigger_sync' },
        { label: 'List Folders', id: 'list_folders' },
        { label: 'Create Folder', id: 'create_folder' },
        { label: 'Move Folder', id: 'update_folder' },
        { label: 'Delete Folder', id: 'delete_folder' },
      ],
      value: () => 'search',
    },
    {
      id: 'searchFolder',
      title: 'Folder',
      type: 'sim-folder-tree-selector',
      resourceType: 'knowledge_base',
      canonicalParamId: 'searchFolderRef',
      mode: 'basic',
      placeholder: 'Anywhere in the workspace',
      description:
        'Narrows the knowledge bases below. With none picked, searches every knowledge base in the folder; pick one and only it is searched.',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'manualSearchFolder',
      title: 'Folder Path',
      type: 'short-input',
      canonicalParamId: 'searchFolderRef',
      mode: 'advanced',
      placeholder: '/Support/Tier1',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'searchFolderIncludeSubfolders',
      title: 'Include Subfolders',
      type: 'switch',
      /* Controls nothing until a folder is chosen, so it does not render until one is. */
      condition: {
        field: 'operation',
        value: 'search',
        and: { field: 'searchFolderRef', value: '', not: true },
      },
    },
    // Knowledge base selector - basic mode
    {
      id: 'knowledgeBaseSelector',
      title: 'Knowledge Base',
      type: 'knowledge-base-selector',
      canonicalParamId: 'knowledgeBaseId',
      placeholder: 'Select knowledge base',
      multiSelect: false,
      folderScope: SEARCH_FOLDER_SCOPE,
      required: { field: 'operation', value: [...KNOWLEDGE_BASE_REQUIRED_OPERATIONS] },
      mode: 'basic',
      condition: { field: 'operation', value: [...KNOWLEDGE_BASE_OPERATIONS] },
    },
    // Knowledge base ID - advanced mode
    {
      id: 'manualKnowledgeBaseId',
      title: 'Knowledge Base ID',
      type: 'short-input',
      canonicalParamId: 'knowledgeBaseId',
      mode: 'advanced',
      placeholder: 'Enter knowledge base ID',
      required: { field: 'operation', value: [...KNOWLEDGE_BASE_REQUIRED_OPERATIONS] },
      condition: { field: 'operation', value: [...KNOWLEDGE_BASE_OPERATIONS] },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter your search query (optional when using tag filters)',
      required: false,
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'topK',
      title: 'Number of Results',
      type: 'short-input',
      placeholder: 'Enter number of results (default: 10)',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'tagFilters',
      title: 'Tag Filters',
      type: 'knowledge-tag-filters',
      placeholder: 'Add tag filters',
      dependsOn: ['knowledgeBaseSelector'],
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'searchMode',
      title: 'Retrieval Mode',
      type: 'dropdown',
      options: [
        { label: 'Vector only', id: 'vector' },
        { label: 'Hybrid (full-text + vector)', id: 'hybrid' },
      ],
      value: () => 'vector',
      mode: 'advanced',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'rerankerEnabled',
      title: 'Rerank Results',
      type: 'switch',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'rerankerModel',
      title: 'Rerank Model',
      type: 'dropdown',
      options: SUPPORTED_RERANKER_MODELS.map((id) => ({ label: id, id })),
      value: () => DEFAULT_RERANKER_MODEL,
      condition: {
        field: 'operation',
        value: 'search',
        and: { field: 'rerankerEnabled', value: true },
      },
    },
    {
      id: 'rerankerInputCount',
      title: 'Documents Sent to Reranker',
      type: 'short-input',
      placeholder: 'Auto (4× results, capped at 100)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'search',
        and: { field: 'rerankerEnabled', value: true },
      },
    },
    {
      id: 'apiKey',
      title: 'Cohere API Key',
      type: 'short-input',
      placeholder: 'Enter your Cohere API key',
      password: true,
      connectionDroppable: false,
      required: true,
      condition: getCohereRerankerApiKeyCondition(),
    },

    // --- List Documents ---
    {
      id: 'search',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Filter documents by filename',
      condition: { field: 'operation', value: 'list_documents' },
    },
    {
      id: 'enabledFilter',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Enabled', id: 'enabled' },
        { label: 'Disabled', id: 'disabled' },
      ],
      condition: { field: 'operation', value: 'list_documents' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max items to return (default: 50)',
      condition: { field: 'operation', value: ['list_documents', 'list_chunks'] },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: 'Number of items to skip (default: 0)',
      condition: { field: 'operation', value: ['list_documents', 'list_chunks'] },
    },

    // Document selector — basic mode (visual selector)
    {
      id: 'documentSelector',
      title: 'Document',
      type: 'document-selector',
      canonicalParamId: 'documentId',
      serviceId: 'knowledge',
      selectorKey: 'knowledge.documents',
      placeholder: 'Select document',
      dependsOn: ['knowledgeBaseSelector'],
      required: true,
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'get_document',
          'upload_chunk',
          'delete_document',
          'list_chunks',
          'update_chunk',
          'delete_chunk',
        ],
      },
    },
    // Document selector — advanced mode (manual ID input)
    {
      id: 'documentId',
      title: 'Document ID',
      type: 'short-input',
      canonicalParamId: 'documentId',
      placeholder: 'Enter document ID',
      dependsOn: ['knowledgeBaseId'],
      required: true,
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'get_document',
          'upload_chunk',
          'delete_document',
          'list_chunks',
          'update_chunk',
          'delete_chunk',
        ],
      },
    },

    // --- Upload Chunk ---
    {
      id: 'content',
      title: 'Chunk Content',
      type: 'long-input',
      placeholder: 'Enter the chunk content to upload',
      rows: 6,
      required: true,
      condition: { field: 'operation', value: 'upload_chunk' },
    },

    // --- Create Document / Upsert Document ---
    {
      id: 'name',
      title: 'Document Name',
      type: 'short-input',
      placeholder: 'Enter document name',
      required: true,
      condition: { field: 'operation', value: ['create_document', 'upsert_document'] },
    },
    {
      id: 'content',
      title: 'Document Content',
      type: 'long-input',
      placeholder: 'Enter the document content',
      rows: 6,
      required: true,
      condition: { field: 'operation', value: ['create_document', 'upsert_document'] },
    },
    {
      id: 'upsertDocumentId',
      title: 'Document ID (Optional)',
      type: 'short-input',
      placeholder: 'Enter existing document ID to update (or leave empty to match by name)',
      condition: { field: 'operation', value: 'upsert_document' },
    },
    {
      id: 'documentTags',
      title: 'Document Tags',
      type: 'document-tag-entry',
      dependsOn: ['knowledgeBaseSelector'],
      condition: { field: 'operation', value: ['create_document', 'upsert_document'] },
    },

    // --- Update Chunk / Delete Chunk ---
    {
      id: 'chunkId',
      title: 'Chunk ID',
      type: 'short-input',
      placeholder: 'Enter chunk ID',
      required: true,
      condition: { field: 'operation', value: ['update_chunk', 'delete_chunk'] },
    },
    {
      id: 'content',
      title: 'New Content',
      type: 'long-input',
      placeholder: 'Enter updated chunk content',
      rows: 6,
      condition: { field: 'operation', value: 'update_chunk' },
    },
    {
      id: 'enabled',
      title: 'Enabled',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      condition: { field: 'operation', value: 'update_chunk' },
    },

    // --- Connector operations ---
    {
      id: 'connectorId',
      title: 'Connector ID',
      type: 'short-input',
      placeholder: 'Enter connector ID',
      required: true,
      condition: { field: 'operation', value: ['get_connector', 'trigger_sync'] },
    },

    // --- List Chunks ---
    {
      id: 'chunkSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Filter chunks by content',
      condition: { field: 'operation', value: 'list_chunks' },
    },
    {
      id: 'chunkEnabledFilter',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Enabled', id: 'true' },
        { label: 'Disabled', id: 'false' },
      ],
      condition: { field: 'operation', value: 'list_chunks' },
    },

    // --- Folder operations ---
    {
      id: 'folderPath',
      title: 'Folder',
      type: 'sim-folder-tree-selector',
      resourceType: 'knowledge_base',
      placeholder: 'Select a folder',
      canonicalParamId: 'folderRef',
      mode: 'basic',
      condition: { field: 'operation', value: ['list_folders', 'update_folder', 'delete_folder'] },
      required: { field: 'operation', value: ['update_folder', 'delete_folder'] },
    },
    {
      id: 'manualFolderPath',
      title: 'Folder Path',
      type: 'short-input',
      canonicalParamId: 'folderRef',
      mode: 'advanced',
      placeholder: '/Support/Tier1',
      condition: { field: 'operation', value: ['list_folders', 'update_folder', 'delete_folder'] },
      required: { field: 'operation', value: ['update_folder', 'delete_folder'] },
    },
    {
      id: 'createParentPath',
      title: 'Parent Folder',
      type: 'sim-folder-tree-selector',
      resourceType: 'knowledge_base',
      placeholder: 'Workspace root',
      canonicalParamId: 'createParentRef',
      mode: 'basic',
      condition: { field: 'operation', value: 'create_folder' },
    },
    {
      id: 'manualCreateParentPath',
      title: 'Parent Folder Path',
      type: 'short-input',
      canonicalParamId: 'createParentRef',
      mode: 'advanced',
      placeholder: '/Support',
      condition: { field: 'operation', value: 'create_folder' },
    },
    {
      id: 'folderName',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Tier1',
      condition: { field: 'operation', value: 'create_folder' },
      required: { field: 'operation', value: 'create_folder' },
    },
    {
      id: 'destinationParentPath',
      title: 'Move Into',
      type: 'sim-folder-tree-selector',
      resourceType: 'knowledge_base',
      placeholder: 'Workspace root',
      canonicalParamId: 'destinationParentRef',
      mode: 'basic',
      condition: { field: 'operation', value: 'update_folder' },
    },
    {
      id: 'manualDestinationParentPath',
      title: 'Move Into Path',
      type: 'short-input',
      canonicalParamId: 'destinationParentRef',
      mode: 'advanced',
      placeholder: '/Archive',
      condition: { field: 'operation', value: 'update_folder' },
    },
    {
      id: 'folderRecursive',
      title: 'Include Subfolders',
      type: 'switch',
      condition: { field: 'operation', value: 'list_folders' },
    },
    {
      id: 'folderDepth',
      title: 'Max Depth',
      type: 'short-input',
      placeholder: 'Unlimited',
      mode: 'advanced',
      /*
       * A listing that does not descend is exactly its direct children, so a
       * depth beside it means nothing. The contract rejects the pair; gating the
       * field here is what stops a human building the combination it rejects.
       */
      condition: {
        field: 'operation',
        value: 'list_folders',
        and: { field: 'folderRecursive', value: true },
      },
    },
    {
      id: 'folderSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'tier1',
      description: 'Matches folder and knowledge base names.',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_folders' },
    },
    {
      id: 'folderLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '200',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_folders' },
    },
    {
      id: 'deleteFolderRecursive',
      title: 'Delete Contents',
      type: 'switch',
      condition: { field: 'operation', value: 'delete_folder' },
    },
  ],
  tools: {
    access: [
      'knowledge_search',
      'knowledge_upload_chunk',
      'knowledge_create_document',
      'knowledge_upsert_document',
      'knowledge_list_tags',
      'knowledge_list_documents',
      'knowledge_get_document',
      'knowledge_delete_document',
      'knowledge_list_chunks',
      'knowledge_update_chunk',
      'knowledge_delete_chunk',
      'knowledge_list_connectors',
      'knowledge_get_connector',
      'knowledge_trigger_sync',
      'knowledge_list_folders',
      'knowledge_create_folder',
      'knowledge_update_folder',
      'knowledge_delete_folder',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'search':
            return 'knowledge_search'
          case 'upload_chunk':
            return 'knowledge_upload_chunk'
          case 'create_document':
            return 'knowledge_create_document'
          case 'upsert_document':
            return 'knowledge_upsert_document'
          case 'list_tags':
            return 'knowledge_list_tags'
          case 'list_documents':
            return 'knowledge_list_documents'
          case 'get_document':
            return 'knowledge_get_document'
          case 'delete_document':
            return 'knowledge_delete_document'
          case 'list_chunks':
            return 'knowledge_list_chunks'
          case 'update_chunk':
            return 'knowledge_update_chunk'
          case 'delete_chunk':
            return 'knowledge_delete_chunk'
          case 'list_connectors':
            return 'knowledge_list_connectors'
          case 'get_connector':
            return 'knowledge_get_connector'
          case 'trigger_sync':
            return 'knowledge_trigger_sync'
          case 'list_folders':
            return 'knowledge_list_folders'
          case 'create_folder':
            return 'knowledge_create_folder'
          case 'update_folder':
            return 'knowledge_update_folder'
          case 'delete_folder':
            return 'knowledge_delete_folder'
          default:
            return 'knowledge_search'
        }
      },
      params: (params) => {
        params = { ...params }

        if (params.operation === 'list_folders') {
          return {
            path: optionalText(params.folderRef),
            recursive: switchValue(params.folderRecursive),
            depth: parseOptionalNumberInput(params.folderDepth, 'Max Depth', {
              integer: true,
              min: 1,
              max: MAX_FOLDER_PATH_SEGMENTS,
            }),
            search: optionalText(params.folderSearch),
            limit: parseOptionalNumberInput(params.folderLimit, 'Limit', {
              integer: true,
              min: 1,
              max: MAX_KNOWLEDGE_LIST_LIMIT,
            }),
          }
        }

        if (params.operation === 'create_folder') {
          /*
           * A folder is created by naming it inside a parent, not by spelling
           * its whole path. The parent is pickable and the name is not, so the
           * path is composed here — percent-encoding the typed name, because the
           * tool takes a canonical path.
           */
          const name = optionalText(params.folderName)
          const parentPrefix = folderPathPrefix(optionalText(params.createParentRef))
          return {
            path: name ? `${parentPrefix}/${encodeFolderPathSegment(name)}` : undefined,
          }
        }

        if (params.operation === 'update_folder') {
          /*
           * The tool takes the full path the folder will HAVE, which by
           * definition does not exist yet and so cannot be picked. It is
           * composed from a destination parent plus the folder's own name,
           * carried from the source path's last segment. An unset parent means
           * the workspace root.
           */
          const sourcePath = optionalText(params.folderRef)
          const segment = sourcePath?.split('/').pop()
          const parentPrefix = folderPathPrefix(optionalText(params.destinationParentRef))
          return {
            path: sourcePath,
            destinationPath: segment ? `${parentPrefix}/${segment}` : undefined,
          }
        }

        if (params.operation === 'delete_folder') {
          return {
            path: optionalText(params.folderRef),
            recursive: switchValue(params.deleteFolderRecursive),
          }
        }

        const knowledgeBaseId = params.knowledgeBaseId ? String(params.knowledgeBaseId).trim() : ''
        /*
         * Search accepts a folder instead: it stands for the knowledge bases
         * inside it, resolved when the workflow runs. Every other operation
         * addresses one knowledge base and still requires it.
         */
        const searchFolderRef =
          params.operation === 'search' ? readFolderPath(params.searchFolderRef) : ''
        const searchFolderPath =
          params.operation === 'search' ? folderScopePath(params.searchFolderRef) : undefined
        if (!knowledgeBaseId && !searchFolderPath) {
          throw new Error(
            params.operation === 'search'
              ? searchFolderRef === ROOT_FOLDER_PATH
                ? 'The workspace root is not a folder scope. Pick a knowledge base, or a folder inside the workspace.'
                : 'A knowledge base or a folder is required for search'
              : 'Knowledge base ID is required'
          )
        }
        params.knowledgeBaseId = knowledgeBaseId || undefined
        /*
         * The folder travels only when no knowledge base is picked. The picker
         * offers just that folder's knowledge bases, so a picked one is always
         * the narrower answer — sending both would search the whole folder
         * *and* the pick, which is the opposite of what the field says it does.
         *
         * Assembled rather than assigned onto `params`, because the wire field
         * shares a name with the folder-operation subblock and reading
         * `params.folderPath` would pick up a value the serializer has already
         * deleted. Absent subfolders already means "this folder only", so only
         * the on case travels.
         */
        const searchFolderFields =
          searchFolderPath && !knowledgeBaseId
            ? {
                folderPath: searchFolderPath,
                ...(switchValue(params.searchFolderIncludeSubfolders)
                  ? { folderIncludeSubfolders: true }
                  : {}),
              }
            : {}

        const docOps = [
          'get_document',
          'upload_chunk',
          'delete_document',
          'list_chunks',
          'update_chunk',
          'delete_chunk',
        ]
        if (docOps.includes(params.operation)) {
          const documentId = params.documentId ? String(params.documentId).trim() : ''
          if (!documentId) {
            throw new Error(`Document ID is required for ${params.operation} operation`)
          }
          params.documentId = documentId
        }

        const chunkOps = ['update_chunk', 'delete_chunk']
        if (chunkOps.includes(params.operation)) {
          const chunkId = params.chunkId ? String(params.chunkId).trim() : ''
          if (!chunkId) {
            throw new Error(`Chunk ID is required for ${params.operation} operation`)
          }
          params.chunkId = chunkId
        }

        const connectorOps = ['get_connector', 'trigger_sync']
        if (connectorOps.includes(params.operation)) {
          const connectorId = params.connectorId ? String(params.connectorId).trim() : ''
          if (!connectorId) {
            throw new Error(`Connector ID is required for ${params.operation} operation`)
          }
          params.connectorId = connectorId
        }

        // Map list_chunks sub-block fields to tool params
        if (params.operation === 'list_chunks') {
          if (params.chunkSearch) params.search = params.chunkSearch
          if (params.chunkEnabledFilter) params.enabled = params.chunkEnabledFilter
        }

        // Map upsert sub-block field to tool param
        if (params.operation === 'upsert_document' && params.upsertDocumentId) {
          params.documentId = String(params.upsertDocumentId).trim()
        }

        if (
          (params.operation === 'create_document' || params.operation === 'upsert_document') &&
          typeof params.documentTags === 'string' &&
          params.documentTags.trim().length > 0
        ) {
          try {
            const documentTags: unknown = JSON.parse(params.documentTags)
            if (Array.isArray(documentTags) || isPlainRecord(documentTags)) {
              params.documentTags = documentTags
            }
          } catch {}
        }

        // Convert enabled dropdown string to boolean for update_chunk
        if (params.operation === 'update_chunk' && typeof params.enabled === 'string') {
          params.enabled = params.enabled === 'true'
        }

        return { ...params, ...searchFolderFields }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    knowledgeBaseId: { type: 'string', description: 'Knowledge base identifier' },
    query: { type: 'string', description: 'Search query terms' },
    topK: { type: 'number', description: 'Number of results' },
    documentId: { type: 'string', description: 'Document identifier' },
    chunkId: { type: 'string', description: 'Chunk identifier' },
    content: { type: 'string', description: 'Content data' },
    name: { type: 'string', description: 'Document name' },
    search: { type: 'string', description: 'Search filter for documents' },
    enabledFilter: { type: 'string', description: 'Filter by enabled status' },
    enabled: { type: 'string', description: 'Enable or disable a chunk' },
    limit: { type: 'number', description: 'Max items to return' },
    offset: { type: 'number', description: 'Pagination offset' },
    tagFilters: { type: 'string', description: 'Tag filter criteria' },
    searchMode: {
      type: 'string',
      description: 'Retrieval mode: vector only (default) or hybrid (full-text + vector)',
    },
    rerankerEnabled: { type: 'boolean', description: 'Apply Cohere reranking to search results' },
    rerankerModel: { type: 'string', description: 'Cohere rerank model identifier' },
    rerankerInputCount: {
      type: 'number',
      description: 'Number of vector results sent to the Cohere reranker (1–100)',
    },
    apiKey: { type: 'string', description: 'Cohere API key (self-hosted only)' },
    documentTags: { type: 'string', description: 'Document tags' },
    chunkSearch: { type: 'string', description: 'Search filter for chunks' },
    chunkEnabledFilter: { type: 'string', description: 'Filter chunks by enabled status' },
    upsertDocumentId: { type: 'string', description: 'Document ID for upsert operation' },
    connectorId: { type: 'string', description: 'Connector identifier' },
    searchFolderRef: {
      type: 'string',
      description: 'Folder whose knowledge bases a search covers',
    },
    searchFolderIncludeSubfolders: {
      type: 'boolean',
      description: 'Extend the search folder scope to its subfolders',
    },
    folderRef: { type: 'string', description: 'Knowledge folder to list, move, or delete' },
    createParentRef: { type: 'string', description: 'Parent folder a new folder is created in' },
    destinationParentRef: { type: 'string', description: 'Folder a move places the folder into' },
    folderName: { type: 'string', description: 'Name of the folder to create' },
    folderRecursive: { type: 'boolean', description: 'List the whole subtree' },
    folderDepth: { type: 'number', description: 'Deepest level to include when listing' },
    folderSearch: { type: 'string', description: 'Match folder and knowledge base names' },
    folderLimit: { type: 'number', description: 'Max entries a listing returns' },
    deleteFolderRecursive: {
      type: 'boolean',
      description: 'Also delete the folder’s contents',
    },
  },
  outputs: {
    results: { type: 'json', description: 'Search results' },
    query: { type: 'string', description: 'Query used' },
    totalResults: { type: 'number', description: 'Total results count' },
  },
}
