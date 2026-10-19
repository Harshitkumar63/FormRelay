import type { ScholarshipFormData } from './types'

export const DEFAULT_V2_SCHOLARSHIP_DATA: ScholarshipFormData = {
  personal: {
    first_name: '',
    last_name: '',
    date_of_birth: '',
    gender: 'Prefer not to say',
    nationality: '',
  },
  academic: {
    institution: '',
    degree_program: '',
    gpa: '',
    gpa_scale: '4.0',
    major: '',
    minor: '',
    enrollment_year: new Date().getFullYear().toString(),
    expected_graduation: '',
  },
  contact: {
    email: '',
    phone: '',
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    postal_code: '',
    country: '',
  },
  documents: {
    transcript_available: false,
    recommendation_letters_count: 0,
    personal_statement_words: 0,
    portfolio_url: '',
    resume_available: false,
    additional_documents_description: '',
  },
}

export const SAMPLE_POPULATED_SCHOLARSHIP: ScholarshipFormData = {
  personal: {
    first_name: 'Elena',
    last_name: 'Rostova',
    date_of_birth: '2001-08-24',
    gender: 'Female',
    nationality: 'Canada',
  },
  academic: {
    institution: 'University of Waterloo',
    degree_program: 'Software Engineering',
    gpa: '3.92',
    gpa_scale: '4.0',
    major: 'Systems Architecture',
    minor: 'Applied Mathematics',
    enrollment_year: '2021',
    expected_graduation: '2025-05',
  },
  contact: {
    email: 'elena.rostova@example.com',
    phone: '+1 (519) 555-0199',
    address_line1: '200 University Ave W',
    address_line2: 'Unit 402',
    city: 'Waterloo',
    state: 'Ontario',
    postal_code: 'N2L 3G1',
    country: 'Canada',
  },
  documents: {
    transcript_available: true,
    recommendation_letters_count: 3,
    personal_statement_words: 950,
    portfolio_url: 'https://elena-rostova.dev',
    resume_available: true,
    additional_documents_description: 'Published paper in IEEE Transactions on Reliable Distributed Systems',
  },
}

export const SAMPLE_V1_LEGACY_DATA = {
  personal: {
    first_name: 'Marcus',
    last_name: 'Vance',
    date_of_birth: '1999-11-12',
    gender: 'Male',
    nationality: 'United States',
  },
  academic: {
    institution: 'University of Washington',
    degree_program: 'Computer Science',
    gpa: '3.75',
    enrollment_year: '2020',
    expected_graduation: '2024-06',
  },
  contact: {
    email: 'marcus.vance@example.edu',
    phone: '+1 (206) 555-0144',
    address_line1: '1410 NE Campus Parkway',
    address_line2: 'Apt 12B',
    city: 'Seattle',
    state: 'Washington',
    postal_code: '98195',
    country: 'United States',
  },
  documents: {
    transcript_available: true,
    recommendation_letters_count: 2,
    personal_statement_words: 650,
    additional_documents_description: 'Open source contribution portfolio',
  },
}
