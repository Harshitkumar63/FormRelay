import React, { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Navbar } from './components/layout/Navbar'
import { StatusBanner } from './components/common/StatusBanner'
import { ScholarshipWizard } from './components/scholarship/ScholarshipWizard'
import { ConflictResolver } from './components/conflict/ConflictResolver'
import { SchemaMigrator } from './components/migration/SchemaMigrator'
import { SubmissionReceipt } from './components/receipt/SubmissionReceipt'
import { FailureLab } from './components/laboratory/FailureLab'
import { ObservabilityView } from './components/diagnostics/ObservabilityView'
import { recoveryEngine } from './recovery/engine'
import type { LocalDraftRecord } from './recovery/types'

export const App: React.FC = () => {
  const [draft, setDraft] = useState<LocalDraftRecord | null>(recoveryEngine.getDraft())

  useEffect(() => {
    const unsub = recoveryEngine.subscribe((d) => setDraft(d))
    return () => unsub()
  }, [])

  return (
    <BrowserRouter>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Navbar />
        <StatusBanner draft={draft} />

        <main style={{ flex: 1 }}>
          <Routes>
            <Route path="/" element={<ScholarshipWizard />} />
            <Route path="/conflict" element={<ConflictResolver />} />
            <Route path="/migration" element={<SchemaMigrator />} />
            <Route path="/receipt" element={<SubmissionReceipt />} />
            <Route path="/laboratory" element={<FailureLab />} />
            <Route path="/observability" element={<ObservabilityView />} />
          </Routes>
        </main>

        <footer
          style={{
            background: 'var(--bg-surface)',
            borderTop: '1px solid var(--border-subtle)',
            padding: '1.25rem 0',
            fontSize: '0.8125rem',
            color: 'var(--text-muted)',
            textAlign: 'center',
          }}
        >
          <div className="container">
            <strong>FormRelay</strong> — Offline-First Form Recovery Infrastructure • Built with React, TypeScript, Dexie IndexedDB & FastAPI
          </div>
        </footer>
      </div>
    </BrowserRouter>
  )
}

export default App
