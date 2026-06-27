import { GoogleMapsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GoogleMapsBlockDisplay = {
  type: 'google_maps',
  name: 'Google Maps',
  description: 'Geocoding, directions, places, and distance calculations',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleMapsIcon,
  longDescription:
    'Integrate Google Maps Platform APIs into your workflow. Supports geocoding addresses to coordinates, reverse geocoding, getting directions between locations, calculating distance matrices, searching for places, retrieving place details, elevation data, and timezone information.',
  docsLink: 'https://docs.sim.ai/integrations/google_maps',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay
