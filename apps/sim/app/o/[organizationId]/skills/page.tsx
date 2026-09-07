import type { Metadata } from 'next'
import { Skills } from './skills'

export const metadata: Metadata = {
  title: 'Skills',
}

export default function OrganizationSkillsPage() {
  return <Skills />
}
