import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../recovery/db'
import { FormRelayEngine } from '../recovery/engine'
import {
  analyze3WayMerge,
  applyResolutions,
  flattenObject,
  unflattenObject,
  areValuesEqual,
} from '../recovery/diff'
import { DEFAULT_V2_SCHOLARSHIP_DATA, SAMPLE_POPULATED_SCHOLARSHIP } from '../recovery/defaults'

describe('FormRelay Diff & 3-Way Merge Engine', () => {
  it('correctly flattens and unflattens nested objects', () => {
    const original = {
      personal: { first_name: 'Elena', last_name: 'Rostova' },
      academic: { gpa: '3.92', gpa_scale: '4.0' },
    }
    const flat = flattenObject(original)
    expect(flat['personal.first_name']).toBe('Elena')
    expect(flat['academic.gpa']).toBe('3.92')

    const roundtrip = unflattenObject(flat)
    expect(roundtrip).toEqual(original)
  })

  it('detects no conflicts when only local client changes a field (fast-forward)', () => {
    const base = { personal: { first_name: 'Elena', last_name: 'Rostova' } }
    const local = { personal: { first_name: 'Elena-Updated', last_name: 'Rostova' } }
    const server = { personal: { first_name: 'Elena', last_name: 'Rostova' } }

    const analysis = analyze3WayMerge(base, local, server)
    expect(analysis.canAutoMerge).toBe(true)
    expect(analysis.conflictingFields).toHaveLength(0)
    expect((analysis.mergedData as any).personal.first_name).toBe('Elena-Updated')
  })

  it('automatically merges when client and server change DIFFERENT fields', () => {
    const base = { personal: { first_name: 'Elena', last_name: 'Rostova' } }
    const local = { personal: { first_name: 'Elena-Local', last_name: 'Rostova' } }
    const server = { personal: { first_name: 'Elena', last_name: 'Smith-Server' } }

    const analysis = analyze3WayMerge(base, local, server)
    expect(analysis.canAutoMerge).toBe(true)
    expect(analysis.conflictingFields).toHaveLength(0)
    expect((analysis.mergedData as any).personal.first_name).toBe('Elena-Local')
    expect((analysis.mergedData as any).personal.last_name).toBe('Smith-Server')
  })

  it('detects a conflict when both client and server change the SAME field', () => {
    const base = { personal: { first_name: 'Elena' } }
    const local = { personal: { first_name: 'LocalElena' } }
    const server = { personal: { first_name: 'ServerElena' } }

    const analysis = analyze3WayMerge(base, local, server)
    expect(analysis.canAutoMerge).toBe(false)
    expect(analysis.conflictingFields).toContain('personal.first_name')
  })

  it('applies user field resolution deterministically', () => {
    const base = { personal: { first_name: 'Elena', last_name: 'Rostova' } }
    const local = { personal: { first_name: 'LocalElena', last_name: 'LocalRostova' } }
    const server = { personal: { first_name: 'ServerElena', last_name: 'ServerRostova' } }

    // User selects server for first_name and local for last_name
    const resolved = applyResolutions(base, local, server, {
      'personal.first_name': 'server',
      'personal.last_name': 'local',
    })

    expect((resolved as any).personal.first_name).toBe('ServerElena')
    expect((resolved as any).personal.last_name).toBe('LocalRostova')
  })
})

describe('FormRelay Engine & IndexedDB Recovery', () => {
  let engine: FormRelayEngine

  beforeEach(async () => {
    await db.drafts.clear()
    await db.auditLog.clear()
    engine = new FormRelayEngine()
  })

  afterEach(() => {
    engine.destroy()
  })

  it('initializes a fresh draft in IndexedDB with initial revision 1', async () => {
    const draft = await engine.loadOrCreateDraft(
      'test-form-1',
      2,
      DEFAULT_V2_SCHOLARSHIP_DATA as unknown as Record<string, unknown>
    )

    expect(draft).toBeDefined()
    expect(draft.formId).toBe('test-form-1')
    expect(draft.localRevision).toBe(1)
    expect(draft.idempotencyKey).toMatch(/^idem_/)

    // Verify stored in IndexedDB
    const inDb = await db.drafts.get(draft.id)
    expect(inDb).toBeDefined()
    expect(inDb?.id).toBe(draft.id)
  })

  it('recovers saved draft from IndexedDB across page reloads', async () => {
    // 1. Initial creation
    const draft1 = await engine.loadOrCreateDraft(
      'reload-test-form',
      2,
      DEFAULT_V2_SCHOLARSHIP_DATA as unknown as Record<string, unknown>
    )

    // 2. Modify data and commit checkpoint
    const updated = {
      ...SAMPLE_POPULATED_SCHOLARSHIP,
      personal: { ...SAMPLE_POPULATED_SCHOLARSHIP.personal, first_name: 'PersistedElena' },
    }
    engine.queueCheckpoint(updated as unknown as Record<string, unknown>, 10)
    await engine.commitCheckpointNow()

    // 3. Destroy old engine and simulate page remount with fresh engine
    engine.destroy()
    const freshEngine = new FormRelayEngine()

    const recovered = await freshEngine.loadOrCreateDraft(
      'reload-test-form',
      2,
      DEFAULT_V2_SCHOLARSHIP_DATA as unknown as Record<string, unknown>
    )

    expect(recovered.id).toBe(draft1.id)
    expect((recovered.data as any).personal.first_name).toBe('PersistedElena')
    expect(recovered.localRevision).toBeGreaterThan(1)
    freshEngine.destroy()
  })

  it('deliberately clears draft with audit event when requested', async () => {
    const draft = await engine.loadOrCreateDraft(
      'clear-test-form',
      2,
      DEFAULT_V2_SCHOLARSHIP_DATA as unknown as Record<string, unknown>
    )
    expect(await db.drafts.get(draft.id)).toBeDefined()

    await engine.clearDraft()

    expect(engine.getDraft()).toBeNull()
    expect(await db.drafts.get(draft.id)).toBeUndefined()

    // Verify audit event logged
    const audits = await db.auditLog.toArray()
    const clearEvent = audits.find((a) => a.eventType === 'draft_cleared')
    expect(clearEvent).toBeDefined()
  })
})
