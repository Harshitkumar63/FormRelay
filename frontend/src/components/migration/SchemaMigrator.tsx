import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sliders,
  CheckCircle2,
  ArrowRight,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { recoveryEngine } from '../../recovery/engine'
import { apiClient, type ApiMigrationResponse } from '../../api/client'
import { SAMPLE_V1_LEGACY_DATA } from '../../recovery/defaults'

export const SchemaMigrator: React.FC = () => {
  const navigate = useNavigate()
  const [sourceVersion, setSourceVersion] = useState<number>(1)
  const [targetVersion, setTargetVersion] = useState<number>(2)
  const [sourceJson, setSourceJson] = useState<string>(
    JSON.stringify(SAMPLE_V1_LEGACY_DATA, null, 2)
  )
  const [migrationResult, setMigrationResult] = useState<ApiMigrationResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [appliedSuccess, setAppliedSuccess] = useState(false)

  const handlePreviewMigration = async () => {
    setIsLoading(true)
    setErrorMessage(null)
    setMigrationResult(null)

    try {
      const parsedData = JSON.parse(sourceJson)
      const result = await apiClient.migrateSchema(parsedData, sourceVersion, targetVersion)
      setMigrationResult(result)
    } catch (err: any) {
      setErrorMessage(err.message || 'Invalid JSON or schema migration failure')
    } finally {
      setIsLoading(false)
    }
  }

  const handleApplyToActiveDraft = async () => {
    if (!migrationResult) return
    setIsApplying(true)
    setErrorMessage(null)

    try {
      const currentDraft = recoveryEngine.getDraft()
      if (!currentDraft) {
        // Initialize as migrated draft
        await recoveryEngine.loadOrCreateDraft(
          'scholarship-application-v2',
          targetVersion,
          migrationResult.migrated_data
        )
      } else {
        await recoveryEngine.migrateCurrentDraft(targetVersion)
      }
      setAppliedSuccess(true)
      setTimeout(() => {
        navigate('/')
      }, 1500)
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to apply migration to active draft')
    } finally {
      setIsApplying(false)
    }
  }

  const handleResetToV1Sample = () => {
    setSourceVersion(1)
    setTargetVersion(2)
    setSourceJson(JSON.stringify(SAMPLE_V1_LEGACY_DATA, null, 2))
    setMigrationResult(null)
    setErrorMessage(null)
    setAppliedSuccess(false)
  }

  return (
    <div className="container" style={{ padding: '2.5rem 1.5rem', maxWidth: '1100px' }}>
      {/* Title */}
      <div style={{ marginBottom: '1.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--brand-600)', marginBottom: '0.4rem' }}>
          <Sliders size={24} />
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            Schema Evolution & Migration Engine
          </h1>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          FormRelay guarantees forward compatibility. When your schema evolves (e.g. v1 to v2), compatible fields are preserved,
          new fields receive sensible defaults, and a reviewable migration report prevents accidental data loss.
        </p>
      </div>

      {/* Migration Configuration Bar */}
      <div
        className="card"
        style={{
          padding: '1.25rem',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
          background: 'var(--bg-surface)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div>
            <label className="form-label" style={{ marginBottom: '0.2rem' }}>Source Version</label>
            <select
              className="form-select"
              value={sourceVersion}
              onChange={(e) => setSourceVersion(parseInt(e.target.value))}
              style={{ width: '120px' }}
            >
              <option value={1}>Version 1</option>
              <option value={2}>Version 2</option>
            </select>
          </div>

          <div style={{ paddingTop: '1.2rem', color: 'var(--text-muted)' }}>
            <ArrowRight size={18} />
          </div>

          <div>
            <label className="form-label" style={{ marginBottom: '0.2rem' }}>Target Version</label>
            <select
              className="form-select"
              value={targetVersion}
              onChange={(e) => setTargetVersion(parseInt(e.target.value))}
              style={{ width: '120px' }}
            >
              <option value={2}>Version 2 (Current)</option>
              <option value={1}>Version 1 (Legacy)</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleResetToV1Sample}
          >
            <Sparkles size={15} />
            <span>Load Sample v1 Draft</span>
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handlePreviewMigration}
            disabled={isLoading}
          >
            <RefreshCw size={15} className={isLoading ? 'spin' : ''} />
            <span>{isLoading ? 'Computing Migration...' : 'Preview Migration'}</span>
          </button>
        </div>
      </div>

      {/* Side-by-Side: Input JSON vs Migration Preview */}
      <div className="grid-2" style={{ marginBottom: '2rem' }}>
        {/* Source JSON Payload */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>
              Source Payload (Schema v{sourceVersion})
            </h3>
            <span className="badge badge-neutral">Input Data</span>
          </div>
          <textarea
            rows={18}
            className="form-textarea"
            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', lineHeight: 1.5 }}
            value={sourceJson}
            onChange={(e) => setSourceJson(e.target.value)}
          />
        </div>

        {/* Migrated Result Preview */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>
              Migrated Output (Schema v{targetVersion})
            </h3>
            <span className="badge badge-success">Target Output</span>
          </div>
          {migrationResult ? (
            <textarea
              rows={18}
              readOnly
              className="form-textarea"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
                lineHeight: 1.5,
                background: 'var(--bg-subtle)',
              }}
              value={JSON.stringify(migrationResult.migrated_data, null, 2)}
            />
          ) : (
            <div
              style={{
                height: '380px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: '0.75rem',
                color: 'var(--text-muted)',
                background: 'var(--bg-subtle)',
                borderRadius: 'var(--radius-sm)',
                border: '1px dashed var(--border-subtle)',
              }}
            >
              <Sliders size={32} />
              <span>Click "Preview Migration" to generate report</span>
            </div>
          )}
        </div>
      </div>

      {/* Field Reports Table */}
      {migrationResult && (
        <div className="card card-elevated" style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                Audit Field Report ({migrationResult.field_reports.length} fields analyzed)
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                {migrationResult.message}
              </p>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-subtle)', textAlign: 'left' }}>
                  <th style={{ padding: '0.6rem 0.8rem' }}>Field Path</th>
                  <th style={{ padding: '0.6rem 0.8rem' }}>Status</th>
                  <th style={{ padding: '0.6rem 0.8rem' }}>Default / Transformed Value</th>
                  <th style={{ padding: '0.6rem 0.8rem' }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {migrationResult.field_reports.map((report, idx) => (
                  <tr
                    key={idx}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      background:
                        report.status === 'added'
                          ? 'rgba(16, 185, 129, 0.04)'
                          : report.status === 'removed'
                          ? 'rgba(239, 68, 68, 0.04)'
                          : 'transparent',
                    }}
                  >
                    <td style={{ padding: '0.6rem 0.8rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                      {report.path}
                    </td>
                    <td style={{ padding: '0.6rem 0.8rem' }}>
                      <span
                        className={`badge ${
                          report.status === 'added'
                            ? 'badge-success'
                            : report.status === 'removed'
                            ? 'badge-error'
                            : 'badge-neutral'
                        }`}
                      >
                        {report.status}
                      </span>
                    </td>
                    <td style={{ padding: '0.6rem 0.8rem', fontFamily: 'var(--font-mono)' }}>
                      {report.new_value !== undefined ? JSON.stringify(report.new_value) : '—'}
                    </td>
                    <td style={{ padding: '0.6rem 0.8rem', color: 'var(--text-secondary)' }}>
                      {report.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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

      {appliedSuccess && (
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
          <span>Schema migration applied! Redirecting to application form...</span>
        </div>
      )}

      {/* Confirmation & Apply Button */}
      {migrationResult && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '0.75rem',
            paddingTop: '1rem',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/')}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={handleApplyToActiveDraft}
            disabled={isApplying || appliedSuccess}
          >
            <CheckCircle2 size={18} />
            <span>{isApplying ? 'Applying Migration...' : 'Apply Migration to Active Draft'}</span>
          </button>
        </div>
      )}
    </div>
  )
}
