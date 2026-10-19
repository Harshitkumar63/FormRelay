import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  User,
  GraduationCap,
  Mail,
  FileCheck,
  Send,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Key,
} from 'lucide-react'
import { recoveryEngine } from '../../recovery/engine'
import {
  DEFAULT_V2_SCHOLARSHIP_DATA,
  SAMPLE_POPULATED_SCHOLARSHIP,
} from '../../recovery/defaults'
import type { LocalDraftRecord, ScholarshipFormData } from '../../recovery/types'

interface FormErrors {
  [key: string]: string
}

export const ScholarshipWizard: React.FC = () => {
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState(1)
  const [draft, setDraft] = useState<LocalDraftRecord | null>(recoveryEngine.getDraft())
  const [formData, setFormData] = useState<ScholarshipFormData>(DEFAULT_V2_SCHOLARSHIP_DATA)
  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [agreedToTerms, setAgreedToTerms] = useState(false)

  // Initialize draft on mount
  useEffect(() => {
    recoveryEngine
      .loadOrCreateDraft(
        'scholarship-application-v2',
        2,
        DEFAULT_V2_SCHOLARSHIP_DATA as unknown as Record<string, unknown>
      )
      .then((loadedDraft) => {
        setDraft(loadedDraft)
        if (loadedDraft.data && (loadedDraft.data as any).personal) {
          setFormData(loadedDraft.data as unknown as ScholarshipFormData)
        }
      })

    const unsubscribe = recoveryEngine.subscribe((d) => {
      setDraft(d)
      if (d?.data && (d.data as any).personal) {
        setFormData(d.data as unknown as ScholarshipFormData)
      }
    })

    return () => unsubscribe()
  }, [])

  // Handle nested field changes and trigger debounced local checkpoint
  const handleFieldChange = (
    section: keyof ScholarshipFormData,
    field: string,
    value: unknown
  ) => {
    const updated = {
      ...formData,
      [section]: {
        ...formData[section],
        [field]: value,
      },
    }
    setFormData(updated)
    // Clear error for field if any
    const errKey = `${section}.${field}`
    if (errors[errKey]) {
      const nextErrors = { ...errors }
      delete nextErrors[errKey]
      setErrors(nextErrors)
    }

    // Queue local checkpointing via FormRelay Engine
    recoveryEngine.queueCheckpoint(updated as unknown as Record<string, unknown>)
  }

  // Populate synthetic sample data
  const handleFillSample = () => {
    setFormData(SAMPLE_POPULATED_SCHOLARSHIP)
    setErrors({})
    recoveryEngine.queueCheckpoint(
      SAMPLE_POPULATED_SCHOLARSHIP as unknown as Record<string, unknown>,
      50
    )
  }

  // Validate step fields
  const validateStep = (step: number): boolean => {
    const newErrors: FormErrors = {}

    if (step === 1) {
      if (!formData.personal.first_name.trim()) {
        newErrors['personal.first_name'] = 'First name is required'
      }
      if (!formData.personal.last_name.trim()) {
        newErrors['personal.last_name'] = 'Last name is required'
      }
      if (!formData.personal.date_of_birth) {
        newErrors['personal.date_of_birth'] = 'Date of birth is required'
      }
      if (!formData.personal.nationality.trim()) {
        newErrors['personal.nationality'] = 'Nationality is required'
      }
    } else if (step === 2) {
      if (!formData.academic.institution.trim()) {
        newErrors['academic.institution'] = 'Institution is required'
      }
      if (!formData.academic.degree_program.trim()) {
        newErrors['academic.degree_program'] = 'Degree program is required'
      }
      if (!formData.academic.gpa.trim()) {
        newErrors['academic.gpa'] = 'GPA is required'
      } else {
        const gpaNum = parseFloat(formData.academic.gpa)
        if (isNaN(gpaNum) || gpaNum < 0 || gpaNum > 5.0) {
          newErrors['academic.gpa'] = 'Please enter a valid GPA between 0.0 and 5.0'
        }
      }
      if (!formData.academic.expected_graduation.trim()) {
        newErrors['academic.expected_graduation'] = 'Expected graduation is required'
      }
    } else if (step === 3) {
      if (!formData.contact.email.trim()) {
        newErrors['contact.email'] = 'Email is required'
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.contact.email)) {
        newErrors['contact.email'] = 'Invalid email address format'
      }
      if (!formData.contact.phone.trim()) {
        newErrors['contact.phone'] = 'Phone number is required'
      }
      if (!formData.contact.address_line1.trim()) {
        newErrors['contact.address_line1'] = 'Address line 1 is required'
      }
      if (!formData.contact.city.trim()) {
        newErrors['contact.city'] = 'City is required'
      }
      if (!formData.contact.country.trim()) {
        newErrors['contact.country'] = 'Country is required'
      }
    } else if (step === 4) {
      if (formData.documents.personal_statement_words < 100) {
        newErrors['documents.personal_statement_words'] =
          'Personal statement must be at least 100 words'
      }
      if (formData.documents.recommendation_letters_count < 1) {
        newErrors['documents.recommendation_letters_count'] =
          'At least 1 recommendation letter is required'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleNextStep = () => {
    if (validateStep(currentStep)) {
      setCurrentStep((prev) => Math.min(prev + 1, 5))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const handlePrevStep = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Handle final submission with idempotency key
  const handleFinalSubmit = async () => {
    // Validate all steps
    let hasAnyError = false
    for (let s = 1; s <= 4; s++) {
      if (!validateStep(s)) {
        setCurrentStep(s)
        hasAnyError = true
        break
      }
    }
    if (hasAnyError) return

    if (!agreedToTerms) {
      setSubmitError('Please certify that the submitted information is accurate.')
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const result = await recoveryEngine.submitCurrentDraft()
      // Store result in sessionStorage for receipt view
      sessionStorage.setItem('formrelay_latest_receipt', JSON.stringify(result))
      navigate('/receipt')
    } catch (err: any) {
      setSubmitError(err.message || 'Submission failed. Please check network connection.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const steps = [
    { num: 1, label: 'Personal', icon: User },
    { num: 2, label: 'Academic', icon: GraduationCap },
    { num: 3, label: 'Contact', icon: Mail },
    { num: 4, label: 'Documents', icon: FileCheck },
    { num: 5, label: 'Review & Submit', icon: Send },
  ]

  return (
    <div className="container" style={{ padding: '2rem 1.5rem' }}>
      {/* Title & Actions Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            Excellence in Engineering Scholarship Application
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            FormRelay offline-first recovery demo. Every keystroke is saved locally to IndexedDB.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleFillSample}
          title="Auto-fill form with realistic synthetic sample data"
        >
          <Sparkles size={16} color="var(--brand-600)" />
          <span>Fill Demo Data</span>
        </button>
      </div>

      {/* Wizard Step Progress Bar */}
      <div
        className="card"
        style={{
          padding: '1rem',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          overflowX: 'auto',
          gap: '0.5rem',
        }}
      >
        {steps.map((s, idx) => {
          const Icon = s.icon
          const isActive = currentStep === s.num
          const isDone = currentStep > s.num
          return (
            <React.Fragment key={s.num}>
              <button
                type="button"
                onClick={() => {
                  if (s.num < currentStep || validateStep(currentStep)) {
                    setCurrentStep(s.num)
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0.4rem 0.6rem',
                  borderRadius: 'var(--radius-sm)',
                  color: isActive
                    ? 'var(--brand-600)'
                    : isDone
                    ? 'var(--success-500)'
                    : 'var(--text-muted)',
                  fontWeight: isActive ? 700 : 500,
                  fontSize: '0.8125rem',
                  whiteSpace: 'nowrap',
                }}
              >
                <div
                  style={{
                    width: '26px',
                    height: '26px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: isActive
                      ? 'var(--brand-50)'
                      : isDone
                      ? 'var(--success-bg)'
                      : 'var(--bg-subtle)',
                    border: `1px solid ${
                      isActive
                        ? 'var(--brand-500)'
                        : isDone
                        ? 'var(--success-500)'
                        : 'var(--border-subtle)'
                    }`,
                  }}
                >
                  {isDone ? <CheckCircle2 size={15} /> : <Icon size={14} />}
                </div>
                <span>{s.label}</span>
              </button>
              {idx < steps.length - 1 && (
                <div
                  style={{
                    flex: 1,
                    height: '2px',
                    minWidth: '20px',
                    background: isDone ? 'var(--success-500)' : 'var(--border-subtle)',
                  }}
                />
              )}
            </React.Fragment>
          )
        })}
      </div>

      {/* Wizard Step Form Cards */}
      <div className="card card-elevated" style={{ padding: '2rem' }}>
        {/* STEP 1: Personal Info */}
        {currentStep === 1 && (
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '1.25rem' }}>
              Step 1: Personal Information
            </h2>
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">
                  First Name <span className="required">*</span>
                </label>
                <input
                  type="text"
                  className={`form-input ${errors['personal.first_name'] ? 'has-error' : ''}`}
                  value={formData.personal.first_name}
                  onChange={(e) => handleFieldChange('personal', 'first_name', e.target.value)}
                  placeholder="e.g. Elena"
                />
                {errors['personal.first_name'] && (
                  <div className="form-error">
                    <AlertCircle size={13} /> {errors['personal.first_name']}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">
                  Last Name <span className="required">*</span>
                </label>
                <input
                  type="text"
                  className={`form-input ${errors['personal.last_name'] ? 'has-error' : ''}`}
                  value={formData.personal.last_name}
                  onChange={(e) => handleFieldChange('personal', 'last_name', e.target.value)}
                  placeholder="e.g. Rostova"
                />
                {errors['personal.last_name'] && (
                  <div className="form-error">
                    <AlertCircle size={13} /> {errors['personal.last_name']}
                  </div>
                )}
              </div>
            </div>

            <div className="grid-3">
              <div className="form-group">
                <label className="form-label">
                  Date of Birth <span className="required">*</span>
                </label>
                <input
                  type="date"
                  className={`form-input ${errors['personal.date_of_birth'] ? 'has-error' : ''}`}
                  value={formData.personal.date_of_birth}
                  onChange={(e) => handleFieldChange('personal', 'date_of_birth', e.target.value)}
                />
                {errors['personal.date_of_birth'] && (
                  <div className="form-error">
                    <AlertCircle size={13} /> {errors['personal.date_of_birth']}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Gender</label>
                <select
                  className="form-select"
                  value={formData.personal.gender}
                  onChange={(e) => handleFieldChange('personal', 'gender', e.target.value)}
                >
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                  <option value="Non-binary">Non-binary</option>
                  <option value="Prefer not to say">Prefer not to say</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">
                  Nationality <span className="required">*</span>
                </label>
                <input
                  type="text"
                  className={`form-input ${errors['personal.nationality'] ? 'has-error' : ''}`}
                  value={formData.personal.nationality}
                  onChange={(e) => handleFieldChange('personal', 'nationality', e.target.value)}
                  placeholder="e.g. Canada"
                />
                {errors['personal.nationality'] && (
                  <div className="form-error">
                    <AlertCircle size={13} /> {errors['personal.nationality']}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: Academic Details */}
        {currentStep === 2 && (
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '1.25rem' }}>
              Step 2: Academic Information
            </h2>
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">
                  University / Institution <span className="required">*</span>
                </label>
                <input
                  type="text"
                  className={`form-input ${errors['academic.institution'] ? 'has-error' : ''}`}
                  value={formData.academic.institution}
                  onChange={(e) => handleFieldChange('academic', 'institution', e.target.value)}
                  placeholder="e.g. University of Waterloo"
                />
                {errors['academic.institution'] && (
                  <div className="form-error">
                    <AlertCircle size={13} /> {errors['academic.institution']}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">
                  Degree Program <span className="required">*</span>
                </label>
                <input
                  type="text"
                  className={`form-input ${errors['academic.degree_program'] ? 'has-error' : ''}`}
                  value={formData.academic.degree_program}
                  onChange={(e) => handleFieldChange('academic', 'degree_program', e.target.value)}
                  placeholder="e.g. Software Engineering"
                />
                {errors['academic.degree_program'] && (
                  <div className="form-error">
                    <AlertCircle size={13} /> {errors['academic.degree_program']}
                  </div>
                )}
              </div>
            </div>

            <div className="grid-3">
              <div className="form-group">
                <label className="form-label">
                  Cumulative GPA <span className="required">*</span>
                </label>
                <input
                  type="text"
                  className={`form-input ${errors['academic.gpa'] ? 'has-error' : ''}`}
                  value={formData.academic.gpa}
                  onChange={(e) => handleFieldChange('academic', 'gpa', e.target.value)}
                  placeholder="e.g. 3.92"
                />
                {errors['academic.gpa'] && (
                  <div className="form-error">
                    <AlertCircle size={13} /> {errors['academic.gpa']}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">GPA Scale (v2 field)</label>
                <select
                  className="form-select"
                  value={formData.academic.gpa_scale}
                  onChange={(e) => handleFieldChange('academic', 'gpa_scale', e.target.value)}
                >
                  <option value="4.0">4.0 Scale</option>
                  <option value="5.0">5.0 Scale</option>
                  <option value="10.0">10.0 Scale</option>
                  <option value="100%">100 Percentage</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Enrollment Year</label>
                <input
                  type="text"
                  className="form-input"
                  value={formData.academic.enrollment_year}
                  onChange={(e) => handleFieldChange('academic', 'enrollment_year', e.target.value)}
                />
              </div>
            </div>

            <div className="grid-3">
              <div className="form-group">
                <label className="form-label">Major Focus Area (v2 field)</label>
                <input
                  type="text"
                  className="form-input"
                  value={formData.academic.major}
                  onChange={(e) => handleFieldChange('academic', 'major', e.target.value)}
                  placeholder="e.g. Distributed Systems"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Minor / Secondary (v2 field)</label>
                <input
                  type="text"
                  className="form-input"
                  value={formData.academic.minor}
                  onChange={(e) => handleFieldChange('academic', 'minor', e.target.value)}
                  placeholder="e.g. Mathematics"
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  Expected Graduation <span className="required">*</span>
                </label>
                <input
                  type="month"
                  className={`form-input ${errors['academic.expected_graduation'] ? 'has-error' : ''}`}
                  value={formData.academic.expected_graduation}
                  onChange={(e) => handleFieldChange('academic', 'expected_graduation', e.target.value)}
                />
                {errors['academic.expected_graduation'] && (
                  <div className="form-error">
                    <AlertCircle size={13} /> {errors['academic.expected_graduation']}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: Contact Details */}
        {currentStep === 3 && (
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '1.25rem' }}>
              Step 3: Contact Information
            </h2>
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">
                  Email Address <span className="required">*</span>
                </label>
                <input
                  type="email"
                  className={`form-input ${errors['contact.email'] ? 'has-error' : ''}`}
                  value={formData.contact.email}
                  onChange={(e) => handleFieldChange('contact', 'email', e.target.value)}
                  placeholder="elena@example.com"
                />
                {errors['contact.email'] && (
                  <div className="form-error">
                    <AlertCircle size={13} /> {errors['contact.email']}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">
                  Phone Number <span className="required">*</span>
                </label>
                <input
                  type="tel"
                  className={`form-input ${errors['contact.phone'] ? 'has-error' : ''}`}
                  value={formData.contact.phone}
                  onChange={(e) => handleFieldChange('contact', 'phone', e.target.value)}
                  placeholder="+1 (555) 019-2834"
                />
                {errors['contact.phone'] && (
                  <div className="form-error">
                    <AlertCircle size={13} /> {errors['contact.phone']}
                  </div>
                )}
              </div>
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">
                  Address Line 1 <span className="required">*</span>
                </label>
                <input
                  type="text"
                  className={`form-input ${errors['contact.address_line1'] ? 'has-error' : ''}`}
                  value={formData.contact.address_line1}
                  onChange={(e) => handleFieldChange('contact', 'address_line1', e.target.value)}
                  placeholder="123 University Avenue"
                />
                {errors['contact.address_line1'] && (
                  <div className="form-error">
                    <AlertCircle size={13} /> {errors['contact.address_line1']}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Address Line 2 (Optional)</label>
                <input
                  type="text"
                  className="form-input"
                  value={formData.contact.address_line2}
                  onChange={(e) => handleFieldChange('contact', 'address_line2', e.target.value)}
                  placeholder="Apt 4B"
                />
              </div>
            </div>

            <div className="grid-3">
              <div className="form-group">
                <label className="form-label">
                  City <span className="required">*</span>
                </label>
                <input
                  type="text"
                  className={`form-input ${errors['contact.city'] ? 'has-error' : ''}`}
                  value={formData.contact.city}
                  onChange={(e) => handleFieldChange('contact', 'city', e.target.value)}
                  placeholder="Waterloo"
                />
                {errors['contact.city'] && (
                  <div className="form-error">
                    <AlertCircle size={13} /> {errors['contact.city']}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">State / Province</label>
                <input
                  type="text"
                  className="form-input"
                  value={formData.contact.state}
                  onChange={(e) => handleFieldChange('contact', 'state', e.target.value)}
                  placeholder="Ontario"
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  Country <span className="required">*</span>
                </label>
                <input
                  type="text"
                  className={`form-input ${errors['contact.country'] ? 'has-error' : ''}`}
                  value={formData.contact.country}
                  onChange={(e) => handleFieldChange('contact', 'country', e.target.value)}
                  placeholder="Canada"
                />
                {errors['contact.country'] && (
                  <div className="form-error">
                    <AlertCircle size={13} /> {errors['contact.country']}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: Supporting Document Metadata */}
        {currentStep === 4 && (
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.4rem' }}>
              Step 4: Supporting Document Metadata
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginBottom: '1.25rem' }}>
              Please describe your supporting materials. (Actual file upload is simulated as metadata for FormRelay v1).
            </p>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">
                  Recommendation Letters Count <span className="required">*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  className={`form-input ${errors['documents.recommendation_letters_count'] ? 'has-error' : ''}`}
                  value={formData.documents.recommendation_letters_count}
                  onChange={(e) =>
                    handleFieldChange('documents', 'recommendation_letters_count', parseInt(e.target.value) || 0)
                  }
                />
                {errors['documents.recommendation_letters_count'] && (
                  <div className="form-error">
                    <AlertCircle size={13} /> {errors['documents.recommendation_letters_count']}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">
                  Personal Statement Word Count <span className="required">*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  className={`form-input ${errors['documents.personal_statement_words'] ? 'has-error' : ''}`}
                  value={formData.documents.personal_statement_words}
                  onChange={(e) =>
                    handleFieldChange('documents', 'personal_statement_words', parseInt(e.target.value) || 0)
                  }
                />
                <div className="form-help">Minimum 100 words required for eligibility.</div>
                {errors['documents.personal_statement_words'] && (
                  <div className="form-error">
                    <AlertCircle size={13} /> {errors['documents.personal_statement_words']}
                  </div>
                )}
              </div>
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Online Portfolio URL (v2 field)</label>
                <input
                  type="url"
                  className="form-input"
                  value={formData.documents.portfolio_url}
                  onChange={(e) => handleFieldChange('documents', 'portfolio_url', e.target.value)}
                  placeholder="https://elena-rostova.dev"
                />
              </div>

              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', marginTop: '1rem' }}>
                  <input
                    type="checkbox"
                    checked={formData.documents.transcript_available}
                    onChange={(e) => handleFieldChange('documents', 'transcript_available', e.target.checked)}
                    style={{ width: '18px', height: '18px' }}
                  />
                  <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                    Official Academic Transcript is ready and verified
                  </span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', marginTop: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={formData.documents.resume_available}
                    onChange={(e) => handleFieldChange('documents', 'resume_available', e.target.checked)}
                    style={{ width: '18px', height: '18px' }}
                  />
                  <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                    Curriculum Vitae / Resume is attached (v2 field)
                  </span>
                </label>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Additional Research or Project Description</label>
              <textarea
                rows={3}
                className="form-textarea"
                value={formData.documents.additional_documents_description}
                onChange={(e) => handleFieldChange('documents', 'additional_documents_description', e.target.value)}
                placeholder="Mention any published work, patents, or open-source repositories..."
              />
            </div>
          </div>
        )}

        {/* STEP 5: Review & Final Submission */}
        {currentStep === 5 && (
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              Step 5: Review & Final Submission
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              Please carefully review your application before submitting. FormRelay will attach an
              effectively-once idempotency key to prevent accidental duplicate submissions.
            </p>

            {/* Idempotency Key Pill */}
            <div
              style={{
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.75rem 1rem',
                marginBottom: '1.5rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                fontSize: '0.8125rem',
              }}
            >
              <Key size={16} color="var(--brand-600)" />
              <div>
                <strong>Submission Idempotency Key:</strong>{' '}
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                  {draft?.idempotencyKey || 'Generated upon submission'}
                </span>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  If a network timeout occurs and you click submit again, the server recognizes this key and returns your original receipt safely without duplicate creation.
                </div>
              </div>
            </div>

            {/* Application Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ background: 'var(--bg-subtle)', padding: '1rem', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Applicant
                </div>
                <div style={{ fontSize: '1rem', fontWeight: 600, marginTop: '0.25rem' }}>
                  {formData.personal.first_name} {formData.personal.last_name}
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                  {formData.personal.nationality} • {formData.personal.gender}
                </div>
              </div>

              <div style={{ background: 'var(--bg-subtle)', padding: '1rem', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Academic
                </div>
                <div style={{ fontSize: '1rem', fontWeight: 600, marginTop: '0.25rem' }}>
                  {formData.academic.institution || '—'}
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                  {formData.academic.degree_program} (GPA {formData.academic.gpa} / {formData.academic.gpa_scale})
                </div>
              </div>

              <div style={{ background: 'var(--bg-subtle)', padding: '1rem', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Contact
                </div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, marginTop: '0.25rem' }}>
                  {formData.contact.email || '—'}
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                  {formData.contact.phone} • {formData.contact.city}, {formData.contact.country}
                </div>
              </div>
            </div>

            {/* Certification Checkbox */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.6rem',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  color: 'var(--text-primary)',
                }}
              >
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  style={{ width: '18px', height: '18px', marginTop: '2px' }}
                />
                <span>
                  I certify that all details submitted in this scholarship application are truthful and
                  accurate to the best of my knowledge.
                </span>
              </label>
            </div>

            {submitError && (
              <div
                style={{
                  background: 'var(--error-bg)',
                  border: '1px solid var(--error-border)',
                  color: 'var(--error-text)',
                  padding: '0.75rem 1rem',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: '1.5rem',
                  fontSize: '0.875rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <AlertCircle size={16} />
                <span>{submitError}</span>
              </div>
            )}
          </div>
        )}

        {/* Wizard Navigation Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: '2rem',
            paddingTop: '1.25rem',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          {currentStep > 1 ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handlePrevStep}
              disabled={isSubmitting}
            >
              <ArrowLeft size={16} />
              <span>Previous</span>
            </button>
          ) : (
            <div />
          )}

          {currentStep < 5 ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleNextStep}
            >
              <span>Continue</span>
              <ArrowRight size={16} />
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={handleFinalSubmit}
              disabled={isSubmitting}
              style={{
                background: 'linear-gradient(135deg, var(--brand-600), #1d4ed8)',
              }}
            >
              <Send size={18} />
              <span>{isSubmitting ? 'Submitting Application...' : 'Submit Application'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
