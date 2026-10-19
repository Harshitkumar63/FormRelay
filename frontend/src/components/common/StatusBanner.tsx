import React, { useState } from 'react'
import {
  Save,
  RefreshCw,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Clock,
  Info,
} from 'lucide-react'
import { recoveryEngine } from '../../recovery/engine'
import type { LocalDraftRecord } from '../../recovery/types'

interface StatusBannerProps {
  draft: LocalDraftRecord | null
}

export const StatusBanner: React.FC<StatusBannerProps> = ({ draft }) => {
  const [isClearing, setIsClearing] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  if (!draft) return null

  const handleManualSave = async () => {
    await recoveryEngine.commitCheckpointNow()
  }

  const handleRetrySync = async () => {
    setIsSyncing(true)
    try {
      await recoveryEngine.syncWithBackend()
    } finally {
      setIsSyncing(false)
    }
  }

  const handleClearDraft = async () => {
    setIsClearing(true)
    try {
      await recoveryEngine.clearDraft()
      setShowClearConfirm(false)
      window.location.reload()
    } finally {
      setIsClearing(false)
    }
  }

  // Format status badge
  const renderStatusBadge = () => {
    switch (draft.syncStatus) {
      case 'saving_local':
        return (
          <span className="badge badge-neutral">
            <Clock size={13} className="spin" />
            <span>Saving locally...</span>
          </span>
        )
      case 'saved_local':
        return (
          <span className="badge badge-info">
            <CheckCircle2 size={13} />
            <span>Saved locally (pending sync)</span>
          </span>
        )
      case 'syncing':
        return (
          <span className="badge badge-info">
            <RefreshCw size={13} className="spin" />
            <span>Syncing to server...</span>
          </span>
        )
      case 'synced':
        return (
          <span className="badge badge-success">
            <CheckCircle2 size={13} />
            <span>Synced with server</span>
          </span>
        )
      case 'conflict':
        return (
          <span className="badge badge-error">
            <AlertTriangle size={13} />
            <span>Revision Conflict Detected</span>
          </span>
        )
      case 'error':
        return (
          <span className="badge badge-error">
            <AlertCircle size={13} />
            <span>Sync failed</span>
          </span>
        )
      default:
        return (
          <span className="badge badge-neutral">
            <span>Ready</span>
          </span>
        )
    }
  }

  return (
    <>
      <div
        style={{
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '0.65rem 0',
          fontSize: '0.8125rem',
        }}
      >
        <div
          className="container"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          {/* Left: Status badge and revisions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {renderStatusBadge()}

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem',
              }}
            >
              <span>Local rev: <strong>v{draft.localRevision}</strong></span>
              <span>•</span>
              <span>Base rev: <strong>v{draft.baseRevision}</strong></span>
              <span>•</span>
              <span>Server rev: <strong>v{draft.serverRevision}</strong></span>
              <span>•</span>
              <span>Schema: <strong>v{draft.schemaVersion}</strong></span>
            </div>

            {draft.lastSavedAt && (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                Saved {new Date(draft.lastSavedAt).toLocaleTimeString()}
              </span>
            )}
          </div>

          {/* Right: Quick actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleManualSave}
              title="Force checkpoint commit to IndexedDB"
            >
              <Save size={13} />
              <span>Save Local</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleRetrySync}
              disabled={isSyncing}
              title="Synchronize draft with backend"
            >
              <RefreshCw size={13} className={isSyncing ? 'spin' : ''} />
              <span>Retry Sync</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ color: 'var(--error-500)' }}
              onClick={() => setShowClearConfirm(true)}
              title="Clear current draft from local browser storage"
            >
              <Trash2 size={13} />
              <span>Clear Draft</span>
            </button>
          </div>
        </div>
      </div>

      {/* Storage & Privacy Warning Bar */}
      <div
        style={{
          background: 'var(--brand-50)',
          borderBottom: '1px solid var(--brand-100)',
          padding: '0.4rem 0',
          fontSize: '0.75rem',
          color: 'var(--brand-700)',
        }}
      >
        <div
          className="container"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <Info size={14} style={{ flexShrink: 0 }} />
          <span>
            <strong>Storage & Privacy Notice:</strong> Checkpoints are safely persisted in this
            browser's IndexedDB. Never rely on a single browser profile for critical applications, and
            avoid shared computers.
          </span>
        </div>
      </div>

      {/* Clear Draft Confirmation Modal */}
      {showClearConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            backdropFilter: 'blur(3px)',
          }}
        >
          <div
            className="card card-elevated"
            style={{ maxWidth: '440px', width: '90%', margin: '1rem' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--error-500)', marginBottom: '0.75rem' }}>
              <AlertTriangle size={22} />
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Clear Local Draft?
              </h3>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.25rem', lineHeight: 1.5 }}>
              This will permanently delete your locally saved form checkpoint from IndexedDB and reset the application. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowClearConfirm(false)}
                disabled={isClearing}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleClearDraft}
                disabled={isClearing}
              >
                {isClearing ? 'Clearing...' : 'Yes, Delete Draft'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
