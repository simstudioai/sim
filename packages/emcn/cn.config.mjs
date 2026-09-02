/**
 * Class-group extension for the `cn` merger, compiled to lookup tables by
 * `bun --filter @sim/emcn cn:build` and consumed by `src/lib/cn.ts`.
 *
 * The `font-size` group teaches the merger that Sim's own type scale keys are
 * font sizes, not colours — without it `text-small` and `text-sm` do not
 * conflict, so a component that sets one while a consumer passes the other
 * emits both and CSS source order decides the winner instead of the caller.
 */
export default {
  extend: {
    classGroups: {
      'font-size': [{ text: ['micro', 'caption', 'small', 'md'] }],
    },
  },
}
