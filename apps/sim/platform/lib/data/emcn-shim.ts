/**
 * Stands in for `@sim/emcn` in this app's bundle, so existing query hooks keep their `toast` calls
 * while no legacy UI can enter the Platform. Anything else a hook starts to import from that package
 * fails the build. Next's webpack config in `platform/next.config.ts` holds the alias.
 */
export { toast } from '@/platform/lib/data/toast'
