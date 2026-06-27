import { GoogleMapsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

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

export const GoogleMapsBlockMeta = {
  tags: ['google-workspace', 'enrichment'],
  url: 'https://mapsplatform.google.com',
  templates: [
    {
      icon: GoogleMapsIcon,
      title: 'Google Maps competitor location finder',
      prompt:
        'Build a workflow that uses Google Maps to find competitor locations in a target city, writes coordinates and details to a table, and emails the sales team a route map.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: GoogleMapsIcon,
      title: 'Google Maps territory builder',
      prompt:
        'Create a workflow that takes a list of CRM accounts, geocodes them via Google Maps, clusters into territories, and writes the assignment to a tables-based territory plan.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'analysis'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: GoogleMapsIcon,
      title: 'Google Maps event-attendee proximity',
      prompt:
        'Build a workflow that for a Luma event sorts registrants by proximity to the venue via Google Maps, writes the list, and offers a quick-action transport option.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'communication'],
      alsoIntegrations: ['luma'],
    },
    {
      icon: GoogleMapsIcon,
      title: 'Google Maps logistics planner',
      prompt:
        'Create a workflow that takes a delivery list, optimizes the route via Google Maps directions, and writes a per-driver itinerary to a tables-based dispatcher view.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'automation'],
    },
    {
      icon: GoogleMapsIcon,
      title: 'Google Maps store-locator updater',
      prompt:
        'Build a scheduled workflow that audits store locations on the website against Google Maps Places data, flags out-of-date hours or addresses, and pings the team to correct.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleMapsIcon,
      title: 'Google Maps review tracker',
      prompt:
        'Create a scheduled workflow that watches Google Maps reviews of brand locations daily, classifies sentiment, and pings the right manager in Slack on new negative reviews.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleMapsIcon,
      title: 'Google Maps lead-by-region exporter',
      prompt:
        'Build a workflow that uses Google Maps to find businesses matching an ICP in a region, enriches via Hunter, and writes the prospect list to HubSpot.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['hunter', 'hubspot'],
    },
  ],
  skills: [
    {
      name: 'geocode-address',
      description:
        'Convert an address into latitude/longitude coordinates with a normalized formatted address.',
      content:
        '# Geocode an Address\n\nTurn a street address into coordinates.\n\n## Steps\n1. Take the address string from the request.\n2. Run the Geocode Address operation; optionally set a Region Bias (country code) to disambiguate.\n3. Read the returned lat, lng, formatted address, place ID, and location type.\n4. If multiple candidates are likely, note the accuracy/location type so the requester can confirm.\n\n## Output\nReturn the formatted address, latitude, longitude, and place ID. To go the other way (coordinates to address), use Reverse Geocode instead.',
    },
    {
      name: 'get-directions',
      description:
        'Compute a route between two locations with distance, duration, and turn-by-turn steps.',
      content:
        '# Get Directions\n\nRoute between an origin and a destination.\n\n## Steps\n1. Capture origin and destination (addresses or `lat,lng`).\n2. Choose Travel Mode (driving, walking, bicycling, transit) and optionally features to Avoid (tolls, highways, ferries).\n3. Add Waypoints (pipe-separated) for intermediate stops if requested, and pick Units (metric/imperial).\n4. Run the Get Directions operation.\n\n## Output\nReturn total distance and duration (as text and numeric), start/end addresses, and a concise turn-by-turn step list. Mention the travel mode used.',
    },
    {
      name: 'find-nearby-places',
      description: 'Search for places matching a query near a location and return ranked results.',
      content:
        '# Find Nearby Places\n\nDiscover places (restaurants, hotels, etc.) near a spot.\n\n## Steps\n1. Build the Search Query (e.g., "coffee near Times Square") and set a Location Bias (`lat,lng`) and Radius if known.\n2. Optionally constrain by Place Type (restaurant, hotel, gas_station, etc.).\n3. Run the Search Places operation.\n4. For a chosen result, run Place Details with its Place ID to get rating, hours, phone, and website.\n\n## Output\nA ranked list of places: name, address, rating and number of ratings, open-now status, and place ID. Include phone/website for the top pick when details were fetched.',
    },
    {
      name: 'calculate-travel-distances',
      description: 'Compute distances and travel times from one origin to many destinations.',
      content:
        '# Calculate Travel Distances\n\nGet a distance matrix from an origin to multiple destinations.\n\n## Steps\n1. Set the Origin and provide Destinations as a pipe-separated list (e.g., "New York, NY|Boston, MA").\n2. Choose Travel Mode and Units; optionally set features to Avoid.\n3. Run the Distance Matrix operation.\n4. Read each row for distance and duration to each destination.\n\n## Output\nA table of destinations sorted by travel time or distance, each with distance text and duration text. Useful for picking the nearest option or planning routes.',
    },
  ],
} as const satisfies BlockMeta
