/** Ambient types for `disposable-email-domains` — ships JSON arrays with no bundled types. */
declare module 'disposable-email-domains' {
  const domains: string[]
  export default domains
}

declare module 'disposable-email-domains/wildcard.json' {
  const baseDomains: string[]
  export default baseDomains
}
