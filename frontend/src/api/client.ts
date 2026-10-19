/**
 * FormRelay API Client
 * Manages HTTP communication with the FastAPI backend, authentication tokens,
 * correlation IDs, exponential backoff, and failure-injection flags.
 */

import type {
  FieldReport,
  SubmissionResult,
} from '../recovery/types'

export interface ApiDraftResponse {
  id: string
  form_id: string
  schema_version: number
  revision: number
  data: Record<string, unknown>
  status: 'draft' | 'submitted' | 'conflict'
  created_at: string
  updated_at: string
}

export interface ApiSyncResponse {
  status: 'synced' | 'conflict'
  server_revision: number
  server_data: Record<string, unknown>
  conflicting_fields?: string[]
  message: string
}

export interface ApiMigrationResponse {
  from_version: number
  to_version: number
  migrated_data: Record<string, unknown>
  field_reports: FieldReport[]
  message: string
}

export interface ApiMetricsResponse {
  total_drafts: number
  active_drafts: number
  submitted_drafts: number
  conflicted_drafts: number
  total_submissions: number
  total_audit_events: number
  schema_versions: Record<number, number>
}

// Failure-injection flags for developer testing
export interface FailureSimulationConfig {
  simulateOffline: boolean
  simulateTimeout: boolean
  simulateServer500: boolean
  simulateValidationError: boolean
  simulateService503: boolean
  networkDelayMs: number
}

class FormRelayApiClient {
  private baseUrl = ''
  private simulation: FailureSimulationConfig = {
    simulateOffline: false,
    simulateTimeout: false,
    simulateServer500: false,
    simulateValidationError: false,
    simulateService503: false,
    networkDelayMs: 0,
  }

  getSimulationConfig(): FailureSimulationConfig {
    return { ...this.simulation }
  }

  setSimulationConfig(config: Partial<FailureSimulationConfig>): void {
    this.simulation = { ...this.simulation, ...config }
  }

  resetSimulation(): void {
    this.simulation = {
      simulateOffline: false,
      simulateTimeout: false,
      simulateServer500: false,
      simulateValidationError: false,
      simulateService503: false,
      networkDelayMs: 0,
    }
  }

  /**
   * Get or generate the client's persistent owner token.
   */
  getOwnerToken(): string {
    const key = 'formrelay_owner_token'
    let token = localStorage.getItem(key)
    if (!token) {
      token = `usr_${crypto.randomUUID().replace(/-/g, '')}`
      localStorage.setItem(key, token)
    }
    return token
  }

  setCustomOwnerToken(token: string): void {
    localStorage.setItem('formrelay_owner_token', token)
  }

  private generateCorrelationId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retries = 2
  ): Promise<T> {
    // 1. Failure-injection checks
    if (this.simulation.simulateOffline) {
      throw new TypeError('Failed to fetch (simulated network offline)')
    }

    if (this.simulation.networkDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.simulation.networkDelayMs))
    }

    if (this.simulation.simulateTimeout) {
      throw new DOMException('The user aborted a request.', 'TimeoutError')
    }

    if (this.simulation.simulateServer500) {
      throw new Error('500 Internal Server Error (simulated)')
    }

    if (this.simulation.simulateService503) {
      throw new Error('503 Service Unavailable (simulated server restart)')
    }

    const headers = new Headers(options.headers || {})
    headers.set('X-Owner-Token', this.getOwnerToken())
    headers.set('X-Correlation-ID', this.generateCorrelationId())
    if (!headers.has('Content-Type') && options.body) {
      headers.set('Content-Type', 'application/json')
    }

    const url = `${this.baseUrl}${endpoint}`

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers,
        })

        // Check for conflict or validation error before generic error
        if (response.status === 409) {
          const body = await response.json().catch(() => ({}))
          const error: any = new Error(body.detail?.message || 'Conflict detected')
          error.status = 409
          error.detail = body.detail || body
          throw error
        }

        if (response.status === 422) {
          const body = await response.json().catch(() => ({}))
          const error: any = new Error(body.detail || 'Validation failed')
          error.status = 422
          error.detail = body
          throw error
        }

        if (!response.ok) {
          const errorText = await response.text()
          const error: any = new Error(
            `Request failed with status ${response.status}: ${errorText}`
          )
          error.status = response.status
          throw error
        }

        return (await response.json()) as T
      } catch (err: any) {
        const isTransient =
          err instanceof TypeError || // Network error
          err.name === 'TimeoutError' ||
          err.status === 502 ||
          err.status === 503 ||
          err.status === 504

        if (isTransient && attempt < retries) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 4000)
          await new Promise((resolve) => setTimeout(resolve, backoff))
          continue
        }
        throw err
      }
    }

    throw new Error('Request retries exhausted')
  }

  // --- Health Endpoints ---
  async checkHealth(): Promise<{ status: string; timestamp: string }> {
    return this.request<{ status: string; timestamp: string }>('/health', {}, 0)
  }

  async checkReady(): Promise<{ status: string; database: string }> {
    return this.request<{ status: string; database: string }>('/ready', {}, 0)
  }

  // --- Draft API ---
  async createDraft(
    formId: string,
    schemaVersion: number,
    data: Record<string, unknown>
  ): Promise<ApiDraftResponse> {
    return this.request<ApiDraftResponse>('/api/drafts', {
      method: 'POST',
      body: JSON.stringify({
        form_id: formId,
        schema_version: schemaVersion,
        data,
      }),
    })
  }

  async getDraft(draftId: string): Promise<ApiDraftResponse> {
    return this.request<ApiDraftResponse>(`/api/drafts/${draftId}`)
  }

  async updateDraft(
    draftId: string,
    data: Record<string, unknown>,
    expectedRevision: number,
    schemaVersion: number
  ): Promise<ApiDraftResponse> {
    return this.request<ApiDraftResponse>(`/api/drafts/${draftId}`, {
      method: 'PUT',
      body: JSON.stringify({
        data,
        expected_revision: expectedRevision,
        schema_version: schemaVersion,
      }),
    })
  }

  async syncDraft(
    draftId: string,
    data: Record<string, unknown>,
    localRevision: number,
    baseRevision: number,
    schemaVersion: number
  ): Promise<ApiSyncResponse> {
    return this.request<ApiSyncResponse>(`/api/drafts/${draftId}/sync`, {
      method: 'POST',
      body: JSON.stringify({
        data,
        local_revision: localRevision,
        base_revision: baseRevision,
        schema_version: schemaVersion,
      }),
    })
  }

  async resolveConflict(
    draftId: string,
    resolutionStrategy: string,
    resolvedData: Record<string, unknown>,
    targetRevision: number,
    schemaVersion: number
  ): Promise<ApiDraftResponse> {
    return this.request<ApiDraftResponse>(`/api/drafts/${draftId}/resolve-conflict`, {
      method: 'POST',
      body: JSON.stringify({
        resolution_strategy: resolutionStrategy,
        resolved_data: resolvedData,
        target_revision: targetRevision,
        schema_version: schemaVersion,
      }),
    })
  }

  async getRevisions(draftId: string): Promise<any[]> {
    return this.request<any[]>(`/api/drafts/${draftId}/revisions`)
  }

  // --- Schema Migration API ---
  async migrateSchema(
    data: Record<string, unknown>,
    fromVersion: number,
    toVersion: number
  ): Promise<ApiMigrationResponse> {
    return this.request<ApiMigrationResponse>('/api/schema/migrate', {
      method: 'POST',
      body: JSON.stringify({
        data,
        from_version: fromVersion,
        to_version: toVersion,
      }),
    })
  }

  // --- Submission API ---
  async createSubmission(
    draftId: string,
    idempotencyKey: string,
    schemaVersion: number,
    data: Record<string, unknown>
  ): Promise<SubmissionResult> {
    const raw = await this.request<any>('/api/submissions', {
      method: 'POST',
      body: JSON.stringify({
        draft_id: draftId,
        idempotency_key: idempotencyKey,
        schema_version: schemaVersion,
        data,
      }),
    })
    return {
      id: raw.id,
      draftId: raw.draft_id,
      idempotencyKey: raw.idempotency_key,
      schemaVersion: raw.schema_version,
      data: raw.data,
      status: raw.status,
      receiptId: raw.receipt_id,
      createdAt: raw.created_at,
    }
  }

  async getSubmissionById(submissionId: string): Promise<SubmissionResult> {
    const raw = await this.request<any>(`/api/submissions/${submissionId}`)
    return {
      id: raw.id,
      draftId: raw.draft_id,
      idempotencyKey: raw.idempotency_key,
      schemaVersion: raw.schema_version,
      data: raw.data,
      status: raw.status,
      receiptId: raw.receipt_id,
      createdAt: raw.created_at,
    }
  }

  async getSubmissionByKey(idempotencyKey: string): Promise<SubmissionResult> {
    const raw = await this.request<any>(
      `/api/submissions/by-idempotency-key/${encodeURIComponent(idempotencyKey)}`
    )
    return {
      id: raw.id,
      draftId: raw.draft_id,
      idempotencyKey: raw.idempotency_key,
      schemaVersion: raw.schema_version,
      data: raw.data,
      status: raw.status,
      receiptId: raw.receipt_id,
      createdAt: raw.created_at,
    }
  }

  // --- Metrics API ---
  async getMetrics(): Promise<ApiMetricsResponse> {
    return this.request<ApiMetricsResponse>('/api/metrics')
  }
}

export const apiClient = new FormRelayApiClient()
