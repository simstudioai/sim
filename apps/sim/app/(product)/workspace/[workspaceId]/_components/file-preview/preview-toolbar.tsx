import { Button, IconButton } from '@sim/emcn/button'
import styles from '@/app/(product)/workspace/[workspaceId]/_components/file-preview/preview-toolbar.module.css'

interface PreviewNavigation {
  current: number
  total: number
  /** What one step moves by, such as "page" or "slide". */
  label: string
  onPrevious: () => void
  onNext: () => void
}

interface PreviewZoom {
  label: string
  onZoomOut: () => void
  onZoomIn: () => void
  canZoomOut?: boolean
  canZoomIn?: boolean
  onReset?: () => void
}

interface PreviewToolbarProps {
  navigation?: PreviewNavigation
  zoom?: PreviewZoom
}

/** Page or slide steps at the start and zoom at the end, above a document preview. */
export function PreviewToolbar({ navigation, zoom }: PreviewToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.group}>
        {navigation && (
          <>
            <IconButton
              label={`Previous ${navigation.label}`}
              icon='I140'
              size='compact'
              disabled={navigation.current <= 1}
              onClick={navigation.onPrevious}
            />
            <span className={styles.count} data-type='T060'>
              {navigation.total > 0 ? `${navigation.current} / ${navigation.total}` : '0 / 0'}
            </span>
            <IconButton
              label={`Next ${navigation.label}`}
              icon='I032'
              size='compact'
              disabled={navigation.current >= navigation.total}
              onClick={navigation.onNext}
            />
          </>
        )}
      </div>
      {zoom && (
        <div className={styles.group}>
          {zoom.onReset && (
            <Button variant='quiet' size='compact' onClick={zoom.onReset}>
              Reset
            </Button>
          )}
          <IconButton
            label='Zoom out'
            icon='I134'
            size='compact'
            disabled={zoom.canZoomOut === false}
            onClick={zoom.onZoomOut}
          />
          <span className={styles.count} data-type='T060' aria-live='polite'>
            {zoom.label}
          </span>
          <IconButton
            label='Zoom in'
            icon='I074'
            size='compact'
            disabled={zoom.canZoomIn === false}
            onClick={zoom.onZoomIn}
          />
        </div>
      )}
    </div>
  )
}
