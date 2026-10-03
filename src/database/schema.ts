export const schemaSql = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS members (
  member_id TEXT PRIMARY KEY,
  program TEXT NOT NULL CHECK (program IN ('Medicare Advantage', 'Medicaid')),
  age_band TEXT NOT NULL,
  region TEXT NOT NULL,
  risk_category TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS providers (
  provider_id TEXT PRIMARY KEY,
  provider_type TEXT NOT NULL,
  specialty TEXT NOT NULL,
  region TEXT NOT NULL,
  network_status TEXT NOT NULL CHECK (network_status IN ('In network', 'Out of network'))
);

CREATE TABLE IF NOT EXISTS authorizations (
  authorization_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(member_id),
  provider_id TEXT NOT NULL REFERENCES providers(provider_id),
  service_category TEXT NOT NULL,
  request_date TEXT NOT NULL,
  decision_date TEXT,
  authorization_status TEXT NOT NULL CHECK (authorization_status IN ('Approved', 'Pending', 'Denied', 'Expired', 'Not required')),
  units_requested INTEGER NOT NULL,
  units_approved INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  claim_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(member_id),
  provider_id TEXT NOT NULL REFERENCES providers(provider_id),
  authorization_id TEXT REFERENCES authorizations(authorization_id),
  service_date TEXT NOT NULL,
  received_date TEXT NOT NULL,
  processed_date TEXT NOT NULL,
  claim_status TEXT NOT NULL CHECK (claim_status IN ('Paid', 'Denied', 'Partially paid')),
  denial_code TEXT,
  denial_category TEXT CHECK (denial_category IN ('Prior authorization', 'Coding', 'Eligibility', 'Duplicate', 'Timely filing', 'Other', NULL)),
  program TEXT NOT NULL CHECK (program IN ('Medicare Advantage', 'Medicaid')),
  place_of_service TEXT NOT NULL,
  processing_days INTEGER NOT NULL CHECK (processing_days >= 0)
);

CREATE TABLE IF NOT EXISTS claim_lines (
  claim_line_id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claims(claim_id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  billed_amount REAL NOT NULL CHECK (billed_amount >= 0),
  allowed_amount REAL NOT NULL CHECK (allowed_amount >= 0),
  paid_amount REAL NOT NULL CHECK (paid_amount >= 0),
  diagnosis_category TEXT NOT NULL,
  procedure_code TEXT NOT NULL,
  service_category TEXT NOT NULL,
  UNIQUE (claim_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_claims_service_date ON claims(service_date);
CREATE INDEX IF NOT EXISTS idx_claims_provider ON claims(provider_id);
CREATE INDEX IF NOT EXISTS idx_claims_member ON claims(member_id);
CREATE INDEX IF NOT EXISTS idx_claims_authorization ON claims(authorization_id);
CREATE INDEX IF NOT EXISTS idx_claim_lines_category ON claim_lines(service_category);
`;
