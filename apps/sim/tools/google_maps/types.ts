import type { ToolResponse } from '@/tools/types'

/**
 * Common location type
 */
export interface LatLng {
  lat: number
  lng: number
}

/**
 * Address component from geocoding
 */
export interface AddressComponent {
  longName: string
  shortName: string
  types: string[]
}

/**
 * Snapped point from Roads API
 */
export interface SnappedPoint {
  location: LatLng
  originalIndex?: number
  placeId: string
}

/**
 * Speed limit info from Roads API
 */
export interface SpeedLimit {
  placeId: string
  speedLimit: number
  units: 'KPH' | 'MPH'
}

/**
 * Cell tower info for geolocation
 */
export interface CellTower {
  cellId: number
  locationAreaCode: number
  mobileCountryCode: number
  mobileNetworkCode: number
  age?: number
  signalStrength?: number
  timingAdvance?: number
}

/**
 * WiFi access point info for geolocation
 */
export interface WifiAccessPoint {
  macAddress: string
  signalStrength?: number
  age?: number
  channel?: number
  signalToNoiseRatio?: number
}

/**
 * Air quality index info
 */
export interface AirQualityIndex {
  code: string
  displayName: string
  aqi: number
  aqiDisplay: string
  color: {
    red: number
    green: number
    blue: number
  }
  category: string
  dominantPollutant: string
}

/**
 * Pollutant concentration info
 */
export interface Pollutant {
  code: string
  displayName: string
  fullName: string
  concentration: {
    value: number
    units: string
  }
  additionalInfo?: {
    sources: string
    effects: string
  }
}

// Geocode
// ============================================================================

export interface GoogleMapsGeocodeParams {
  apiKey: string
  address: string
  language?: string
  region?: string
}

export interface GoogleMapsGeocodeResponse extends ToolResponse {
  output: {
    formattedAddress: string
    lat: number
    lng: number
    location: LatLng
    placeId: string
    addressComponents: AddressComponent[]
    locationType: string
  }
}

// ============================================================================
// Reverse Geocode
// ============================================================================

export interface GoogleMapsReverseGeocodeParams {
  apiKey: string
  lat: number
  lng: number
  language?: string
}

export interface GoogleMapsReverseGeocodeResponse extends ToolResponse {
  output: {
    formattedAddress: string
    placeId: string
    addressComponents: AddressComponent[]
    types: string[]
  }
}

// ============================================================================
// Directions
// ============================================================================

export interface DirectionsStep {
  instruction: string
  distanceText: string
  distanceMeters: number
  durationText: string
  durationSeconds: number
  startLocation: LatLng
  endLocation: LatLng
  travelMode: string
  maneuver: string | null
}

export interface DirectionsLeg {
  startAddress: string
  endAddress: string
  startLocation: LatLng
  endLocation: LatLng
  distanceText: string
  distanceMeters: number
  durationText: string
  durationSeconds: number
  steps: DirectionsStep[]
}

export interface DirectionsRoute {
  summary: string
  legs: DirectionsLeg[]
  overviewPolyline: string
  warnings: string[]
  waypointOrder: number[]
}

export interface GoogleMapsDirectionsParams {
  apiKey: string
  origin: string
  destination: string
  mode?: 'driving' | 'walking' | 'bicycling' | 'transit'
  avoid?: string
  waypoints?: string[]
  units?: 'metric' | 'imperial'
  language?: string
}

export interface GoogleMapsDirectionsResponse extends ToolResponse {
  output: {
    routes: DirectionsRoute[]
    distanceText: string
    distanceMeters: number
    durationText: string
    durationSeconds: number
    startAddress: string
    endAddress: string
    steps: DirectionsStep[]
    polyline: string
  }
}

// ============================================================================
// Distance Matrix
// ============================================================================

export interface DistanceMatrixElement {
  distanceText: string
  distanceMeters: number
  durationText: string
  durationSeconds: number
  durationInTrafficText: string | null
  durationInTrafficSeconds: number | null
  status: string
}

export interface DistanceMatrixRow {
  elements: DistanceMatrixElement[]
}

export interface GoogleMapsDistanceMatrixParams {
  apiKey: string
  origin: string
  destinations: string[]
  mode?: 'driving' | 'walking' | 'bicycling' | 'transit'
  avoid?: string
  units?: 'metric' | 'imperial'
  language?: string
}

export interface GoogleMapsDistanceMatrixResponse extends ToolResponse {
  output: {
    originAddresses: string[]
    destinationAddresses: string[]
    rows: DistanceMatrixRow[]
  }
}

// ============================================================================
// Places Search
// ============================================================================

export interface PlaceResult {
  placeId: string
  name: string
  formattedAddress: string
  lat: number
  lng: number
  types: string[]
  rating: number | null
  userRatingsTotal: number | null
  priceLevel: number | null
  openNow: boolean | null
  photoReference: string | null
  businessStatus: string | null
}

export interface GoogleMapsPlacesSearchParams {
  apiKey: string
  query: string
  location?: LatLng
  radius?: number
  type?: string
  language?: string
  region?: string
}

export interface GoogleMapsPlacesSearchResponse extends ToolResponse {
  output: {
    places: PlaceResult[]
    nextPageToken: string | null
  }
}

// ============================================================================
// Place Details
// ============================================================================

export interface PlaceReview {
  authorName: string
  authorUrl: string | null
  profilePhotoUrl: string | null
  rating: number
  text: string
  time: number
  relativeTimeDescription: string
}

export interface PlacePhoto {
  photoReference: string
  height: number
  width: number
  htmlAttributions: string[]
}

export interface GoogleMapsPlaceDetailsParams {
  apiKey: string
  placeId: string
  fields?: string
  language?: string
}

export interface GoogleMapsPlaceDetailsResponse extends ToolResponse {
  output: {
    placeId: string
    name: string | null
    formattedAddress: string | null
    lat: number | null
    lng: number | null
    types: string[]
    rating: number | null
    userRatingsTotal: number | null
    priceLevel: number | null
    website: string | null
    phoneNumber: string | null
    internationalPhoneNumber: string | null
    openNow: boolean | null
    weekdayText: string[]
    reviews: PlaceReview[]
    photos: PlacePhoto[]
    url: string | null
    utcOffset: number | null
    vicinity: string | null
    businessStatus: string | null
  }
}

// ============================================================================
// Elevation
// ============================================================================

export interface GoogleMapsElevationParams {
  apiKey: string
  lat: number
  lng: number
}

export interface GoogleMapsElevationResponse extends ToolResponse {
  output: {
    elevation: number
    lat: number
    lng: number
    resolution: number
  }
}

// ============================================================================
// Timezone
// ============================================================================

export interface GoogleMapsTimezoneParams {
  apiKey: string
  lat: number
  lng: number
  timestamp?: number
  language?: string
}

export interface GoogleMapsTimezoneResponse extends ToolResponse {
  output: {
    timeZoneId: string
    timeZoneName: string
    rawOffset: number
    dstOffset: number
    totalOffsetSeconds: number
    totalOffsetHours: number
  }
}

// ============================================================================
// Snap to Roads
// ============================================================================

export interface GoogleMapsSnapToRoadsParams {
  apiKey: string
  path: string
  interpolate?: boolean
}

export interface GoogleMapsSnapToRoadsResponse extends ToolResponse {
  output: {
    snappedPoints: SnappedPoint[]
    warningMessage: string | null
  }
}

// ============================================================================
// Speed Limits
// ============================================================================

export interface GoogleMapsSpeedLimitsParams {
  apiKey: string
  path?: string
  placeIds?: string[]
}

export interface GoogleMapsSpeedLimitsResponse extends ToolResponse {
  output: {
    speedLimits: SpeedLimit[]
    snappedPoints: SnappedPoint[]
  }
}

// ============================================================================
// Validate Address
// ============================================================================

export interface GoogleMapsValidateAddressParams {
  apiKey: string
  address: string
  regionCode?: string
  locality?: string
  enableUspsCass?: boolean
}

export interface GoogleMapsValidateAddressResponse extends ToolResponse {
  output: {
    formattedAddress: string
    lat: number
    lng: number
    placeId: string
    addressComplete: boolean
    hasUnconfirmedComponents: boolean
    hasInferredComponents: boolean
    hasReplacedComponents: boolean
    validationGranularity: string
    geocodeGranularity: string
    addressComponents: AddressComponent[]
    missingComponentTypes: string[]
    unconfirmedComponentTypes: string[]
    unresolvedTokens: string[]
  }
}

// ============================================================================
// Geolocate
// ============================================================================

export interface GoogleMapsGeolocateParams {
  apiKey: string
  homeMobileCountryCode?: number
  homeMobileNetworkCode?: number
  radioType?: 'lte' | 'gsm' | 'cdma' | 'wcdma' | 'nr'
  carrier?: string
  considerIp?: boolean
  cellTowers?: CellTower[]
  wifiAccessPoints?: WifiAccessPoint[]
}

export interface GoogleMapsGeolocateResponse extends ToolResponse {
  output: {
    lat: number
    lng: number
    accuracy: number
  }
}

// ============================================================================
// Air Quality
// ============================================================================

export interface GoogleMapsAirQualityParams {
  apiKey: string
  lat: number
  lng: number
  languageCode?: string
}

export interface GoogleMapsAirQualityResponse extends ToolResponse {
  output: {
    dateTime: string
    regionCode: string
    indexes: AirQualityIndex[]
    pollutants: Pollutant[]
    healthRecommendations: {
      generalPopulation: string
      elderly: string
      lungDiseasePopulation: string
      heartDiseasePopulation: string
      athletes: string
      pregnantWomen: string
      children: string
    } | null
  }
}
