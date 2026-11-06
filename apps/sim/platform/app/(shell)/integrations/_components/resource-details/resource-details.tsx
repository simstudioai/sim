import { ModalBody, PropertyList, TextAreaField } from '@/platform/design-system/components'
import { OverlayDialog } from '@/platform/design-system/components/modal/overlay-dialog'
import type { IntegrationResource } from '@/platform/lib/integrations/center-model'

interface ResourceDetailsProps {
  resource: IntegrationResource
  onClose: () => void
}

export function ResourceDetails({ resource, onClose }: ResourceDetailsProps) {
  return (
    <OverlayDialog title={resource.name} description={resource.description} open onClose={onClose}>
      <ModalBody>
        <PropertyList
          title='Details'
          titleHidden
          properties={[
            {
              id: 'owner',
              label: 'Owner',
              kind: 'person',
              value: resource.owner.name,
              src: resource.owner.src,
            },
            {
              id: 'access',
              label: 'Access',
              kind: 'text',
              value: resource.scope === 'shared' ? 'Shared' : 'Personal',
            },
            {
              id: 'people',
              label: 'People with access',
              kind: 'text',
              value: resource.people.map((person) => person.name).join(', '),
            },
            ...(resource.kind === 'mcp'
              ? [{ id: 'url', label: 'Server URL', kind: 'text' as const, value: resource.url }]
              : []),
            ...(resource.kind === 'credential'
              ? [{ id: 'key', label: 'Key', kind: 'text' as const, value: resource.key }]
              : []),
          ]}
        />
        {resource.kind === 'skill' && (
          <TextAreaField label='Instructions' value={resource.instructions} readOnly />
        )}
      </ModalBody>
    </OverlayDialog>
  )
}
