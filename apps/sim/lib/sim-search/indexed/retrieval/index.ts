/**
 * Search-index-only retrieval strategies the shared retrieval layer
 * (`lib/knowledge/search/queries.ts`) runs while indexed organization search is on. Kept apart
 * from the use-case barrel because the use cases depend on that retrieval layer, which depends on
 * these.
 */
export {
  forgetProjectionFilled,
  isProjectionFilled,
} from '@/lib/sim-search/indexed/retrieval/projection-fill'
export { resolveTinKeywordQuery } from '@/lib/sim-search/indexed/retrieval/tin-keyword'
