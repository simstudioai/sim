import {
  Avatar,
  AvatarGroup,
  EmptyState,
  LogoUploadField,
  Modal,
  MultiStepModal,
  PlatformSurface,
  RecipientField,
  ScrollArea,
  SearchableSelect,
  SelectField,
  TextField,
} from '@/platform/design-system/components'
import type { PreviewData, Scenario } from '@/platform/fixtures'
import { RecipeSpecimen } from '@/platform/preview/recipe-specimen'
import styles from '@/platform/preview/workbench.module.css'

interface WorkbenchProps {
  theme: 'light' | 'dark'
  scenario: Scenario
  data: PreviewData | null
  destination: number
  recipe?: string
}

export function Workbench({ theme, scenario, data, recipe, destination }: WorkbenchProps) {
  const organization = data?.organization
  const workspace = organization?.workspaces[0]
  const href = (nextTheme: string, nextState: string) => {
    const params = new URLSearchParams({ theme: nextTheme, state: nextState })
    if (recipe) params.set('recipe', recipe)
    return `/workbench?${params}`
  }

  return (
    <PlatformSurface theme={theme}>
      <main className={styles.page}>
        <div className={styles.sheet}>
          <header className={styles.header}>
            <p className={styles.kicker}>Sim / Design system</p>
            <h1 className={styles.title}>Platform library</h1>
            <div className={styles.toolbar}>
              <nav aria-label='Color theme' className={styles.links}>
                {(['light', 'dark'] as const).map((value) => (
                  <a
                    key={value}
                    className={styles[value === theme ? 'current' : 'link']}
                    aria-current={value === theme ? 'page' : undefined}
                    href={href(value, scenario)}
                  >
                    {value === 'light' ? 'Light' : 'Dark'}
                  </a>
                ))}
              </nav>
              {data && (
                <nav aria-label='Fixture state' className={styles.links}>
                  {(['empty', 'full', 'stress'] as const).map((value) => (
                    <a
                      key={value}
                      className={styles[value === scenario ? 'current' : 'link']}
                      aria-current={value === scenario ? 'page' : undefined}
                      href={href(theme, value)}
                    >
                      {value === 'stress'
                        ? 'Long content'
                        : value === 'full'
                          ? 'Populated'
                          : 'Empty'}
                    </a>
                  ))}
                </nav>
              )}
            </div>
          </header>
          <section className={styles.section} aria-labelledby='forms'>
            <div className={styles.caption}>
              <h2 id='forms' className={styles.heading}>
                Forms and dialogs
              </h2>
              <p className={styles.note}>
                Field labels, native input states and keyboard navigation.
              </p>
            </div>
            <div className={styles.stack}>
              <TextField
                label='Workspace name'
                placeholder='Enter a name'
                defaultValue={workspace?.name}
              />
              <SelectField
                label='Access'
                options={[
                  { value: 'private', label: 'Private' },
                  { value: 'organization', label: 'Organization' },
                ]}
              />
              <div className={styles.actions}>
                <MultiStepModal
                  triggerLabel='Create workspace'
                  title='Create workspace'
                  confirmLabel='Create workspace'
                  steps={[
                    {
                      description: 'Name your workspace.',
                      content: (
                        <>
                          <TextField
                            label='Name'
                            placeholder='Workspace name'
                            defaultValue={workspace?.name}
                          />
                          <LogoUploadField label='Logo' optional />
                        </>
                      ),
                    },
                    {
                      description: 'Set permissions.',
                      content: (
                        <SearchableSelect
                          label='Default role'
                          defaultValue='Member'
                          searchLabel='Find a role'
                          options={['Member', 'Viewer']}
                        />
                      ),
                    },
                    {
                      description: 'Invite people.',
                      content: (
                        <RecipientField
                          label='Email addresses'
                          defaultRecipients={
                            data?.organization.members.map((name) => ({
                              address: `${name.toLowerCase().replaceAll(' ', '.')}@example.test`,
                            })) ?? []
                          }
                          placeholder='Enter email addresses'
                        />
                      ),
                    },
                    {
                      description: 'Review workspace details.',
                      content: (
                        <TextField
                          placeholder='Organization name'
                          label='Organization'
                          disabled
                          defaultValue={organization?.name}
                        />
                      ),
                    },
                  ]}
                />
                <Modal
                  triggerLabel='Rename'
                  title='Rename workspace'
                  description='Choose a workspace name.'
                  confirmLabel='Save'
                >
                  <TextField placeholder='Name' label='Name' defaultValue={workspace?.name} />
                </Modal>
              </div>
            </div>
          </section>
          <section className={styles.section} aria-label='Preview data'>
            <div className={styles.caption}>
              <h2 className={styles.heading}>Organization</h2>
              <p className={styles.note}>
                {data ? 'Example data for the selected state.' : 'Preview data is off.'}
              </p>
            </div>
            {data && (
              <div className={styles.stack}>
                <div className={styles.identity}>
                  <Avatar name={data.organization.name} organization />
                  <p className={styles.name}>{data.organization.name}</p>
                </div>
                {!!data.organization.members.length && (
                  <AvatarGroup people={data.organization.members.map((name) => ({ name }))} />
                )}
                {workspace ? (
                  <div className={styles.list}>
                    <ScrollArea label='Workspace chats'>
                      {data.organization.workspaces.map((item) => (
                        <div key={item.name} className={styles.group}>
                          <h3 className={styles.name}>{item.name}</h3>
                          {item.chats.map((chat) => (
                            <p className={styles.chat} key={chat}>
                              {chat}
                            </p>
                          ))}
                        </div>
                      ))}
                    </ScrollArea>
                  </div>
                ) : (
                  <EmptyState title='No workspaces' description='Workspaces will appear here.' />
                )}
              </div>
            )}
          </section>
          <section className={styles.section} aria-labelledby='catalog'>
            <div className={styles.caption}>
              <h2 id='catalog' className={styles.heading}>
                Component catalog
              </h2>
              <p className={styles.note}>Inspect a master in the selected theme.</p>
            </div>
            <RecipeSpecimen
              theme={theme}
              requestedKey={recipe}
              destination={destination}
              data={data}
              scenario={scenario}
            />
          </section>
        </div>
      </main>
    </PlatformSurface>
  )
}
