import { EmbeddingsIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
export const VoyageAIBlock: BlockConfig = {
  type: 'voyageai',
  name: 'Voyage AI',
  description: 'Contextualized embeddings and reranking',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Embed documents with Voyage AI contextualized models, so each chunk vector reflects the whole document around it, and rerank texts against a query with Voyage AI rerankers.',
  docsLink: 'https://docs.sim.ai/integrations/voyageai',
  category: 'tools',
  integrationType: IntegrationType.AI,
  bgColor: '#7B4DFF',
  icon: EmbeddingsIcon,
  canvasPresentation: {
    defaultTitle: 'Voyage AI',
    sentences: {
      byOperation: {
        voyageai_contextualized_embeddings: [
          { text: 'Embed', field: 'input', core: true },
          { text: 'with', field: 'model' },
        ],
        voyageai_rerank: [
          { text: 'Rerank', field: 'documents', core: true },
          { text: 'for', field: 'query' },
          { text: ', top', field: 'topK' },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Contextualized Embeddings', id: 'voyageai_contextualized_embeddings' },
        { label: 'Rerank', id: 'voyageai_rerank' },
      ],
      value: () => 'voyageai_contextualized_embeddings',
    },
    {
      id: 'input',
      title: 'Texts',
      type: 'code',
      language: 'json',
      required: true,
      placeholder: '["Full text of the first document", "Full text of the second document"]',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of strings: the full text of each document to embed, or one search query per entry. Return ONLY the JSON array.',
        generationType: 'json-array',
      },
      condition: { field: 'operation', value: 'voyageai_contextualized_embeddings' },
    },
    {
      id: 'model',
      title: 'Model',
      type: 'combobox',
      options: [
        { label: 'voyage-context-4', id: 'voyage-context-4' },
        { label: 'voyage-context-3', id: 'voyage-context-3' },
      ],
      placeholder: 'Select a model',
      emptyIsValid: true,
      required: true,
      condition: { field: 'operation', value: 'voyageai_contextualized_embeddings' },
    },
    {
      id: 'inputType',
      title: 'Input Type',
      type: 'dropdown',
      options: [
        { label: 'Document', id: 'document' },
        { label: 'Query', id: 'query' },
      ],
      value: () => 'document',
      condition: { field: 'operation', value: 'voyageai_contextualized_embeddings' },
    },
    {
      id: 'dimensions',
      title: 'Dimensions',
      type: 'dropdown',
      options: [
        { label: '2048', id: '2048' },
        { label: '1024 (default)', id: '1024' },
        { label: '512', id: '512' },
        { label: '256', id: '256' },
      ],
      value: () => '1024',
      mode: 'advanced',
      condition: { field: 'operation', value: 'voyageai_contextualized_embeddings' },
    },
    {
      id: 'query',
      title: 'Query',
      type: 'long-input',
      required: true,
      placeholder: 'Enter the query to rank against',
      condition: { field: 'operation', value: 'voyageai_rerank' },
    },
    {
      id: 'documents',
      title: 'Documents',
      type: 'code',
      language: 'json',
      required: true,
      placeholder: '["First text", "Second text"]',
      wandConfig: {
        enabled: true,
        prompt: 'Generate a JSON array of text strings to rank. Return ONLY the JSON array.',
        generationType: 'json-array',
      },
      condition: { field: 'operation', value: 'voyageai_rerank' },
    },
    {
      id: 'rerankModel',
      title: 'Model',
      type: 'combobox',
      options: [
        { label: 'rerank-3', id: 'rerank-3' },
        { label: 'rerank-3-lite', id: 'rerank-3-lite' },
        { label: 'rerank-2.5', id: 'rerank-2.5' },
        { label: 'rerank-2.5-lite', id: 'rerank-2.5-lite' },
      ],
      placeholder: 'Select a model',
      emptyIsValid: true,
      required: true,
      condition: { field: 'operation', value: 'voyageai_rerank' },
    },
    {
      id: 'topK',
      title: 'Top K',
      type: 'short-input',
      placeholder: 'Defaults to all documents',
      mode: 'advanced',
      condition: { field: 'operation', value: 'voyageai_rerank' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Voyage AI API key',
      password: true,
      hideWhenHosted: true,
    },
  ],
  tools: {
    access: ['voyageai_contextualized_embeddings', 'voyageai_rerank'],
    config: {
      tool: (params) => params.operation || 'voyageai_contextualized_embeddings',
      /**
       * Rerank and embeddings use separate model dropdowns so each lists only
       * its own models; this hands the rerank choice to the tool's `model` param.
       */
      params: (params) =>
        params.operation === 'voyageai_rerank' ? { model: params.rerankModel } : {},
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Voyage AI API key' },
    input: {
      type: 'json',
      description: 'Full text of each document to embed (document) or each search query (query)',
    },
    model: { type: 'string', description: 'Contextualized embedding model' },
    inputType: { type: 'string', description: 'Document or query' },
    dimensions: { type: 'number', description: 'Output vector dimensions' },
    query: { type: 'string', description: 'Query to rank documents against' },
    documents: { type: 'json', description: 'Texts to rank' },
    rerankModel: { type: 'string', description: 'Reranker model' },
    topK: { type: 'number', description: 'Number of top documents to return' },
  },
  outputs: {
    embeddings: {
      type: 'json',
      description: 'Embedding vectors grouped by document, one per chunk',
    },
    chunks: {
      type: 'json',
      description: 'Text of each chunk, grouped like the vectors (documents only)',
    },
    dimensions: { type: 'number', description: 'Dimensionality of each vector' },
    results: {
      type: 'json',
      description: 'Documents ranked by relevance with index, relevanceScore and document',
    },
    model: { type: 'string', description: 'Model used' },
    totalTokens: { type: 'number', description: 'Tokens billed for the request' },
  },
}

export const VoyageAIBlockMeta = {
  tags: ['llm', 'vector-search'],
  url: 'https://www.voyageai.com',
  templates: [
    {
      icon: EmbeddingsIcon,
      title: 'Contextual document indexer',
      prompt:
        'Build a workflow that reads each new document from a files folder, embeds it with Voyage AI contextualized embeddings so each chunk keeps its document context, and upserts the chunk vectors and text into Pinecone.',
      modules: ['files', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['automation', 'vector-search'],
      alsoIntegrations: ['pinecone'],
    },
    {
      icon: EmbeddingsIcon,
      title: 'Search result reranker',
      prompt:
        'Create a workflow that runs a Pinecone query for a user question, reranks the top 50 matches with Voyage AI, and passes only the best five to an agent that answers with citations.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['automation', 'vector-search'],
      alsoIntegrations: ['pinecone'],
    },
    {
      icon: EmbeddingsIcon,
      title: 'Support answer retriever',
      prompt:
        'Build a workflow that takes an incoming support question, searches the help-center knowledge base, reranks the candidate articles with Voyage AI, and drafts a reply from the top result.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation'],
    },
    {
      icon: EmbeddingsIcon,
      title: 'Contract clause finder',
      prompt:
        'Create a workflow that embeds each contract with Voyage AI contextualized embeddings, stores the chunk vectors and chunk text in a table, and finds the clauses closest to a legal question.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'vector-search'],
    },
    {
      icon: EmbeddingsIcon,
      title: 'Candidate shortlist ranker',
      prompt:
        'Build a workflow that takes a job description and a table of candidate summaries, reranks the summaries against the description with Voyage AI, and writes the top ten to a shortlist table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'automation'],
    },
    {
      icon: EmbeddingsIcon,
      title: 'Research paper retriever',
      prompt:
        'Create a workflow that embeds papers with Voyage AI contextualized embeddings, then answers research questions by retrieving and reranking the most relevant chunks.',
      modules: ['files', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['analysis', 'vector-search'],
    },
    {
      icon: EmbeddingsIcon,
      title: 'Meeting notes relevance filter',
      prompt:
        'Build a workflow that takes a topic, reranks recent meeting notes against it with Voyage AI, and posts the three most relevant notes to Slack.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'research'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'rerank-search-results',
      description: 'Reorder retrieved texts by relevance to a query so the best ones come first.',
      content:
        '# Rerank Search Results\n\nImprove retrieval quality by reranking candidates against the query.\n\n## Steps\n1. Take the user query and the candidate texts from a vector search or keyword search.\n2. Run the Rerank operation with the query and the candidates as a JSON array of strings. Set Top K to the number of results you need.\n3. Use the returned index to map each ranked entry back to its source record.\n\n## Output\nReturn the top results in relevance order with their relevance scores and source identifiers.',
    },
    {
      name: 'embed-documents-with-context',
      description: 'Embed whole documents so each chunk vector carries its document context.',
      content:
        '# Embed Documents With Context\n\nCreate chunk vectors that stay aware of the document they belong to.\n\n## Steps\n1. Take the full text of each document. Do not split it: Voyage cuts the chunks itself.\n2. Run Contextualized Embeddings with the texts as a JSON array of strings and Input Type set to Document.\n3. Pair each returned vector with its chunk text from the chunks output and with the document identifier.\n\n## Output\nReturn the vectors and chunk texts grouped by document, the model, the dimensions, and the tokens billed.',
    },
    {
      name: 'embed-search-queries',
      description:
        'Embed search queries with the same contextualized model used to index documents.',
      content:
        '# Embed Search Queries\n\nCreate query vectors that match a contextualized document index.\n\n## Steps\n1. Take the user query as a JSON array with one string, for example [\"how do I reset my password\"].\n2. Run Contextualized Embeddings with Input Type set to Query and the same model and dimensions the documents were indexed with.\n3. Use the returned vector to search the vector store.\n\n## Output\nReturn the query vector, the model, and the dimensions. Vectors from different models or dimensions are not comparable.',
    },
  ],
} as const satisfies BlockMeta
