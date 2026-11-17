/**
 * Workspace files need no declaration: every file under `files/` is one workspace file, at the
 * folder path and name it has there (`files/reports/q1.pdf` is `q1.pdf` in the `reports`
 * folder), synced by content hash. Each apply that changes a file's bytes records a new version
 * of it, so an earlier one can be restored in the Files tab. Files over 10 MB, or whose name no
 * directory can hold (a reserved character, or a path that differs only in letter case from
 * another file or folder), are left out of a get (listed in `.sim/skipped.json`) and never written
 * by an apply; a file the directory no longer holds is deleted only with `--allow-delete`.
 */
export {}
