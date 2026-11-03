/**
 * The INTERNAL content type stamped onto a page file's record when the write
 * path detects page source. The file stays `.html` to the user (serving and
 * downloads emit text/html); the record type is how surfaces know the file's
 * nature before any content loads — force the rendered view, hide the code
 * toggle, expect source.
 *
 * Kept free of the page compiler so client surfaces that only need to recognize a page
 * do not load the compiler's parsers.
 */
export const SIM_PAGE_CONTENT_TYPE = 'text/x-sim-page'
