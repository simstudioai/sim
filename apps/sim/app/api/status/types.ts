export interface IncidentIOComponent {
  id: string
  name: string
  group_name?: string
  current_status: 'operational' | 'degraded_performance' | 'partial_outage' | 'full_outage'
}

export interface IncidentIOIncident {
  id: string
  name: string
  status: 'investigating' | 'identified' | 'monitoring'
  url: string
  last_update_at: string
  last_update_message: string
  current_worst_impact: 'degraded_performance' | 'partial_outage' | 'full_outage'
  affected_components: IncidentIOComponent[]
}

export interface IncidentIOMaintenance {
  id: string
  name: string
  status: 'maintenance_scheduled' | 'maintenance_in_progress'
  url: string
  last_update_at: string
  last_update_message: string
  affected_components: IncidentIOComponent[]
  started_at?: string
  scheduled_end_at?: string
  starts_at?: string
  ends_at?: string
}

export interface IncidentIOWidgetResponse {
  page_title: string
  page_url: string
  ongoing_incidents: IncidentIOIncident[]
  in_progress_maintenances: IncidentIOMaintenance[]
  scheduled_maintenances: IncidentIOMaintenance[]
}

export type StatusType = 'operational' | 'degraded' | 'outage' | 'maintenance' | 'loading' | 'error'

export interface StatusResponse {
  status: StatusType
  message: string
  url: string
  lastUpdated: string
}
