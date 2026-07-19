/**
 * Social-share composer URLs — one source for the X / LinkedIn share endpoints so
 * the marketing `ShareButton` and the public-resource `ShareLinkButton` cannot
 * drift on the URL format.
 */

/** X (Twitter) tweet-intent composer, pre-filled with post text (any link inline in the text). */
export function buildXShareUrl(text: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`
}

/** LinkedIn share dialog for a URL — shows the page's preview card, with no custom text. */
export function buildLinkedInShareUrl(url: string): string {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`
}

/**
 * LinkedIn feed composer, pre-filled with post text — this DRAFTS the post (any
 * link inline in the text). LinkedIn's `share-offsite` endpoint cannot pre-fill
 * text (it opens an empty share modal), so drafted posts use the feed composer.
 */
export function buildLinkedInPostUrl(text: string): string {
  return `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`
}
