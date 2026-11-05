import type { ReactNode } from 'react'

interface ExtensionDialogProps {
  labelledBy: string
  describedBy?: string
  onClose: () => void
  children: ReactNode
}

/** Chrome owns modality so the dialog works without the scroll-lock stylesheet the CSP blocks. */
function showDialog(dialog: HTMLDialogElement | null) {
  if (!dialog) return
  dialog.showModal()
  return () => dialog.close()
}

export function ExtensionDialog({
  labelledBy,
  describedBy,
  onClose,
  children,
}: ExtensionDialogProps) {
  return (
    <dialog
      ref={showDialog}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className='m-auto max-h-[85vh] w-[90vw] max-w-[440px] overflow-visible border-0 bg-transparent p-0 text-inherit backdrop:bg-black/10 backdrop:backdrop-blur-[2px]'
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {children}
    </dialog>
  )
}
