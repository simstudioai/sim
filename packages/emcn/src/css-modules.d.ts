/**
 * Ambient declaration for CSS Modules so the package type-checks standalone.
 * Consuming apps (Next.js) provide their own equivalent at build time.
 */
declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}
