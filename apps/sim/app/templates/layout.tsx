import TemplatesLayoutClient from './layout-client'

/**
 * Templates layout - server component wrapper for client layout.
 * Redirect logic is handled by individual pages to preserve paths.
 */
export default function TemplatesLayout({ children }: { children: React.ReactNode }) {
  return <TemplatesLayoutClient>{children}</TemplatesLayoutClient>
}
