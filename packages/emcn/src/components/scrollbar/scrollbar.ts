/**
 * Canonical chrome for visible EMCN scrollbars.
 *
 * The 4px WebKit geometry keeps the thumb close to the surface edge without
 * covering dense menu or panel content. Firefox exposes only its native
 * `thin` width, so it receives the matching token-based color treatment.
 */
export const thinScrollbarClass =
  '[scrollbar-color:var(--scrollbar-thumb-color)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:size-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--scrollbar-thumb-color)] [&::-webkit-scrollbar-thumb:hover]:bg-[var(--scrollbar-thumb-hover-color)]'
