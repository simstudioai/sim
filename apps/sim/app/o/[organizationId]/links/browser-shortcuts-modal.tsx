import {
  ChipLink,
  ChipModal,
  ChipModalBody,
  ChipModalDescription,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import { ManagedBookmarks } from '@/app/o/[organizationId]/links/managed-bookmarks'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'

interface BrowserShortcutsModalProps {
  onClose: () => void
}

export function BrowserShortcutsModal({ onClose }: BrowserShortcutsModalProps) {
  const { viewer, organization } = useOrganizationContext()
  return (
    <ChipModal open onOpenChange={(open) => !open && onClose()} srTitle='Browser shortcuts'>
      <ChipModalHeader onClose={onClose}>Browser shortcuts</ChipModalHeader>
      <ChipModalBody>
        <ChipModalDescription>
          With Sim for Chrome installed, type <strong>sim</strong> in the address bar, press{' '}
          <strong>Space</strong>, and start typing a link name. For suggestions outside this
          shortcut,{' '}
          <a
            href='https://docs.sim.ai/search/sim-links#show-favorites-in-regular-chrome-suggestions'
            target='_blank'
            rel='noopener noreferrer'
            className='underline underline-offset-2'
          >
            bookmark a favorite
          </a>
          .
        </ChipModalDescription>
        <ChipModalField
          type='copy'
          title='Setup address'
          value='http://sim/'
          copyLabel='Copy setup address'
          hint='Paste this into your work profile’s Chrome address bar once to use shortcuts like sim/handbook.'
        />
        {viewer.isAdmin && (
          <ManagedBookmarks key={organization.id} organizationId={organization.id} />
        )}
      </ChipModalBody>
      <ChipModalFooter
        secondaryActions={[
          {
            custom: (
              <ChipLink
                href='https://chromewebstore.google.com/detail/sim/oanlcahddodnjpdoopcpjlcageejjpmg'
                target='_blank'
                rel='noopener noreferrer'
              >
                Install Sim for Chrome
              </ChipLink>
            ),
          },
        ]}
        defaultAction='dismiss'
        cancelLabel='Done'
        onCancel={onClose}
      />
    </ChipModal>
  )
}
