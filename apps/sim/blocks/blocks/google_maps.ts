import { GoogleMapsIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const GoogleMapsBlock: BlockConfig = {
  type: 'google_maps',
  name: 'Google Maps',
  description: 'Geocoding, directions, places, and distance calculations',
  longDescription:
    'Integrate Google Maps Platform APIs into your workflow. Supports geocoding addresses to coordinates, reverse geocoding, getting directions between locations, calculating distance matrices, searching for places, retrieving place details, elevation data, and timezone information.',
  docsLink: 'https://docs.sim.ai/tools/google_maps',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: GoogleMapsIcon,

  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Geocode Address', id: 'geocode' },
        { label: 'Reverse Geocode', id: 'reverse_geocode' },
        { label: 'Get Directions', id: 'directions' },
        { label: 'Distance Matrix', id: 'distance_matrix' },
        { label: 'Search Places', id: 'places_search' },
        { label: 'Place Details', id: 'place_details' },
        { label: 'Get Elevation', id: 'elevation' },
        { label: 'Get Timezone', id: 'timezone' },
        { label: 'Snap to Roads', id: 'snap_to_roads' },
        { label: 'Speed Limits', id: 'speed_limits' },
        { label: 'Validate Address', id: 'validate_address' },
        { label: 'Geolocate (WiFi/Cell)', id: 'geolocate' },
        { label: 'Air Quality', id: 'air_quality' },
      ],
      value: () => 'geocode',
    },

    // API Key
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your Google Maps API key',
      required: true,
    },

    // ========== Geocode ==========
    {
      id: 'address',
      title: 'Address',
      type: 'long-input',
      placeholder: '1600 Amphitheatre Parkway, Mountain View, CA',
      condition: { field: 'operation', value: 'geocode' },
      required: { field: 'operation', value: 'geocode' },
      rows: 2,
    },

    {
      id: 'latitude',
      title: 'Latitude',
      type: 'short-input',
      placeholder: '37.4224764',
      condition: { field: 'operation', value: ['reverse_geocode', 'elevation', 'timezone'] },
      required: { field: 'operation', value: ['reverse_geocode', 'elevation', 'timezone'] },
    },
    {
      id: 'longitude',
      title: 'Longitude',
      type: 'short-input',
      placeholder: '-122.0842499',
      condition: { field: 'operation', value: ['reverse_geocode', 'elevation', 'timezone'] },
      required: { field: 'operation', value: ['reverse_geocode', 'elevation', 'timezone'] },
    },

    {
      id: 'timestamp',
      title: 'Timestamp',
      type: 'short-input',
      placeholder: 'Unix timestamp (defaults to current time)',
      condition: { field: 'operation', value: 'timezone' },
      mode: 'advanced',
    },

    {
      id: 'origin',
      title: 'Origin',
      type: 'short-input',
      placeholder: 'Starting address or coordinates (lat,lng)',
      condition: { field: 'operation', value: ['directions', 'distance_matrix'] },
      required: { field: 'operation', value: ['directions', 'distance_matrix'] },
    },
    {
      id: 'destination',
      title: 'Destination',
      type: 'short-input',
      placeholder: 'Destination address or coordinates (lat,lng)',
      condition: { field: 'operation', value: 'directions' },
      required: { field: 'operation', value: 'directions' },
    },
    {
      id: 'destinations',
      title: 'Destinations',
      type: 'long-input',
      placeholder: 'Destination addresses separated by | (e.g., New York, NY|Boston, MA)',
      condition: { field: 'operation', value: 'distance_matrix' },
      required: { field: 'operation', value: 'distance_matrix' },
      rows: 3,
    },
    {
      id: 'mode',
      title: 'Travel Mode',
      type: 'dropdown',
      options: [
        { label: 'Driving', id: 'driving' },
        { label: 'Walking', id: 'walking' },
        { label: 'Bicycling', id: 'bicycling' },
        { label: 'Transit', id: 'transit' },
      ],
      value: () => 'driving',
      condition: { field: 'operation', value: ['directions', 'distance_matrix'] },
    },
    {
      id: 'avoid',
      title: 'Avoid',
      type: 'dropdown',
      options: [
        { label: 'None', id: '' },
        { label: 'Tolls', id: 'tolls' },
        { label: 'Highways', id: 'highways' },
        { label: 'Ferries', id: 'ferries' },
      ],
      condition: { field: 'operation', value: ['directions', 'distance_matrix'] },
      mode: 'advanced',
    },
    {
      id: 'waypoints',
      title: 'Waypoints',
      type: 'long-input',
      placeholder: 'Optional stops separated by | (e.g., Stop 1|Stop 2)',
      condition: { field: 'operation', value: 'directions' },
      rows: 2,
      mode: 'advanced',
    },
    {
      id: 'units',
      title: 'Units',
      type: 'dropdown',
      options: [
        { label: 'Metric (km)', id: 'metric' },
        { label: 'Imperial (miles)', id: 'imperial' },
      ],
      value: () => 'metric',
      condition: { field: 'operation', value: ['directions', 'distance_matrix'] },
      mode: 'advanced',
    },

    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'restaurants near Times Square',
      condition: { field: 'operation', value: 'places_search' },
      required: { field: 'operation', value: 'places_search' },
    },
    {
      id: 'locationBias',
      title: 'Location Bias',
      type: 'short-input',
      placeholder: 'lat,lng to bias results (e.g., 40.7580,-73.9855)',
      condition: { field: 'operation', value: 'places_search' },
      mode: 'advanced',
    },
    {
      id: 'radius',
      title: 'Radius (meters)',
      type: 'short-input',
      placeholder: 'Search radius in meters (e.g., 5000)',
      condition: { field: 'operation', value: 'places_search' },
      mode: 'advanced',
    },
    {
      id: 'placeType',
      title: 'Place Type',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Restaurant', id: 'restaurant' },
        { label: 'Cafe', id: 'cafe' },
        { label: 'Bar', id: 'bar' },
        { label: 'Hotel', id: 'lodging' },
        { label: 'Gas Station', id: 'gas_station' },
        { label: 'Hospital', id: 'hospital' },
        { label: 'Pharmacy', id: 'pharmacy' },
        { label: 'Bank', id: 'bank' },
        { label: 'ATM', id: 'atm' },
        { label: 'Grocery Store', id: 'supermarket' },
        { label: 'Shopping Mall', id: 'shopping_mall' },
        { label: 'Gym', id: 'gym' },
        { label: 'Park', id: 'park' },
        { label: 'Museum', id: 'museum' },
        { label: 'Movie Theater', id: 'movie_theater' },
        { label: 'Airport', id: 'airport' },
        { label: 'Train Station', id: 'train_station' },
        { label: 'Bus Station', id: 'bus_station' },
        { label: 'Parking', id: 'parking' },
      ],
      condition: { field: 'operation', value: 'places_search' },
      mode: 'advanced',
    },

    {
      id: 'placeId',
      title: 'Place ID',
      type: 'short-input',
      placeholder: 'Google Place ID (e.g., ChIJN1t_tDeuEmsRUsoyG83frY4)',
      condition: { field: 'operation', value: 'place_details' },
      required: { field: 'operation', value: 'place_details' },
    },
    {
      id: 'fields',
      title: 'Fields',
      type: 'short-input',
      placeholder: 'name,formatted_address,rating,opening_hours',
      condition: { field: 'operation', value: 'place_details' },
      mode: 'advanced',
    },

    {
      id: 'path',
      title: 'Path',
      type: 'long-input',
      placeholder: 'Pipe-separated lat,lng pairs (e.g., 60.170880,24.942795|60.170879,24.942796)',
      condition: { field: 'operation', value: ['snap_to_roads', 'speed_limits'] },
      required: { field: 'operation', value: 'snap_to_roads' },
      rows: 3,
    },
    {
      id: 'interpolate',
      title: 'Interpolate',
      type: 'switch',
      condition: { field: 'operation', value: 'snap_to_roads' },
      mode: 'advanced',
    },

    {
      id: 'placeIds',
      title: 'Place IDs',
      type: 'long-input',
      placeholder: 'Pipe-separated Place IDs (alternative to path)',
      condition: { field: 'operation', value: 'speed_limits' },
      rows: 2,
      mode: 'advanced',
    },

    {
      id: 'addressToValidate',
      title: 'Address',
      type: 'long-input',
      placeholder: '1600 Amphitheatre Parkway, Mountain View, CA 94043',
      condition: { field: 'operation', value: 'validate_address' },
      required: { field: 'operation', value: 'validate_address' },
      rows: 2,
    },
    {
      id: 'regionCode',
      title: 'Region Code',
      type: 'short-input',
      placeholder: 'ISO country code (e.g., US, CA, GB)',
      condition: { field: 'operation', value: 'validate_address' },
      mode: 'advanced',
    },
    {
      id: 'locality',
      title: 'Locality',
      type: 'short-input',
      placeholder: 'City name (optional hint)',
      condition: { field: 'operation', value: 'validate_address' },
      mode: 'advanced',
    },
    {
      id: 'enableUspsCass',
      title: 'Enable USPS CASS',
      type: 'switch',
      condition: { field: 'operation', value: 'validate_address' },
      mode: 'advanced',
    },

    {
      id: 'considerIp',
      title: 'Use IP Address',
      type: 'switch',
      condition: { field: 'operation', value: 'geolocate' },
    },
    {
      id: 'radioType',
      title: 'Radio Type',
      type: 'dropdown',
      options: [
        { label: 'None', id: '' },
        { label: 'LTE', id: 'lte' },
        { label: 'GSM', id: 'gsm' },
        { label: 'CDMA', id: 'cdma' },
        { label: 'WCDMA', id: 'wcdma' },
        { label: '5G NR', id: 'nr' },
      ],
      condition: { field: 'operation', value: 'geolocate' },
      mode: 'advanced',
    },
    {
      id: 'carrier',
      title: 'Carrier',
      type: 'short-input',
      placeholder: 'Carrier name',
      condition: { field: 'operation', value: 'geolocate' },
      mode: 'advanced',
    },
    {
      id: 'wifiAccessPoints',
      title: 'WiFi Access Points',
      type: 'long-input',
      placeholder: 'JSON array of WiFi APs: [{"macAddress": "..."}]',
      condition: { field: 'operation', value: 'geolocate' },
      rows: 3,
      mode: 'advanced',
    },
    {
      id: 'cellTowers',
      title: 'Cell Towers',
      type: 'long-input',
      placeholder: 'JSON array of cell towers: [{"cellId": ..., "locationAreaCode": ...}]',
      condition: { field: 'operation', value: 'geolocate' },
      rows: 3,
      mode: 'advanced',
    },

    {
      id: 'aqLatitude',
      title: 'Latitude',
      type: 'short-input',
      placeholder: '37.4224764',
      condition: { field: 'operation', value: 'air_quality' },
      required: { field: 'operation', value: 'air_quality' },
    },
    {
      id: 'aqLongitude',
      title: 'Longitude',
      type: 'short-input',
      placeholder: '-122.0842499',
      condition: { field: 'operation', value: 'air_quality' },
      required: { field: 'operation', value: 'air_quality' },
    },
    {
      id: 'languageCode',
      title: 'Language Code',
      type: 'short-input',
      placeholder: 'Language code (e.g., en, es)',
      condition: { field: 'operation', value: 'air_quality' },
      mode: 'advanced',
    },

    {
      id: 'language',
      title: 'Language',
      type: 'short-input',
      placeholder: 'Language code (e.g., en, es, fr, de)',
      mode: 'advanced',
    },
    {
      id: 'region',
      title: 'Region Bias',
      type: 'short-input',
      placeholder: 'Country code (e.g., us, uk, de)',
      mode: 'advanced',
      condition: { field: 'operation', value: ['geocode', 'places_search'] },
    },
  ],

  tools: {
    access: [
      'google_maps_air_quality',
      'google_maps_directions',
      'google_maps_distance_matrix',
      'google_maps_elevation',
      'google_maps_geocode',
      'google_maps_geolocate',
      'google_maps_place_details',
      'google_maps_places_search',
      'google_maps_reverse_geocode',
      'google_maps_snap_to_roads',
      'google_maps_speed_limits',
      'google_maps_timezone',
      'google_maps_validate_address',
    ],
    config: {
      tool: (params) => `google_maps_${params.operation}`,
      params: (params) => {
        const { operation, locationBias, ...rest } = params

        let location: { lat: number; lng: number } | undefined
        if (locationBias && typeof locationBias === 'string' && locationBias.includes(',')) {
          const [lat, lng] = locationBias.split(',').map((s) => Number.parseFloat(s.trim()))
          if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
            location = { lat, lng }
          }
        }

        let lat: number | undefined
        let lng: number | undefined
        if (params.latitude) {
          lat = Number.parseFloat(params.latitude)
        }
        if (params.longitude) {
          lng = Number.parseFloat(params.longitude)
        }

        if (params.aqLatitude) {
          lat = Number.parseFloat(params.aqLatitude)
        }
        if (params.aqLongitude) {
          lng = Number.parseFloat(params.aqLongitude)
        }

        let timestamp: number | undefined
        if (params.timestamp) {
          timestamp = Number.parseInt(params.timestamp, 10)
        }

        let destinations: string[] | undefined
        if (params.destinations && typeof params.destinations === 'string') {
          destinations = params.destinations.split('|').map((d: string) => d.trim())
        }

        let waypoints: string[] | undefined
        if (params.waypoints && typeof params.waypoints === 'string') {
          waypoints = params.waypoints
            .split('|')
            .map((w: string) => w.trim())
            .filter(Boolean)
        }

        let radius: number | undefined
        if (params.radius) {
          radius = Number.parseInt(params.radius, 10)
        }

        let placeIds: string[] | undefined
        if (params.placeIds && typeof params.placeIds === 'string') {
          placeIds = params.placeIds
            .split('|')
            .map((p: string) => p.trim())
            .filter(Boolean)
        }

        let wifiAccessPoints: unknown[] | undefined
        if (params.wifiAccessPoints && typeof params.wifiAccessPoints === 'string') {
          try {
            wifiAccessPoints = JSON.parse(params.wifiAccessPoints)
          } catch {
            // Ignore parse errors
          }
        }

        let cellTowers: unknown[] | undefined
        if (params.cellTowers && typeof params.cellTowers === 'string') {
          try {
            cellTowers = JSON.parse(params.cellTowers)
          } catch {
            // Ignore parse errors
          }
        }

        const address = params.addressToValidate || params.address

        // Parse boolean switches (can come as string or boolean from form)
        let interpolate: boolean | undefined
        if (params.interpolate !== undefined) {
          interpolate = params.interpolate === 'true' || params.interpolate === true
        }

        let enableUspsCass: boolean | undefined
        if (params.enableUspsCass !== undefined) {
          enableUspsCass = params.enableUspsCass === 'true' || params.enableUspsCass === true
        }

        let considerIp: boolean | undefined
        if (params.considerIp !== undefined) {
          considerIp = params.considerIp === 'true' || params.considerIp === true
        }

        return {
          ...rest,
          address,
          location,
          lat,
          lng,
          timestamp,
          destinations,
          waypoints,
          radius,
          placeIds,
          wifiAccessPoints,
          cellTowers,
          interpolate,
          enableUspsCass,
          considerIp,
          type: params.placeType || undefined,
          avoid: params.avoid || undefined,
          radioType: params.radioType || undefined,
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Google Maps API key' },
    address: { type: 'string', description: 'Address to geocode' },
    latitude: { type: 'string', description: 'Latitude coordinate' },
    longitude: { type: 'string', description: 'Longitude coordinate' },
    timestamp: { type: 'string', description: 'Unix timestamp for timezone' },
    origin: { type: 'string', description: 'Starting location' },
    destination: { type: 'string', description: 'Destination location' },
    destinations: { type: 'string', description: 'Multiple destinations (pipe-separated)' },
    mode: { type: 'string', description: 'Travel mode' },
    avoid: { type: 'string', description: 'Features to avoid' },
    waypoints: { type: 'string', description: 'Waypoints (pipe-separated)' },
    query: { type: 'string', description: 'Places search query' },
    locationBias: { type: 'string', description: 'Location bias for search' },
    radius: { type: 'string', description: 'Search radius in meters' },
    placeType: { type: 'string', description: 'Place type filter' },
    placeId: { type: 'string', description: 'Google Place ID' },
    fields: { type: 'string', description: 'Fields to retrieve' },
    units: { type: 'string', description: 'Unit system' },
    language: { type: 'string', description: 'Response language' },
    region: { type: 'string', description: 'Region bias' },
    path: { type: 'string', description: 'Pipe-separated lat,lng coordinates' },
    interpolate: { type: 'boolean', description: 'Interpolate points along road' },
    placeIds: { type: 'string', description: 'Pipe-separated Place IDs for speed limits' },
    addressToValidate: { type: 'string', description: 'Address to validate' },
    regionCode: { type: 'string', description: 'ISO country code for address' },
    locality: { type: 'string', description: 'City name hint' },
    enableUspsCass: { type: 'boolean', description: 'Enable USPS CASS validation' },
    considerIp: { type: 'boolean', description: 'Use IP for geolocation' },
    radioType: { type: 'string', description: 'Radio type (lte, gsm, etc.)' },
    carrier: { type: 'string', description: 'Carrier name' },
    wifiAccessPoints: { type: 'string', description: 'WiFi access points JSON' },
    cellTowers: { type: 'string', description: 'Cell towers JSON' },
    aqLatitude: { type: 'string', description: 'Latitude for air quality' },
    aqLongitude: { type: 'string', description: 'Longitude for air quality' },
    languageCode: { type: 'string', description: 'Language code for air quality' },
  },

  outputs: {
    formattedAddress: { type: 'string', description: 'Formatted address string' },
    lat: { type: 'number', description: 'Latitude coordinate' },
    lng: { type: 'number', description: 'Longitude coordinate' },
    placeId: { type: 'string', description: 'Google Place ID' },
    addressComponents: { type: 'json', description: 'Detailed address components' },
    locationType: { type: 'string', description: 'Location accuracy type' },
    types: { type: 'json', description: 'Address or place types' },

    routes: { type: 'json', description: 'Available routes' },
    distanceText: { type: 'string', description: 'Distance as text (e.g., "5.2 km")' },
    distanceMeters: { type: 'number', description: 'Distance in meters' },
    durationText: { type: 'string', description: 'Duration as text (e.g., "15 mins")' },
    durationSeconds: { type: 'number', description: 'Duration in seconds' },
    startAddress: { type: 'string', description: 'Starting address' },
    endAddress: { type: 'string', description: 'Ending address' },
    steps: { type: 'json', description: 'Turn-by-turn directions' },
    polyline: { type: 'string', description: 'Encoded polyline for the route' },

    rows: { type: 'json', description: 'Distance matrix rows' },
    originAddresses: { type: 'json', description: 'Resolved origin addresses' },
    destinationAddresses: { type: 'json', description: 'Resolved destination addresses' },

    places: { type: 'json', description: 'List of places found' },
    nextPageToken: { type: 'string', description: 'Token for next page of results' },

    name: { type: 'string', description: 'Place name' },
    rating: { type: 'number', description: 'Place rating (1-5)' },
    userRatingsTotal: { type: 'number', description: 'Number of user ratings' },
    priceLevel: { type: 'number', description: 'Price level (0-4)' },
    website: { type: 'string', description: 'Place website' },
    phoneNumber: { type: 'string', description: 'Place phone number' },
    internationalPhoneNumber: { type: 'string', description: 'International phone number' },
    openNow: { type: 'boolean', description: 'Whether place is currently open' },
    weekdayText: { type: 'json', description: 'Opening hours by day' },
    reviews: { type: 'json', description: 'Place reviews' },
    photos: { type: 'json', description: 'Place photos' },
    url: { type: 'string', description: 'Google Maps URL for the place' },
    vicinity: { type: 'string', description: 'Simplified address' },

    elevation: { type: 'number', description: 'Elevation in meters' },
    resolution: { type: 'number', description: 'Data resolution in meters' },

    timeZoneId: { type: 'string', description: 'Timezone ID (e.g., America/New_York)' },
    timeZoneName: { type: 'string', description: 'Timezone display name' },
    rawOffset: { type: 'number', description: 'UTC offset in seconds (without DST)' },
    dstOffset: { type: 'number', description: 'DST offset in seconds' },

    snappedPoints: { type: 'json', description: 'Snapped road coordinates' },
    warningMessage: { type: 'string', description: 'Warning message if any' },

    speedLimits: { type: 'json', description: 'Speed limits for road segments' },

    addressComplete: { type: 'boolean', description: 'Whether address is complete' },
    hasUnconfirmedComponents: { type: 'boolean', description: 'Has unconfirmed components' },
    hasInferredComponents: { type: 'boolean', description: 'Has inferred components' },
    hasReplacedComponents: { type: 'boolean', description: 'Has replaced components' },
    validationGranularity: { type: 'string', description: 'Validation granularity level' },
    geocodeGranularity: { type: 'string', description: 'Geocode granularity level' },
    missingComponentTypes: { type: 'json', description: 'Missing address component types' },
    unconfirmedComponentTypes: { type: 'json', description: 'Unconfirmed component types' },
    unresolvedTokens: { type: 'json', description: 'Unresolved input tokens' },

    accuracy: { type: 'number', description: 'Location accuracy in meters' },

    dateTime: { type: 'string', description: 'Air quality data timestamp' },
    regionCode: { type: 'string', description: 'Region code' },
    indexes: { type: 'json', description: 'Air quality indexes' },
    pollutants: { type: 'json', description: 'Pollutant concentrations' },
    healthRecommendations: { type: 'json', description: 'Health recommendations' },
  },
}
