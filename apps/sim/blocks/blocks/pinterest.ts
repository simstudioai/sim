import { PinterestIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { PinterestResponse } from '@/tools/pinterest/types'

export const PinterestBlock: BlockConfig<PinterestResponse> = {
  type: 'pinterest',
  name: 'Pinterest',
  description: 'Create pins on your Pinterest boards',
  authMode: AuthMode.OAuth,
  longDescription: 'Create and share pins on Pinterest. Post images with titles, descriptions, and links to your boards.',
  docsLink: 'https://docs.sim.ai/tools/pinterest',
  category: 'tools',
  bgColor: '#E60023',
  icon: PinterestIcon,
  subBlocks: [
    {
      id: 'credential',
      title: 'Pinterest Account',
      type: 'oauth-input',
      serviceId: 'pinterest',
      requiredScopes: ['boards:read', 'boards:write', 'pins:read', 'pins:write'],
      placeholder: 'Select Pinterest account',
      required: true,
    },
    {
      id: 'board_id',
      title: 'Board ID',
      type: 'short-input',
      placeholder: 'Enter board ID (e.g., 1234567890)',
      required: true,
    },
    {
      id: 'title',
      title: 'Pin Title',
      type: 'short-input',
      placeholder: 'Enter pin title',
      required: true,
    },
    {
      id: 'description',
      title: 'Pin Description',
      type: 'long-input',
      placeholder: 'Enter pin description',
      required: true,
    },
    {
      id: 'media_url',
      title: 'Image URL',
      type: 'short-input',
      placeholder: 'Enter image URL',
      required: true,
    },
    {
      id: 'link',
      title: 'Destination Link',
      type: 'short-input',
      placeholder: 'Enter destination URL (optional)',
      required: false,
    },
    {
      id: 'alt_text',
      title: 'Alt Text',
      type: 'short-input',
      placeholder: 'Enter alt text for accessibility (optional)',
      required: false,
    },
  ],
  tools: {
    access: ['pinterest_create_pin'],
    config: {
      tool: () => 'pinterest_create_pin',
      params: (inputs) => {
        const { credential, ...rest } = inputs

        return {
          accessToken: credential,
          board_id: rest.board_id,
          title: rest.title,
          description: rest.description,
          media_url: rest.media_url,
          link: rest.link,
          alt_text: rest.alt_text,
        }
      },
    },
  },
  inputs: {
    credential: { type: 'string', description: 'Pinterest access token' },
    board_id: { type: 'string', description: 'Board ID where the pin will be created' },
    title: { type: 'string', description: 'Pin title' },
    description: { type: 'string', description: 'Pin description' },
    media_url: { type: 'string', description: 'Image URL for the pin' },
    link: { type: 'string', description: 'Destination link when pin is clicked' },
    alt_text: { type: 'string', description: 'Alt text for accessibility' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether the pin was created successfully' },
    pin: { type: 'json', description: 'Full pin object' },
    pin_id: { type: 'string', description: 'ID of the created pin' },
    pin_url: { type: 'string', description: 'URL of the created pin' },
    error: { type: 'string', description: 'Error message if operation failed' },
  },
}
