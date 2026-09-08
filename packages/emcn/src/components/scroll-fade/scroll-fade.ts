import styles from './scroll-fade.module.css'

/** Which edges of a vertical scroll region currently hide content beyond them. */
export interface ScrollEdges {
  top: boolean
  bottom: boolean
}

/** Which edges of a horizontal scroll region currently hide content beyond them. */
export interface ScrollEdgesX {
  left: boolean
  right: boolean
}

/** Height of the fade band at an active edge, in pixels. */
export const SCROLL_FADE_BAND_PX = 12

/**
 * The canonical scroll-edge fade. Put this class on the scrolling element and
 * spread {@link scrollFadeAttributes} beside it; the region then fades over the
 * band at any edge that hides content, and stays fully opaque at every edge that
 * does not — so a list that fits, or sits at its top, is never fogged.
 *
 * The band is a fixed {@link SCROLL_FADE_BAND_PX}. A consumer whose top edge is
 * covered by a floating control sets `--scroll-fade-inset` to that control's
 * height (e.g. `[--scroll-fade-inset:3rem]`) so the band starts beneath it.
 *
 * @example
 * const edges = useScrollEdges(listRef)
 * <div ref={listRef} className={cn('overflow-y-auto', scrollFadeClass)} {...scrollFadeAttributes(edges)}>
 */
export const scrollFadeClass = styles.root

/**
 * The same fade for a region that scrolls sideways — a tab row or chip strip.
 * Pair it with `useScrollEdges(ref, { axis: 'x' })`.
 */
export const scrollFadeXClass = styles.rootX

type ScrollFadeAttributes = {
  'data-scroll-fade-top'?: true
  'data-scroll-fade-bottom'?: true
  'data-scroll-fade-left'?: true
  'data-scroll-fade-right'?: true
}

/** Data attributes that switch {@link scrollFadeClass} or {@link scrollFadeXClass}'s edges on. */
export function scrollFadeAttributes(edges: ScrollEdges | ScrollEdgesX): ScrollFadeAttributes {
  if ('left' in edges) {
    return {
      'data-scroll-fade-left': edges.left || undefined,
      'data-scroll-fade-right': edges.right || undefined,
    }
  }
  return {
    'data-scroll-fade-top': edges.top || undefined,
    'data-scroll-fade-bottom': edges.bottom || undefined,
  }
}
