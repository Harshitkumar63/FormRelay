import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { StatusBanner } from '../components/common/StatusBanner'
import { Navbar } from '../components/layout/Navbar'
import { ScholarshipWizard } from '../components/scholarship/ScholarshipWizard'
import { ConflictResolver } from '../components/conflict/ConflictResolver'
import { SchemaMigrator } from '../components/migration/SchemaMigrator'
import { SubmissionReceipt } from '../components/receipt/SubmissionReceipt'
import { db } from '../recovery/db'
import type { LocalDraftRecord } from '../recovery/types'

describe('StatusBanner Component', () => {
  it('renders checkpoint status, revisions, and storage notice', () => {
    const mockDraft: LocalDraftRecord = {
      id: 'test-draft-123',
      formId: 'scholarship-test',
      schemaVersion: 2,
      localRevision: 4,
      baseRevision: 3,
      serverRevision: 3,
      data: {},
      status: 'draft',
      syncStatus: 'saved_local',
      lastSavedAt: new Date().toISOString(),
      idempotencyKey: 'idem_123',
      isDirty: false,
    }

    render(<StatusBanner draft={mockDraft} />)

    expect(screen.getByText(/Saved locally/i)).toBeInTheDocument()
    expect(screen.getByText(/Local rev:/i)).toBeInTheDocument()
    expect(screen.getByText(/Storage & Privacy Notice:/i)).toBeInTheDocument()
  })

  it('opens confirmation modal when clicking Clear Draft', () => {
    const mockDraft: LocalDraftRecord = {
      id: 'test-draft-123',
      formId: 'scholarship-test',
      schemaVersion: 2,
      localRevision: 1,
      baseRevision: 1,
      serverRevision: 1,
      data: {},
      status: 'draft',
      syncStatus: 'synced',
      lastSavedAt: new Date().toISOString(),
      idempotencyKey: 'idem_123',
      isDirty: false,
    }

    render(<StatusBanner draft={mockDraft} />)
    const clearBtn = screen.getByTitle(/Clear current draft/i)
    fireEvent.click(clearBtn)

    expect(screen.getByText(/Clear Local Draft\?/i)).toBeInTheDocument()
  })
})

describe('Navbar Component', () => {
  it('renders navigation links and live connection pill', () => {
    render(
      <BrowserRouter>
        <Navbar />
      </BrowserRouter>
    )

    expect(screen.getByText(/Form/i)).toBeInTheDocument()
    expect(screen.getByText(/Application/i)).toBeInTheDocument()
    expect(screen.getByText(/Conflict Resolver/i)).toBeInTheDocument()
    expect(screen.getByText(/Schema v1→v2/i)).toBeInTheDocument()
    expect(screen.getByText(/Failure Lab/i)).toBeInTheDocument()
    expect(screen.getByText(/Observability/i)).toBeInTheDocument()
  })
})

describe('ScholarshipWizard Component', () => {
  beforeEach(async () => {
    await db.drafts.clear()
  })

  it('renders step 1 with validation', async () => {
    render(
      <BrowserRouter>
        <ScholarshipWizard />
      </BrowserRouter>
    )

    expect(
      screen.getByText(/Excellence in Engineering Scholarship Application/i)
    ).toBeInTheDocument()
    expect(screen.getByText(/Step 1: Personal Information/i)).toBeInTheDocument()

    // Clicking continue without required fields shows validation error
    const continueBtn = screen.getByText(/Continue/i)
    fireEvent.click(continueBtn)

    await waitFor(() => {
      expect(screen.getByText(/First name is required/i)).toBeInTheDocument()
    })
  })

  it('populates synthetic sample data on button click', async () => {
    render(
      <BrowserRouter>
        <ScholarshipWizard />
      </BrowserRouter>
    )

    const fillBtn = screen.getByText(/Fill Demo Data/i)
    fireEvent.click(fillBtn)

    await waitFor(() => {
      const input = screen.getByPlaceholderText(/e\.g\. Elena/i) as HTMLInputElement
      expect(input.value).toBe('Elena')
    })
  })
})

describe('SchemaMigrator Component', () => {
  it('renders schema migration interface with source and target options', () => {
    render(
      <BrowserRouter>
        <SchemaMigrator />
      </BrowserRouter>
    )

    expect(screen.getByText(/Schema Evolution & Migration Engine/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Preview Migration/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Load Sample v1 Draft/i })).toBeInTheDocument()
  })
})
