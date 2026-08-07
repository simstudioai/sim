/**
 * The knowledge base resource view. Consumers mount {@link KnowledgeView}
 * against a source, grants, and a host, and supply the document list state they
 * own; everything else here is what a surface needs to describe a knowledge
 * base document without opening it.
 */
export { SearchHighlight } from './components/search-highlight'
export type { TagFilterEntry } from './components/tag-filter-panel'
export type {
  KnowledgeDocumentList,
  KnowledgeEnabledFilter,
  KnowledgeViewInteraction,
  KnowledgeViewProps,
} from './knowledge-view'
export { KnowledgeView } from './knowledge-view'
