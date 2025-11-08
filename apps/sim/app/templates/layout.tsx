import { season } from '@/app/fonts/season/season'

export default function TemplatesLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${season.variable} font-season`}>{children}</div>
}
