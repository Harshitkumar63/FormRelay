import Dexie, { type Table } from 'dexie'
import type { LocalDraftRecord, SyncQueueItem, RecoveryAuditItem } from './types'

export class FormRelayDatabase extends Dexie {
  drafts!: Table<LocalDraftRecord, string>
  syncQueue!: Table<SyncQueueItem, number>
  auditLog!: Table<RecoveryAuditItem, number>

  constructor() {
    super('FormRelayDB')
    this.version(1).stores({
      drafts: 'id, formId, schemaVersion, syncStatus, lastSavedAt',
      syncQueue: '++id, draftId, action, createdAt',
      auditLog: '++id, timestamp, eventType, draftId',
    })
  }
}

export const db = new FormRelayDatabase()

export async function logLocalAudit(
  eventType: RecoveryAuditItem['eventType'],
  details: string,
  draftId?: string
): Promise<void> {
  try {
    await db.auditLog.add({
      timestamp: new Date().toISOString(),
      eventType,
      details,
      draftId,
    })
  } catch (err) {
    console.warn('FormRelay: Failed to write audit event', err)
  }
}
