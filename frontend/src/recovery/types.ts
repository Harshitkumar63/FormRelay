/**
 * FormRelay Recovery Engine Type Definitions
 */

export type SyncStatus =
  | 'idle'
  | 'saving_local'
  | 'saved_local'
  | 'syncing'
  | 'synced'
  | 'conflict'
  | 'error'

export type NetworkStatus = 'online' | 'offline' | 'degraded'

export interface FieldReport {
  path: string
  status: 'added' | 'removed' | 'preserved' | 'modified'
  old_value?: unknown
  new_value?: unknown
  message: string
}

export interface ConflictFieldDetail {
  path: string
  baseValue: unknown
  localValue: unknown
  serverValue: unknown
}

export interface ConflictDetail {
  draftId: string
  serverRevision: number
  clientBaseRevision: number
  clientLocalRevision: number
  serverData: Record<string, unknown>
  clientData: Record<string, unknown>
  conflictingFields: string[]
  fieldDetails: ConflictFieldDetail[]
}

export interface LocalDraftRecord {
  id: string // Draft ID (UUID)
  formId: string
  schemaVersion: number
  localRevision: number
  baseRevision: number
  serverRevision: number
  data: Record<string, unknown>
  status: 'draft' | 'submitted' | 'conflict'
  syncStatus: SyncStatus
  lastSavedAt: string
  lastSyncedAt?: string
  lastSyncError?: string
  idempotencyKey: string
  isDirty: boolean
}

export interface SyncQueueItem {
  id?: number
  draftId: string
  action: 'save' | 'sync' | 'submit'
  payload: Record<string, unknown>
  createdAt: string
  attempts: number
  lastError?: string
}

export interface RecoveryAuditItem {
  id?: number
  timestamp: string
  eventType:
    | 'checkpoint_saved'
    | 'sync_started'
    | 'sync_succeeded'
    | 'sync_failed'
    | 'conflict_detected'
    | 'conflict_resolved'
    | 'schema_migrated'
    | 'draft_cleared'
    | 'submission_created'
    | 'network_status_changed'
  details: string
  draftId?: string
}

export interface ScholarshipFormData {
  personal: {
    first_name: string
    last_name: string
    date_of_birth: string
    gender: string
    nationality: string
  }
  academic: {
    institution: string
    degree_program: string
    gpa: string
    gpa_scale: string
    major: string
    minor: string
    enrollment_year: string
    expected_graduation: string
  }
  contact: {
    email: string
    phone: string
    address_line1: string
    address_line2: string
    city: string
    state: string
    postal_code: string
    country: string
  }
  documents: {
    transcript_available: boolean
    recommendation_letters_count: number
    personal_statement_words: number
    portfolio_url: string
    resume_available: boolean
    additional_documents_description: string
  }
}

export interface SubmissionResult {
  id: string
  draftId: string
  idempotencyKey: string
  schemaVersion: number
  data: Record<string, unknown>
  status: 'accepted'
  receiptId: string
  createdAt: string
}
