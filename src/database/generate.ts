import { existsSync, rmSync } from 'node:fs';
import { openDatabase, defaultDatabasePath } from './connection.js';
import { schemaSql } from './schema.js';

const SEED = 20260926;
const reset = process.argv.includes('--reset');

class Random {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0; }
  next(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
  int(max: number): number { return Math.floor(this.next() * max); }
  pick<T>(values: readonly T[]): T { return values[this.int(values.length)]!; }
}

const random = new Random(SEED);
const regions = ['Northeast', 'Midwest', 'South', 'West'] as const;
const programs = ['Medicare Advantage', 'Medicaid'] as const;
const serviceCategories = ['Outpatient imaging', 'Primary care', 'Emergency', 'Inpatient', 'Behavioral health', 'Laboratory', 'Specialty care'] as const;
const diagnosisCategories = ['Musculoskeletal', 'Cardiovascular', 'Respiratory', 'Neurological', 'Behavioral health', 'Preventive', 'Other'] as const;
const providers: Array<{ provider_id: string; provider_type: string; specialty: string; region: string; network_status: string; affected: boolean }> = [];
const members: Array<{ member_id: string; program: string; age_band: string; region: string; risk_category: string }> = [];

for (let i = 1; i <= 120; i++) {
  const imaging = i <= 38;
  providers.push({
    provider_id: `PRV-${String(i).padStart(4, '0')}`,
    provider_type: imaging ? 'Facility' : random.pick(['Individual practitioner', 'Group practice', 'Facility']),
    specialty: imaging ? random.pick(['Radiology', 'Diagnostic imaging']) : random.pick(['Primary care', 'Cardiology', 'Behavioral health', 'Orthopedics', 'General practice', 'Laboratory']),
    region: random.pick(regions),
    network_status: random.next() < 0.88 ? 'In network' : 'Out of network',
    affected: imaging && i <= 9
  });
}
for (let i = 1; i <= 5000; i++) {
  members.push({
    member_id: `MBR-${String(i).padStart(6, '0')}`,
    program: random.next() < 0.62 ? programs[0] : programs[1],
    age_band: random.pick(['0-17', '18-34', '35-49', '50-64', '65-74', '75+']),
    region: random.pick(regions),
    risk_category: random.pick(['Lower', 'Moderate', 'Higher'])
  });
}

const db = openDatabase();
try {
  if (reset && existsSync(defaultDatabasePath)) {
    db.close();
    rmSync(defaultDatabasePath);
  } else {
    db.exec('DROP TABLE IF EXISTS claim_lines; DROP TABLE IF EXISTS claims; DROP TABLE IF EXISTS authorizations; DROP TABLE IF EXISTS providers; DROP TABLE IF EXISTS members;');
  }
} finally {
  if (db.open) db.close();
}

const out = openDatabase();
out.exec(schemaSql);
const insertMember = out.prepare('INSERT INTO members VALUES (@member_id, @program, @age_band, @region, @risk_category)');
const insertProvider = out.prepare('INSERT INTO providers VALUES (@provider_id, @provider_type, @specialty, @region, @network_status)');
const insertAuthorization = out.prepare(`INSERT INTO authorizations VALUES (@authorization_id, @member_id, @provider_id, @service_category, @request_date, @decision_date, @authorization_status, @units_requested, @units_approved)`);
const insertClaim = out.prepare(`INSERT INTO claims VALUES (@claim_id, @member_id, @provider_id, @authorization_id, @service_date, @received_date, @processed_date, @claim_status, @denial_code, @denial_category, @program, @place_of_service, @processing_days)`);
const insertLine = out.prepare(`INSERT INTO claim_lines VALUES (@claim_line_id, @claim_id, @line_number, @billed_amount, @allowed_amount, @paid_amount, @diagnosis_category, @procedure_code, @service_category)`);

const dayString = (year: number, month: number, day: number): string => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const monthSpecs = [
  // Small fixed-seed calibration offsets compensate for this generator's random draw and provider mix.
  // The offsets are intentionally modest and preserve non-identical outcomes across providers and programs.
  { month: 7, lines: 13320, overall: 0.075, imaging: 0.09, imagingCalibration: -0.022, processing: 3.1 },
  { month: 8, lines: 13400, overall: 0.145, imaging: 0.25, imagingCalibration: 0.023, processing: 5.4 },
  { month: 9, lines: 13280, overall: 0.085, imaging: 0.11, imagingCalibration: -0.006, processing: 3.5 }
];
const denialCategories = ['Prior authorization', 'Coding', 'Eligibility', 'Duplicate', 'Timely filing', 'Other'] as const;
const categoryWeights = [0.46, 0.22, 0.12, 0.08, 0.06, 0.06];
let claimNumber = 1;
let authNumber = 1;

const transaction = out.transaction(() => {
  for (const member of members) insertMember.run(member);
  for (const provider of providers) insertProvider.run(provider);

  for (const spec of monthSpecs) {
    const claimCount = spec.lines / 2;
    for (let c = 0; c < claimCount; c++, claimNumber++) {
      const claimId = `CLM-${String(claimNumber).padStart(7, '0')}`;
      const member = random.pick(members);
      const provider = random.pick(providers);
      const serviceCategory = random.next() < (spec.month === 8 ? 0.14 : 0.12) ? serviceCategories[0] : random.pick(serviceCategories.slice(1));
      const imaging = serviceCategory === 'Outpatient imaging';
      const day = random.int(27) + 1;
      const serviceDate = dayString(2026, spec.month, day);
      const receivedDay = Math.min(28, day + random.int(5));
      const receivedDate = dayString(2026, spec.month, receivedDay);

      // Provider concentration is partial and noisy: August imaging lines at a subset of providers have elevated authorization-related denial probability.
      let denialProbability = imaging ? spec.imaging + spec.imagingCalibration : (spec.overall - (spec.imaging * (spec.month === 8 ? 0.14 : 0.12))) / (1 - (spec.month === 8 ? 0.14 : 0.12));
      denialProbability *= member.program === 'Medicaid' ? 1.04 : 0.98;
      if (spec.month === 8 && imaging && provider.affected) denialProbability = Math.min(0.66, denialProbability * 2.1);
      if (spec.month === 8 && imaging && !provider.affected) denialProbability *= 0.72;
      denialProbability = Math.max(0.02, Math.min(0.75, denialProbability + (random.next() - 0.5) * 0.035));
      const denied = random.next() < denialProbability;
      const partial = !denied && random.next() < 0.035;

      let authorizationId: string | null = null;
      if (imaging && random.next() < 0.86 || !imaging && random.next() < 0.12) {
        authorizationId = `AUTH-${String(authNumber++).padStart(7, '0')}`;
        let authorizationStatus: string;
        if (denied && imaging && spec.month === 8) {
          authorizationStatus = random.next() < (provider.affected ? 0.78 : 0.44) ? random.pick(['Pending', 'Denied', 'Expired']) : 'Approved';
        } else if (denied && random.next() < 0.26) {
          authorizationStatus = random.pick(['Pending', 'Expired']);
        } else {
          authorizationStatus = random.next() < 0.94 ? 'Approved' : 'Pending';
        }
        const requestDay = Math.max(1, day - random.int(12));
        insertAuthorization.run({
          authorization_id: authorizationId, member_id: member.member_id, provider_id: provider.provider_id,
          service_category: serviceCategory, request_date: dayString(2026, spec.month, requestDay),
          decision_date: authorizationStatus === 'Pending' ? null : dayString(2026, spec.month, Math.min(28, requestDay + random.int(4))),
          authorization_status: authorizationStatus, units_requested: random.int(3) + 1,
          units_approved: authorizationStatus === 'Approved' ? random.int(3) + 1 : 0
        });
      }

      let denialCategory: typeof denialCategories[number] | null = null;
      if (denied) {
        if (imaging && spec.month === 8 && provider.affected && random.next() < 0.79) denialCategory = 'Prior authorization';
        else if (imaging && spec.month === 8 && random.next() < 0.51) denialCategory = 'Prior authorization';
        else {
          const draw = random.next();
          let cumulative = 0;
          denialCategory = denialCategories[denialCategories.length - 1];
          for (let i = 0; i < categoryWeights.length; i++) {
            cumulative += categoryWeights[i]!;
            if (draw <= cumulative) { denialCategory = denialCategories[i]!; break; }
          }
        }
      }
      const processingBase = spec.processing + (imaging && spec.month === 8 ? 1.0 : 0) + (provider.affected && spec.month === 8 ? 0.7 : 0);
      const processingDays = Math.max(1, Math.round(processingBase + (random.next() - 0.5) * 3.4));
      const processedDay = Math.min(31, receivedDay + processingDays);
      const processedMonth = processedDay > new Date(2026, spec.month, 0).getDate() ? spec.month + 1 : spec.month;
      const normalizedDay = processedMonth === spec.month ? processedDay : processedDay - new Date(2026, spec.month, 0).getDate();
      insertClaim.run({
        claim_id: claimId, member_id: member.member_id, provider_id: provider.provider_id,
        authorization_id: authorizationId, service_date: serviceDate, received_date: receivedDate,
        processed_date: dayString(2026, processedMonth, normalizedDay),
        claim_status: denied ? 'Denied' : partial ? 'Partially paid' : 'Paid',
        denial_code: denied ? `SYN-${String(denialCategories.indexOf(denialCategory!) + 1).padStart(2, '0')}` : null,
        denial_category: denialCategory, program: member.program,
        place_of_service: imaging ? 'Outpatient hospital' : random.pick(['Office', 'Outpatient hospital', 'Emergency room', 'Inpatient hospital', 'Independent laboratory']),
        processing_days: processingDays
      });

      for (let line = 1; line <= 2; line++) {
        const billed = Math.round((80 + random.next() * (imaging ? 2200 : 900)) * 100) / 100;
        const allowed = Math.round(billed * (0.48 + random.next() * 0.4) * 100) / 100;
        const paid = denied ? 0 : Math.round(allowed * (partial ? 0.55 : 0.8 + random.next() * 0.2) * 100) / 100;
        insertLine.run({
          claim_line_id: `CLN-${String((claimNumber - 1) * 2 + line).padStart(8, '0')}`,
          claim_id: claimId, line_number: line, billed_amount: billed, allowed_amount: allowed, paid_amount: paid,
          diagnosis_category: random.pick(diagnosisCategories),
          procedure_code: imaging ? random.pick(['SYN-IMG-01', 'SYN-IMG-02', 'SYN-IMG-03']) : random.pick(['SYN-OP-01', 'SYN-OP-02', 'SYN-OP-03', 'SYN-OP-04']),
          service_category: serviceCategory
        });
      }
    }
  }
});

transaction();
out.close();
console.log(`Generated ${claimNumber - 1} claims and ${(claimNumber - 1) * 2} claim lines at ${defaultDatabasePath} (seed ${SEED}).`);
