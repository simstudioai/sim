import styles from '@/platform/app/(shell)/search/_components/search-surface/search-surface.module.css'

/** Search's frame while the route reads its gate. The organization's name arrives with the page. */
export function SearchSurfaceSkeleton() {
  return (
    <div className={styles.surface}>
      <div className={styles.search} role='status' aria-label='Loading Search' aria-busy='true'>
        <header className={styles.header} data-desktop-drag=''>
          <h1 data-type='T039'>Search</h1>
        </header>
        <div className={styles.column}>
          <div className={styles.fieldPlaceholder} />
        </div>
      </div>
    </div>
  )
}
