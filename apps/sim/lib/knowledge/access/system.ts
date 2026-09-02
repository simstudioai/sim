declare const systemAccessScopeBrand: unique symbol

/**
 * The one exemption from access filtering: a background job acting on rows it
 * owns (document processing, connector sync). It is a branded type so it cannot
 * be assembled from a literal, and this module is its only source, so every
 * caller is one grep away. Never construct it on a request path.
 */
export interface SystemAccessScope {
  readonly kind: 'system'
  readonly [systemAccessScopeBrand]: true
}

export const SYSTEM_ACCESS_SCOPE: SystemAccessScope = Object.freeze({
  kind: 'system',
}) as SystemAccessScope
