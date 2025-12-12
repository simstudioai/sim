import TemplateDetails from '@/app/templates/[id]/template'

/**
 * Public template detail page for unauthenticated users.
 * Authenticated-user redirect is handled in templates/[id]/layout.tsx.
 */
export default function TemplatePage() {
  return <TemplateDetails />
}
