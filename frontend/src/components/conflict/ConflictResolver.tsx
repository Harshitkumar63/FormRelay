import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Server,
  Laptop,
  Check,
} from 'lucide-react'
import { recoveryEngine } from '../../recovery/engine'
import { apiClient } from '../../api/client'
import { flattenObject, unflattenObject } from '../../recovery/diff'
import type { ConflictDetail, LocalDraftRecord } from '../../recovery/types'

export const ConflictResolver: React.FC = () => {
  const navigate = useNavigate()
  const [draft, setDraft] = useState<LocalDraftRecord | null>(recoveryEngine.getDraft())
  const [conflict, setConflict] = useState<ConflictDetail | null>(recoveryEngine.getActiveConflict())
  const [fieldChoices, setFieldChoices] = useState<Record<string, 'local' | 'server' | string>>({})
  const [isResolving, setIsResolving] = useState(false)
  const [resolveSuccess, setResolveSuccess] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = recoveryEngine.subscribe((d, engine) => {
      setDraft(d)
      const active = engine.getActiveConflict()
      setConflict(active)
      if (active) {
        // Initialize default choices (default to local)
        const defaults: Record<string, 'local'> = {}
        for (const field of active.conflictingFields) {
          defaults[field] = 'local'
        }
        setFieldChoices(defaults)
      }
    })
    return () => unsubscribe()
  }, [])

  // Simulate a conflict for demonstration purposes
  const handleSimulateConflict = async () => {
    if (!draft) return
    setErrorMessage(null)
    try {
      // 1. Update draft on server directly (simulating device B)
      const serverPayload = JSON.parse(JSON.stringify(draft.data))
      if (serverPayload.personal) {
        serverPayload.personal.first_name = 'ServerUpdatedName'
      }
      await apiClient.updateDraft(
        draft.id,
        serverPayload,
        draft.serverRevision,
        draft.schemaVersion
      )

      // 2. Modify local draft on the same field
      const localPayload = JSON.parse(JSON.stringify(draft.data))
      if (localPayload.personal) {
        localPayload.personal.first_name = 'LocalConflictingName'
      }
      recoveryEngine.queueCheckpoint(localPayload, 10)

      // 3. Trigger sync - will detect conflict (409) and populate conflict view!
      setTimeout(async () => {
        await recoveryEngine.syncWithBackend()
      }, 100)
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to simulate conflict')
    }
  }

  // Build merged data preview based on choices
  const getMergedPreview = (): Record<string, unknown> => {
    if (!conflict) return {}
    const flatLocal = flattenObject(conflict.clientData)
    const flatServer = flattenObject(conflict.serverData)
    const flatMerged = { ...flatServer } // start with server base

    for (const [key, choice] of Object.entries(fieldChoices)) {
      if (choice === 'local') {
        flatMerged[key] = flatLocal[key]
      } else if (choice === 'server') {
        flatMerged[key] = flatServer[key]
      } else {
        flatMerged[key] = choice
      }
    }

    return unflattenObject(flatMerged)
  }

  const handleResolveAndSync = async () => {
    if (!conflict) return
    setIsResolving(true)
    setErrorMessage(null)

    try {
      const finalMerged = getMergedPreview()
      await recoveryEngine.resolveActiveConflict(finalMerged, 'field_level_manual')
      setResolveSuccess(true)
      setTimeout(() => {
        navigate('/')
      }, 1500)
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to apply conflict resolution')
    } finally {
      setIsResolving(false)
    }
  }

  if (!conflict) {
    return (
      <div className="container" style={{ padding: '3rem 1.5rem', maxWidth: '750px' }}>
        <div className="card card-elevated" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
          <div
            style={{
              width: '54px',
              height: '54px',
              borderRadius: '50%',
              background: 'var(--success-bg)',
              color: 'var(--success-500)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1.25rem',
            }}
          >
            <CheckCircle2 size={30} />
          </div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '0.6rem' }}>
            No Active Revisions Conflicts
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.75rem', lineHeight: 1.6 }}>
            Your local draft is completely synchronized with the server. No divergence or overlapping
            edits have occurred.
          </p>

          <div
            style={{
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '1.25rem',
              marginBottom: '1.75rem',
              textAlign: 'left',
              fontSize: '0.8125rem',
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: '0.4rem', color: 'var(--text-primary)' }}>
              How Conflict Handling Works in FormRelay:
            </div>
            <ul style={{ paddingLeft: '1.25rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <li>FormRelay never silently overwrites data with naive Last-Write-Wins.</li>
              <li>Base, local, and server revisions are tracked using optimistic concurrency control.</li>
              <li>When two devices edit the same field, a 3-way merge highlights only conflicting fields for user resolution.</li>
            </ul>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSimulateConflict}
              disabled={!draft}
            >
              <Sparkles size={16} />
              <span>Simulate Revision Conflict Now</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate('/')}
            >
              <span>Back to Form</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  const flatLocal = flattenObject(conflict.clientData)
  const flatServer = flattenObject(conflict.serverData)

  return (
    <div className="container" style={{ padding: '2.5rem 1.5rem', maxWidth: '1000px' }}>
      {/* Title */}
      <div style={{ marginBottom: '1.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--warning-500)', marginBottom: '0.4rem' }}>
          <AlertTriangle size={24} />
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            Revision Conflict Resolution
          </h1>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          Another device or session updated this draft while you were editing. Choose the desired value
          for each conflicting field before completing synchronization.
        </p>
      </div>

      {/* Revision Meta Card */}
      <div
        className="card"
        style={{
          padding: '1rem 1.25rem',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
          background: 'var(--warning-bg)',
          borderColor: 'var(--warning-border)',
        }}
      >
        <div style={{ fontSize: '0.8125rem', color: 'var(--warning-text)' }}>
          <strong>Conflict Detected:</strong> Client base was <code>rev {conflict.clientBaseRevision}</code>,
          Server is at <code>rev {conflict.serverRevision}</code>. {conflict.conflictingFields.length} field(s) require your resolution.
        </div>
      </div>

      {/* Conflicting Fields Chooser List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginBottom: '2rem' }}>
        {conflict.conflictingFields.map((fieldKey) => {
          const localVal = String(flatLocal[fieldKey] ?? '')
          const serverVal = String(flatServer[fieldKey] ?? '')
          const selected = fieldChoices[fieldKey] || 'local'

          return (
            <div key={fieldKey} className="card card-elevated" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    fontSize: '0.9rem',
                    color: 'var(--text-primary)',
                    background: 'var(--bg-subtle)',
                    padding: '0.2rem 0.5rem',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  {fieldKey}
                </span>
                <span className="badge badge-error">Conflict</span>
              </div>

              {/* Side-by-side choices */}
              <div className="grid-2">
                {/* Local Choice Card */}
                <div
                  onClick={() => setFieldChoices({ ...fieldChoices, [fieldKey]: 'local' })}
                  style={{
                    padding: '1rem',
                    borderRadius: 'var(--radius-md)',
                    border: `2px solid ${
                      selected === 'local' ? 'var(--brand-500)' : 'var(--border-subtle)'
                    }`,
                    background: selected === 'local' ? 'var(--brand-50)' : 'var(--bg-surface)',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--brand-700)' }}>
                      <Laptop size={15} />
                      <span>Your Local Version</span>
                    </div>
                    {selected === 'local' && <Check size={16} color="var(--brand-600)" />}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.875rem',
                      padding: '0.5rem',
                      background: 'var(--bg-surface)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                      wordBreak: 'break-all',
                    }}
                  >
                    {localVal || <em style={{ color: 'var(--text-muted)' }}>(empty)</em>}
                  </div>
                </div>

                {/* Server Choice Card */}
                <div
                  onClick={() => setFieldChoices({ ...fieldChoices, [fieldKey]: 'server' })}
                  style={{
                    padding: '1rem',
                    borderRadius: 'var(--radius-md)',
                    border: `2px solid ${
                      selected === 'server' ? 'var(--brand-500)' : 'var(--border-subtle)'
                    }`,
                    background: selected === 'server' ? 'var(--brand-50)' : 'var(--bg-surface)',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      <Server size={15} />
                      <span>Remote Server Version</span>
                    </div>
                    {selected === 'server' && <Check size={16} color="var(--brand-600)" />}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.875rem',
                      padding: '0.5rem',
                      background: 'var(--bg-surface)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                      wordBreak: 'break-all',
                    }}
                  >
                    {serverVal || <em style={{ color: 'var(--text-muted)' }}>(empty)</em>}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {errorMessage && (
        <div
          style={{
            background: 'var(--error-bg)',
            border: '1px solid var(--error-border)',
            color: 'var(--error-text)',
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '1.5rem',
            fontSize: '0.875rem',
          }}
        >
          {errorMessage}
        </div>
      )}

      {resolveSuccess && (
        <div
          style={{
            background: 'var(--success-bg)',
            border: '1px solid var(--success-border)',
            color: 'var(--success-text)',
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '1.5rem',
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <CheckCircle2 size={16} />
          <span>Conflict successfully resolved! Synchronizing and returning to application...</span>
        </div>
      )}

      {/* Action Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.75rem' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => navigate('/')}
          disabled={isResolving}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-lg"
          onClick={handleResolveAndSync}
          disabled={isResolving || resolveSuccess}
        >
          <CheckCircle2 size={18} />
          <span>{isResolving ? 'Resolving...' : 'Confirm & Sync Resolved Version'}</span>
        </button>
      </div>
    </div>
  )
}
