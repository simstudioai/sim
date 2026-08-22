/**
 * The Yjs `XmlFragment` name TipTap's Collaboration extension binds to (its default `field`). The
 * client configures `Collaboration.configure({ document })` with no explicit `field`, so it uses
 * TipTap's default, `'default'`. Server-side conversion, seeding, and persistence MUST target the same
 * fragment or the client would sync an empty document — so this is the single canonical source consumed
 * by both bundles (it has no imports, making it safe from client and server alike).
 */
export const COLLAB_DOC_FIELD = 'default'
