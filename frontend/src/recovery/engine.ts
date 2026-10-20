/**
 * FormRelay Reusable Recovery Engine
 * Handles debounced local checkpointing, online/offline detection, background sync,
 * optimistic concurrency tracking, conflict handling, and idempotency key persistence.
 */

import { apiClient } from '../api/client'
import { db, logLocalAudit } from './db'
import { analyze3WayMerge } from './diff'
import type {
  ConflictDetail,
  LocalDraftRecord,
  NetworkStatus,
} from './types'

export type EngineListener = (draft: LocalDraftRecord | null, engine: FormRelayEngine) => void

export class FormRelayEngine {
  private currentDraft: LocalDraftRecord | null = null
  private debounceTimer: any = null
  private healthCheckTimer: any = null
  private listeners: Set<EngineListener> = new Set()
  private networkStatus: NetworkStatus = navigator.onLine ? 'online' : 'offline'
  private activeConflict: ConflictDetail | null = null
  private isSyncing = false

  constructor() {
    this.initNetworkListeners()
    this.startPeriodicHealthCheck()
  }

  // --- Listener subscription ---
  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener)
    listener(this.currentDraft, this)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.currentDraft, this)
    }
  }

  getDraft(): LocalDraftRecord | null {
    return this.currentDraft
  }

  getNetworkStatus(): NetworkStatus {
    return this.networkStatus
  }

  getActiveConflict(): ConflictDetail | null {
    return this.activeConflict
  }

  // --- Network detection ---
  private initNetworkListeners(): void {
    window.addEventListener('online', () => {
      this.verifyRealConnectivity()
    })
    window.addEventListener('offline', () => {
      this.updateNetworkStatus('offline')
    })
  }

  private startPeriodicHealthCheck(): void {
    this.healthCheckTimer = setInterval(() => {
      this.verifyRealConnectivity()
    }, 15000)
  }

  async verifyRealConnectivity(): Promise<boolean> {
    try {
      await apiClient.checkHealth()
      this.updateNetworkStatus('online')
      // If we have an unsynced dirty draft, auto-sync upon returning online
      if (
        this.currentDraft &&
        (this.currentDraft.isDirty || this.currentDraft.syncStatus === 'saved_local' || this.currentDraft.syncStatus === 'error') &&
        this.currentDraft.syncStatus !== 'conflict'
      ) {
        this.syncWithBackend().catch((err) => {
          console.warn('Auto-sync failed on reconnect:', err)
        })
      }
      return true
    } catch {
      this.updateNetworkStatus('offline')
      return false
    }
  }

  private updateNetworkStatus(status: NetworkStatus): void {
    if (this.networkStatus !== status) {
      this.networkStatus = status
      logLocalAudit('network_status_changed', `Network changed to ${status}`, this.currentDraft?.id)
      this.notify()
    }
  }

  // --- Draft Initialization / Recovery ---
  /**
   * Load existing draft from local IndexedDB or initialize a new one.
   */
  async loadOrCreateDraft(
    formId: string,
    schemaVersion: number,
    initialData: Record<string, unknown>
  ): Promise<LocalDraftRecord> {
    // 1. Check local IndexedDB for this form
    const local = await db.drafts.where('formId').equals(formId).first()
    if (local && local.status !== 'submitted') {
      this.currentDraft = local
      logLocalAudit('checkpoint_saved', `Loaded draft from local storage (rev ${local.localRevision})`, local.id)
      this.notify()
      // Try to fetch latest server revision if online
      if (this.networkStatus === 'online') {
        this.syncWithBackend().catch((e) => console.warn('Background sync on load:', e))
      }
      return local
    }

    // 2. Create new local draft
    const newDraft: LocalDraftRecord = {
      id: crypto.randomUUID(),
      formId,
      schemaVersion,
      localRevision: 1,
      baseRevision: 1,
      serverRevision: 1,
      data: initialData,
      status: 'draft',
      syncStatus: 'idle',
      lastSavedAt: new Date().toISOString(),
      idempotencyKey: `idem_${crypto.randomUUID().replace(/-/g, '')}`,
      isDirty: false,
    }

    await db.drafts.put(newDraft)
    this.currentDraft = newDraft
    logLocalAudit('checkpoint_saved', 'Initialized fresh draft locally', newDraft.id)
    this.notify()

    // 3. Register draft on backend if online
    if (this.networkStatus === 'online') {
      try {
        const remote = await apiClient.createDraft(formId, schemaVersion, initialData, newDraft.id)
        newDraft.id = remote.id
        newDraft.serverRevision = remote.revision
        newDraft.baseRevision = remote.revision
        newDraft.localRevision = remote.revision
        newDraft.syncStatus = 'synced'
        newDraft.lastSyncedAt = new Date().toISOString()
        await db.drafts.put(newDraft)
        this.currentDraft = newDraft
        logLocalAudit('sync_succeeded', `Created draft on server with ID ${remote.id}`, remote.id)
        this.notify()
      } catch (err: any) {
        console.warn('Initial server registration deferred (offline):', err.message)
      }
    }

    return this.currentDraft!
  }

  // --- Local Checkpointing with Debounce ---
  /**
   * Called on every field change. Debounces local write to avoid disk thrashing.
   */
  queueCheckpoint(updatedData: Record<string, unknown>, debounceMs = 400): void {
    if (!this.currentDraft) return

    this.currentDraft.data = updatedData
    this.currentDraft.isDirty = true
    this.currentDraft.syncStatus = 'saving_local'
    this.notify()

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      this.commitCheckpointNow()
    }, debounceMs)
  }

  /**
   * Immediately flush checkpoint to IndexedDB.
   */
  async commitCheckpointNow(): Promise<void> {
    if (!this.currentDraft) return
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }

    try {
      this.currentDraft.localRevision += 1
      this.currentDraft.lastSavedAt = new Date().toISOString()
      this.currentDraft.syncStatus = 'saved_local'
      await db.drafts.put(this.currentDraft)
      logLocalAudit(
        'checkpoint_saved',
        `Checkpoint v${this.currentDraft.localRevision} saved to IndexedDB`,
        this.currentDraft.id
      )
      this.notify()

      // Trigger background sync if online
      if (this.networkStatus === 'online' && !this.isSyncing) {
        this.syncWithBackend().catch((e) => {
          console.warn('Background sync failed:', e)
        })
      }
    } catch (err: any) {
      console.error('IndexedDB save failed:', err)
      this.currentDraft.syncStatus = 'error'
      this.currentDraft.lastSyncError = `Local storage write error: ${err.message}`
      this.notify()
    }
  }

  // --- Synchronization ---
  /**
   * Synchronize local draft with backend. Handles fast-forward, auto-merge, and conflicts.
   */
  async syncWithBackend(): Promise<void> {
    if (!this.currentDraft || this.isSyncing) return
    if (this.currentDraft.status === 'submitted') return

    this.isSyncing = true
    this.currentDraft.syncStatus = 'syncing'
    this.notify()
    logLocalAudit('sync_started', 'Sync with backend started', this.currentDraft.id)

    try {
      // If the draft was created offline and never registered on server, register it now
      if (!this.currentDraft.lastSyncedAt) {
        try {
          const remote = await apiClient.createDraft(
            this.currentDraft.formId,
            this.currentDraft.schemaVersion,
            this.currentDraft.data,
            this.currentDraft.id
          )
          this.currentDraft.serverRevision = remote.revision
          this.currentDraft.baseRevision = remote.revision
          this.currentDraft.localRevision = remote.revision
          this.currentDraft.syncStatus = 'synced'
          this.currentDraft.isDirty = false
          this.currentDraft.lastSyncedAt = new Date().toISOString()
          this.currentDraft.lastSyncError = undefined
          await db.drafts.put(this.currentDraft)
          await db.syncQueue.where('draftId').equals(this.currentDraft.id).delete()
          logLocalAudit('sync_succeeded', `Registered offline draft on server (ID ${remote.id})`, remote.id)
          this.notify()
          return
        } catch (regErr: any) {
          if (regErr.status !== 409) {
            this.currentDraft.syncStatus = 'error'
            this.currentDraft.lastSyncError = regErr.message || 'Offline draft registration failed'
            await db.drafts.put(this.currentDraft)
            this.notify()
            return
          }
        }
      }

      const syncResult = await apiClient.syncDraft(
        this.currentDraft.id,
        this.currentDraft.data,
        this.currentDraft.localRevision,
        this.currentDraft.baseRevision,
        this.currentDraft.schemaVersion
      )

      if (syncResult.status === 'synced') {
        this.currentDraft.serverRevision = syncResult.server_revision
        this.currentDraft.baseRevision = syncResult.server_revision
        this.currentDraft.localRevision = syncResult.server_revision
        this.currentDraft.data = syncResult.server_data
        this.currentDraft.syncStatus = 'synced'
        this.currentDraft.isDirty = false
        this.currentDraft.lastSyncedAt = new Date().toISOString()
        this.currentDraft.lastSyncError = undefined
        this.activeConflict = null

        await db.drafts.put(this.currentDraft)
        await db.syncQueue.where('draftId').equals(this.currentDraft.id).delete()
        logLocalAudit(
          'sync_succeeded',
          `Successfully synced to server rev ${syncResult.server_revision}`,
          this.currentDraft.id
        )
      }
    } catch (err: any) {
      if (err.status === 404) {
        // Draft not found on server — attempt offline registration recovery
        try {
          const remote = await apiClient.createDraft(
            this.currentDraft.formId,
            this.currentDraft.schemaVersion,
            this.currentDraft.data,
            this.currentDraft.id
          )
          this.currentDraft.serverRevision = remote.revision
          this.currentDraft.baseRevision = remote.revision
          this.currentDraft.localRevision = remote.revision
          this.currentDraft.syncStatus = 'synced'
          this.currentDraft.isDirty = false
          this.currentDraft.lastSyncedAt = new Date().toISOString()
          this.currentDraft.lastSyncError = undefined
          await db.drafts.put(this.currentDraft)
          await db.syncQueue.where('draftId').equals(this.currentDraft.id).delete()
          logLocalAudit('sync_succeeded', `Recovered missing server draft (ID ${remote.id})`, remote.id)
          this.notify()
          return
        } catch (regErr: any) {
          this.currentDraft.syncStatus = 'error'
          this.currentDraft.lastSyncError = regErr.message || 'Draft registration failed'
          await db.drafts.put(this.currentDraft)
        }
      } else if (err.status === 409 && err.detail?.status === 'conflict') {
        // Revision Conflict!
        const detail = err.detail
        const analysis = analyze3WayMerge(
          this.currentDraft.data, // client base representation
          this.currentDraft.data,
          detail.server_data || {}
        )

        this.activeConflict = {
          draftId: this.currentDraft.id,
          serverRevision: detail.server_revision,
          clientBaseRevision: detail.base_revision,
          clientLocalRevision: this.currentDraft.localRevision,
          serverData: detail.server_data,
          clientData: this.currentDraft.data,
          conflictingFields: detail.conflicting_fields || [],
          fieldDetails: analysis.fieldDetails.map((f) => ({
            path: f.path,
            baseValue: f.baseValue,
            localValue: f.localValue,
            serverValue: f.serverValue,
          })),
        }

        this.currentDraft.syncStatus = 'conflict'
        this.currentDraft.status = 'conflict'
        await db.drafts.put(this.currentDraft)
        logLocalAudit(
          'conflict_detected',
          `Conflict detected with server rev ${detail.server_revision}. Conflicting fields: ${(detail.conflicting_fields || []).join(', ')}`,
          this.currentDraft.id
        )
      } else {
        this.currentDraft.syncStatus = 'error'
        this.currentDraft.lastSyncError = err.message || 'Sync failed'
        await db.drafts.put(this.currentDraft)
        logLocalAudit('sync_failed', `Sync failed: ${err.message}`, this.currentDraft.id)
      }
    } finally {
      this.isSyncing = false
      this.notify()
    }
  }

  // --- Conflict Resolution ---
  /**
   * Submit resolved draft to server and update local storage.
   */
  async resolveActiveConflict(
    resolvedData: Record<string, unknown>,
    strategy = 'manual_merge'
  ): Promise<void> {
    if (!this.currentDraft || !this.activeConflict) return

    try {
      const resp = await apiClient.resolveConflict(
        this.currentDraft.id,
        strategy,
        resolvedData,
        this.activeConflict.serverRevision,
        this.currentDraft.schemaVersion,
        this.activeConflict.clientBaseRevision
      )

      this.currentDraft.data = resp.data
      this.currentDraft.baseRevision = resp.revision
      this.currentDraft.localRevision = resp.revision
      this.currentDraft.serverRevision = resp.revision
      this.currentDraft.syncStatus = 'synced'
      this.currentDraft.status = 'draft'
      this.currentDraft.isDirty = false
      this.currentDraft.lastSyncedAt = new Date().toISOString()
      this.activeConflict = null

      await db.drafts.put(this.currentDraft)
      logLocalAudit(
        'conflict_resolved',
        `Conflict resolved via strategy '${strategy}', new rev ${resp.revision}`,
        this.currentDraft.id
      )
      this.notify()
    } catch (err: any) {
      console.error('Failed to resolve conflict:', err)
      throw err
    }
  }

  // --- Schema Migration ---
  async migrateCurrentDraft(toVersion: number): Promise<any> {
    if (!this.currentDraft) return

    if (this.networkStatus === 'online' && this.currentDraft.lastSyncedAt) {
      try {
        const resp = await apiClient.migratePersistedDraft(this.currentDraft.id, toVersion)
        this.currentDraft.schemaVersion = resp.schema_version
        this.currentDraft.data = resp.data
        this.currentDraft.localRevision = resp.revision
        this.currentDraft.baseRevision = resp.revision
        this.currentDraft.serverRevision = resp.revision
        this.currentDraft.isDirty = false
        this.currentDraft.syncStatus = 'synced'
        this.currentDraft.lastSyncedAt = new Date().toISOString()
        await db.drafts.put(this.currentDraft)
        logLocalAudit('schema_migrated', `Migrated draft to v${toVersion} on server`, this.currentDraft.id)
        this.notify()
        return resp
      } catch (e) {
        console.warn('Server draft migration failed, falling back to local migration:', e)
      }
    }

    const migration = await apiClient.migrateSchema(
      this.currentDraft.data,
      this.currentDraft.schemaVersion,
      toVersion
    )

    this.currentDraft.schemaVersion = toVersion
    this.currentDraft.data = migration.migrated_data
    this.currentDraft.isDirty = true
    this.currentDraft.localRevision += 1
    await db.drafts.put(this.currentDraft)

    logLocalAudit(
      'schema_migrated',
      `Migrated draft from v${migration.from_version} to v${toVersion}`,
      this.currentDraft.id
    )
    this.notify()

    // Sync migrated draft if online
    if (this.networkStatus === 'online') {
      await this.syncWithBackend()
    }

    return migration
  }

  // --- Submission ---
  /**
   * Final submission with idempotency key enforcement.
   */
  async submitCurrentDraft(): Promise<any> {
    if (!this.currentDraft) throw new Error('No active draft')

    // Commit any pending local changes first
    await this.commitCheckpointNow()

    logLocalAudit(
      'submission_created',
      `Submitting draft with idempotency key ${this.currentDraft.idempotencyKey}`,
      this.currentDraft.id
    )

    const result = await apiClient.createSubmission(
      this.currentDraft.id,
      this.currentDraft.idempotencyKey,
      this.currentDraft.schemaVersion,
      this.currentDraft.data
    )

    this.currentDraft.status = 'submitted'
    this.currentDraft.syncStatus = 'synced'
    await db.drafts.put(this.currentDraft)
    this.notify()

    return result
  }

  // --- Clear Draft ---
  /**
   * Delete draft with deliberate confirmation.
   */
  async clearDraft(): Promise<void> {
    if (!this.currentDraft) return

    const draftId = this.currentDraft.id
    await db.drafts.delete(draftId)
    logLocalAudit('draft_cleared', `Draft ${draftId} deliberately cleared by user`, draftId)
    this.currentDraft = null
    this.activeConflict = null
    this.notify()
  }

  destroy(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer)
    this.listeners.clear()
  }
}

export const recoveryEngine = new FormRelayEngine()
