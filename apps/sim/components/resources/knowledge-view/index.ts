/**
 * The knowledge base resource view. Consumers mount {@link KnowledgeView}
 * against a source, grants and a host; it owns the whole surface — the document
 * list, the header chrome, and every mutation a member may perform on a base.
 *
 * Three children are exported alongside it, all for the same reason: the
 * knowledge list page and the document detail route render the same tag editor
 * and the same selection bar against the same data, and forking either would be
 * exactly the drift this unit exists to prevent.
 */

export { ActionBar } from './components/action-bar'
export { BaseTagsModal } from './components/base-tags-modal'
export type { KnowledgeDocumentList, KnowledgeEnabledFilter } from './components/document-list'
export { DocumentTagsModal } from './components/document-tags-modal'
export { SearchHighlight } from './components/search-highlight'
export type { TagFilterEntry } from './components/tag-filter-panel'
export type { KnowledgeViewProps } from './knowledge-view'
export { KnowledgeView } from './knowledge-view'
