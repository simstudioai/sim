import {
  PlatformHeroVisual,
  SolutionsPage,
  type SolutionsPageConfig,
} from '@/app/(landing)/components'
import {
  AuditTrailGraphic,
  OperationsTeamsGraphic,
  RunMonitoringGraphic,
} from '@/app/(landing)/enterprise/components/feature-graphics'
import { FileLibraryGraphic } from '@/app/(landing)/files/components/feature-graphics/file-library-graphic'
import { FilesSdkGraphic } from '@/app/(landing)/files/components/feature-graphics/files-sdk-graphic'
import { FilesHeroLoop } from '@/app/(landing)/files/components/files-hero-loop'
import { DocumentDraftGraphic } from '@/app/(landing)/solutions/components/feature-graphics'

/**
 * Files platform page - a consumer of {@link SolutionsPage} rendered with
 * the enterprise page's feature-tile treatment.
 *
 * The whole page is one typed {@link SolutionsPageConfig} rendered inside
 * the shared route-group layout chrome: identity (for structured data), a
 * hero, and two rows of three feature tiles. The story is one file store
 * shared by the team and its agents - agents read files as inputs, produce
 * files as outputs, and every artifact lands in the same place. Every
 * visual slot carries a feature graphic in the enterprise design language:
 * two files-specific vignettes (the shared library ledger and the SDK
 * upload window) plus the switchboard, audit ledger, run monitor, and
 * document draft retold for file routing, file history, parse runs, and
 * agent-written reports.
 */
/** Shared meta + JSON-LD description for the Files page — one string, zero drift. */
export const FILES_PAGE_DESCRIPTION =
  'Files is the file storage for AI agents and teams in Sim. Upload, create, and share in one store — agents read files as inputs and write outputs back.'

const FILES_CONFIG: SolutionsPageConfig = {
  module: 'Files',
  path: '/files',
  seoDescription: FILES_PAGE_DESCRIPTION,
  hero: {
    eyebrow: 'Files',
    heading: 'One file store for your team and every agent in Sim.',
    description:
      'Files is the file storage for teams and every AI agent in Sim, the open-source AI workspace. Upload, create, and share — agents read files as inputs and produce new files as outputs.',
    summary:
      'Files is the file storage for teams and AI agents in Sim, the open-source AI workspace where teams build, deploy, and manage AI agents. Teams upload, create, and share files, and agents read them as inputs, parse them, and produce new files as outputs.',
    visual: (
      <PlatformHeroVisual>
        <FilesHeroLoop />
      </PlatformHeroVisual>
    ),
  },
  rows: [
    {
      id: 'store',
      title: 'One place for every file.',
      subtitle:
        'Sim keeps uploads, agent outputs, and shared documents in a single store your whole workspace can reach.',
      cta: { label: 'Explore Files', href: '/signup' },
      cards: [
        {
          title: 'One shared library',
          description:
            "Sim stores your team's uploads and your agents' outputs side by side, so nothing lives in a silo.",
          visual: <FileLibraryGraphic />,
        },
        {
          title: 'Files flow through workflows',
          description:
            'Sim routes files from uploads, email, and drives into agent runs, then delivers the results where your team works.',
          featureTileTone: 'dark',
          featureTileDescriptionTone: 'soft',
          visual: (
            <OperationsTeamsGraphic
              sourceLabels={['Uploads', 'Gmail', 'Drive']}
              destinationLabels={['Slack', 'Reports', 'Archive']}
            />
          ),
        },
        {
          title: 'Every file action on the record',
          description:
            'Sim logs every upload, parse, and share, so teams always know where a file came from.',
          visual: (
            <AuditTrailGraphic
              entries={[
                {
                  action: 'File uploaded',
                  actor: 'Maya Chen',
                  resource: 'brand-guidelines.pdf',
                  time: 'Now',
                  avatar: '/landing/team-avatar-1.jpg',
                },
                {
                  action: 'Report generated',
                  actor: 'Report agent',
                  resource: 'weekly-report.pdf',
                  time: '12 min ago',
                  avatar: '/landing/team-avatar-2.jpg',
                },
                {
                  action: 'File parsed',
                  actor: 'Invoice agent',
                  resource: 'vendor-invoices.pdf',
                  time: '1h ago',
                  avatar: '/landing/team-avatar-3.jpg',
                },
                {
                  action: 'Folder shared',
                  actor: 'Jordan Lee',
                  resource: 'Q3 planning',
                  time: 'Jun 12',
                  avatar: '/landing/team-avatar-1.jpg',
                },
              ]}
            />
          ),
        },
      ],
    },
    {
      id: 'agents',
      title: 'Agents read, parse, and produce files.',
      subtitle:
        'Sim agents take files as inputs, pull the data out, and write new files back to the store for your team.',
      cta: { label: 'Build a file-handling agent', href: '/signup' },
      cards: [
        {
          title: 'Read and parse anything',
          description:
            'Sim agents take PDFs, spreadsheets, and docs as inputs and pull out the fields your workflow needs.',
          visual: (
            <RunMonitoringGraphic
              title='Parse run'
              fields={[
                { label: 'File', value: 'vendor-invoices.pdf', variant: 'strong' },
                { label: 'Trigger', value: 'File upload', variant: 'chip' },
                { label: 'Pages', value: '32', variant: 'mono' },
                { label: 'Duration', value: '2.4s', variant: 'mono' },
              ]}
              outputLabel='Extracted output'
              outputPairs={[
                { key: 'status', value: '"parsed"' },
                { key: 'fields', value: '214' },
              ]}
            />
          ),
        },
        {
          title: 'Produce files as outputs',
          description:
            'Sim agents draft reports, exports, and summaries, then save them to Files for the whole team.',
          visual: (
            <DocumentDraftGraphic
              title='Weekly report'
              statusTag='Agent-drafted'
              footerLabel='Saved to Files'
              footerDetail='Just now'
            />
          ),
        },
        {
          title: 'Read and write from code',
          description:
            "Sim's SDK gives every agent the same file store, so code reads inputs and uploads outputs in a few lines.",
          featureTileTone: 'dark',
          featureTileDescriptionTone: 'soft',
          visual: <FilesSdkGraphic />,
        },
      ],
    },
  ],
}

export default function Files() {
  return <SolutionsPage config={FILES_CONFIG} />
}
