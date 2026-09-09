# Comparison table: known Chrome pinch-scroll behavior

On 2026-09-08, after reproducing transient header/category jitter during actual
trackpad scrolling at 3× pinch zoom in Chrome, the user accepted this symptom as
browser rendering behavior and explicitly stopped further fix attempts. Do not
reopen that same investigation without materially new evidence of an application
regression. This decision concerns the transient pinch-scroll symptom, not every
possible sticky-header or border defect.

- Native CSS `position: sticky` owns header and category movement. Category rails
  overlap the next category by one header height so incoming labels cover outgoing
  labels in DOM order, with every rail bounded by the table bottom. The navigation
  hook measures layout on resize; its scroll handler only tracks the active TOC
  section. Keep positioning writes out of the scroll handler.
- Preserve native `border-t` pseudo-elements on the header and category labels.
  Replacing them with background rectangles previously caused mismatched border
  rounding at browser zoom levels.
- Removing header `will-change: transform` did not fix the reported symptom.
  A temporary 93px inset experiment was restored to the measured 93.1953125px;
  rounding the inset was never established as a fix.
- Trackpad pinch and CMD+/CMD- browser zoom are different reproductions. Settled
  before/after geometry and passing unit tests do not verify transient motion.
  The user-performed capture had 238 scroll updates, 258 filmstrip frames, and no
  Layout or Paint events. Absence of those events alone does not prove stability.
- If investigating a new regression, capture the failing motion first. Ensure
  the page is in front of undocked DevTools and that its internal landing-shell
  scroll container actually moves; automated wheel calls can miss that target.

No application positioning change resulted from this investigation.
