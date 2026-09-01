export const MAX_WORKSPACE_FILE_BULK_REQUEST_IDS = 1_000
export const MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS = 5_000

/**
 * Ceiling on the number of files one zip download may contain.
 *
 * Lives here rather than beside the download use case so the v2 contract can
 * refuse an over-large selection at the request boundary, instead of letting it
 * validate, resolve, and only then fail — and so the two ceilings cannot drift.
 */
export const MAX_ZIP_DOWNLOAD_FILES = 100
