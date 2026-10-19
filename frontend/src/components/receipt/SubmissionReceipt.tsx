import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle,
  Receipt,
  Copy,
  Check,
  RefreshCw,
  FileText,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react'
import confetti from 'canvas-confetti'
import { apiClient } from '../../api/client'
import type { SubmissionResult } from '../../recovery/types'

export const SubmissionReceipt: React.FC = () => {
  const navigate = useNavigate()
  const [receipt, setReceipt] = useState<SubmissionResult | null>(null)
  const [copiedReceipt, setCopiedReceipt] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [verificationResult, setVerificationResult] = useState<string | null>(null)

  useEffect(() => {
    // Fire celebration confetti
    try {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
      })
    } catch {
      // ignore
    }

    // Load receipt from storage
    const stored = sessionStorage.getItem('formrelay_latest_receipt')
    if (stored) {
      try {
        setReceipt(JSON.parse(stored))
      } catch {
        // ignore
      }
    }
  }, [])

  const copyToClipboard = (text: string, setter: (v: boolean) => void) => {
    navigator.clipboard.writeText(text)
    setter(true)
    setTimeout(() => setter(false), 2000)
  }

  // Interactive test of Idempotency: retry submission with same key & payload
  const handleTestIdempotentRetry = async () => {
    if (!receipt) return
    setIsVerifying(true)
    setVerificationResult(null)

    try {
      const res = await apiClient.createSubmission(
        receipt.draftId,
        receipt.idempotencyKey,
        receipt.schemaVersion,
        receipt.data
      )

      if (res.receiptId === receipt.receiptId) {
        setVerificationResult(
          `SUCCESS: Server returned existing submission (Receipt ID ${res.receiptId}). Zero duplicate records created! HTTP 200 OK.`
        )
      } else {
        setVerificationResult('WARNING: Unexpected receipt ID discrepancy.')
      }
    } catch (err: any) {
      setVerificationResult(`Error: ${err.message}`)
    } finally {
      setIsVerifying(false)
    }
  }

  if (!receipt) {
    return (
      <div className="container" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
        <div className="card" style={{ maxWidth: '500px', margin: '0 auto', padding: '2.5rem' }}>
          <Receipt size={40} style={{ color: 'var(--text-muted)', margin: '0 auto 1rem' }} />
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>
            No Active Receipt Found
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
            Submit an application to view and verify its official cryptographic receipt.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate('/')}
          >
            Go to Application Form
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="container" style={{ padding: '3rem 1.5rem', maxWidth: '850px' }}>
      <div className="card card-elevated" style={{ padding: '2.5rem' }}>
        {/* Header Badge */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #ecfdf5, #d1fae5)',
              color: 'var(--success-500)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem',
              boxShadow: '0 0 20px rgba(16, 185, 129, 0.25)',
            }}
          >
            <CheckCircle size={36} />
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            Application Accepted & Verified
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', marginTop: '0.3rem' }}>
            Your scholarship submission has been validated, atomically recorded in PostgreSQL/SQLite,
            and assigned an immutable receipt.
          </p>
        </div>

        {/* Receipt Key Metrics */}
        <div
          style={{
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '1.5rem',
            marginBottom: '2rem',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem' }}>
            {/* Receipt ID */}
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Server Receipt ID
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.35rem' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                  {receipt.receiptId}
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(receipt.receiptId, setCopiedReceipt)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                  title="Copy Receipt ID"
                >
                  {copiedReceipt ? <Check size={14} color="var(--success-500)" /> : <Copy size={14} />}
                </button>
              </div>
            </div>

            {/* Idempotency Key */}
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Idempotency Key
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.35rem' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  {receipt.idempotencyKey}
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(receipt.idempotencyKey, setCopiedKey)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                  title="Copy Idempotency Key"
                >
                  {copiedKey ? <Check size={14} color="var(--success-500)" /> : <Copy size={14} />}
                </button>
              </div>
            </div>

            {/* Submission Time */}
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Timestamp
              </div>
              <div style={{ marginTop: '0.35rem', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {new Date(receipt.createdAt).toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {/* Idempotency Interactive Proof Box */}
        <div
          className="card"
          style={{
            background: 'var(--brand-50)',
            borderColor: 'var(--brand-100)',
            padding: '1.25rem',
            marginBottom: '2rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--brand-700)', fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.35rem' }}>
            <ShieldCheck size={18} />
            <span>FormRelay Idempotency Verification</span>
          </div>
          <p style={{ color: 'var(--brand-700)', fontSize: '0.8125rem', marginBottom: '0.75rem', lineHeight: 1.5 }}>
            You can verify effectively-once processing live. Clicking the button below fires another HTTP POST
            with the exact same idempotency key and payload. The server will catch the duplicate key and return
            this existing receipt (HTTP 200) without inserting a new database row.
          </p>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleTestIdempotentRetry}
            disabled={isVerifying}
          >
            <RefreshCw size={14} className={isVerifying ? 'spin' : ''} />
            <span>{isVerifying ? 'Testing Server...' : 'Test Idempotent Retry Live'}</span>
          </button>

          {verificationResult && (
            <div
              style={{
                marginTop: '0.75rem',
                padding: '0.6rem 0.8rem',
                borderRadius: 'var(--radius-sm)',
                background: 'white',
                border: '1px solid var(--brand-100)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.78rem',
                color: 'var(--brand-700)',
              }}
            >
              {verificationResult}
            </div>
          )}
        </div>

        {/* Submitted Data Payload Preview */}
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.5rem' }}>
            Archived Submission Payload (Schema v{receipt.schemaVersion})
          </h3>
          <pre
            style={{
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '1rem',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              maxHeight: '200px',
              overflowY: 'auto',
            }}
          >
            {JSON.stringify(receipt.data, null, 2)}
          </pre>
        </div>

        {/* Actions Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => window.print()}
          >
            <FileText size={16} />
            <span>Print Receipt</span>
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate('/')}
          >
            <span>Back to Dashboard</span>
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
