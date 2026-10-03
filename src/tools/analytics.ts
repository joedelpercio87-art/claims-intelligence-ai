import Database from 'better-sqlite3';
import { defaultDatabasePath } from '../database/connection.js';

export type Program = 'Medicare Advantage' | 'Medicaid';
export type AnalyticsFilters = {
  month?: string;
  fromDate?: string;
  toDate?: string;
  program?: Program;
  serviceCategory?: string;
  providerId?: string;
};
export type AnalyticsRow = Record<string, string | number | null>;
export type MonthlyMetric = {
  month: string;
  claimCount: number;
  claimLineCount: number;
  billedAmount: number;
  allowedAmount: number;
  paidAmount: number;
  denialCount: number;
  denialRate: number;
  averageProcessingDays: number;
  comparisonToPreviousMonth: Record<string, number | null> | null;
};

const PROGRAMS = ['Medicare Advantage', 'Medicaid'];
const SERVICES = ['Outpatient imaging', 'Primary care', 'Emergency', 'Inpatient', 'Behavioral health', 'Laboratory', 'Specialty care'];
const AGE_BANDS = ['0-17', '18-34', '35-49', '50-64', '65-74', '75+'];
const REGIONS = ['Northeast', 'Midwest', 'South', 'West'];
const RISKS = ['Lower', 'Moderate', 'Higher'];
const defaultAnalyticsDatabase = new Database(defaultDatabasePath, { readonly: true, fileMustExist: true });
defaultAnalyticsDatabase.pragma('query_only = ON');

function validateFilters(filters: AnalyticsFilters = {}): void {
  if (filters.month !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(filters.month)) throw new Error('month must use YYYY-MM format');
  for (const [name, value] of [['fromDate', filters.fromDate], ['toDate', filters.toDate]] as const) {
    if (value !== undefined) {
      const parsed = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${name} must be a valid YYYY-MM-DD date`);
    }
  }
  if (filters.fromDate && filters.toDate && filters.fromDate > filters.toDate) throw new Error('fromDate must be on or before toDate');
  if (filters.month && (filters.fromDate || filters.toDate)) throw new Error('month cannot be combined with fromDate or toDate');
  if (filters.program !== undefined && !PROGRAMS.includes(filters.program)) throw new Error('Unsupported program');
  if (filters.serviceCategory !== undefined && !SERVICES.includes(filters.serviceCategory)) throw new Error('Unsupported serviceCategory');
  if (filters.providerId !== undefined && (filters.providerId.length > 32 || !/^PRV-\d{4}$/.test(filters.providerId))) throw new Error('providerId must use PRV-0000 format');
}

function predicates(filters: AnalyticsFilters, alias = 'c'): { sql: string; params: Array<string | number> } {
  validateFilters(filters);
  const parts: string[] = [];
  const params: Array<string | number> = [];
  if (filters.month) { parts.push(`substr(${alias}.service_date, 1, 7) = ?`); params.push(filters.month); }
  if (filters.fromDate) { parts.push(`${alias}.service_date >= ?`); params.push(filters.fromDate); }
  if (filters.toDate) { parts.push(`${alias}.service_date <= ?`); params.push(filters.toDate); }
  if (filters.program) { parts.push(`${alias}.program = ?`); params.push(filters.program); }
  if (filters.serviceCategory) { parts.push('l.service_category = ?'); params.push(filters.serviceCategory); }
  if (filters.providerId) { parts.push(`${alias}.provider_id = ?`); params.push(filters.providerId); }
  return { sql: parts.length ? ` AND ${parts.join(' AND ')}` : '', params };
}

function rows(db: Database.Database, sql: string, params: Array<string | number>): AnalyticsRow[] {
  return db.prepare(sql).all(...params) as AnalyticsRow[];
}
const round = (n: number): number => Math.round(n * 100) / 100;

export function getClaimsPerformance(filters: AnalyticsFilters = {}, db: Database.Database = defaultAnalyticsDatabase): MonthlyMetric[] {
  const where = predicates(filters);
  const data = rows(db, `SELECT substr(c.service_date,1,7) month, COUNT(DISTINCT c.claim_id) claimCount, COUNT(*) claimLineCount,
    ROUND(SUM(l.billed_amount),2) billedAmount, ROUND(SUM(l.allowed_amount),2) allowedAmount, ROUND(SUM(l.paid_amount),2) paidAmount,
    COUNT(DISTINCT CASE WHEN c.claim_status='Denied' THEN c.claim_id END) denialCount,
    ROUND(100.0*COUNT(DISTINCT CASE WHEN c.claim_status='Denied' THEN c.claim_id END)/NULLIF(COUNT(DISTINCT c.claim_id),0),2) denialRate,
    ROUND(AVG(c.processing_days),2) averageProcessingDays
    FROM claims c JOIN claim_lines l ON l.claim_id=c.claim_id WHERE 1=1${where.sql} GROUP BY month ORDER BY month`, where.params);
  return data.map((r, i) => {
    const previous = data[i - 1];
    const metricKeys = ['claimCount', 'claimLineCount', 'billedAmount', 'allowedAmount', 'paidAmount', 'denialCount', 'denialRate', 'averageProcessingDays'];
    const comparisonToPreviousMonth = previous ? Object.fromEntries(metricKeys.map(k => [k, round(Number(r[k]) - Number(previous[k]))])) : null;
    return { month: String(r.month), claimCount: Number(r.claimCount), claimLineCount: Number(r.claimLineCount), billedAmount: Number(r.billedAmount), allowedAmount: Number(r.allowedAmount), paidAmount: Number(r.paidAmount), denialCount: Number(r.denialCount), denialRate: Number(r.denialRate), averageProcessingDays: Number(r.averageProcessingDays), comparisonToPreviousMonth };
  });
}

export type DenialDimension = 'month' | 'denialCategory' | 'serviceCategory' | 'provider' | 'program';
export function getDenialAnalysis(options: AnalyticsFilters & { groupBy?: DenialDimension } = {}, db: Database.Database = defaultAnalyticsDatabase): AnalyticsRow[] {
  const { groupBy = 'month', ...filters } = options;
  const columns: Record<DenialDimension, string> = { month: "substr(c.service_date,1,7)", denialCategory: "COALESCE(c.denial_category,'No denial')", serviceCategory: 'l.service_category', provider: 'c.provider_id', program: 'c.program' };
  if (!(groupBy in columns)) throw new Error('Unsupported groupBy');
  const where = predicates(filters);
  return rows(db, `WITH base AS (SELECT ${columns[groupBy]} AS segment, c.claim_id, c.claim_status FROM claims c JOIN claim_lines l ON l.claim_id=c.claim_id WHERE 1=1${where.sql}),
    counts AS (SELECT segment, COUNT(DISTINCT claim_id) claimCount, COUNT(DISTINCT CASE WHEN claim_status='Denied' THEN claim_id END) denialCount FROM base GROUP BY segment),
    total AS (SELECT SUM(denialCount) allDenials FROM counts)
    SELECT segment, claimCount, denialCount, ROUND(100.0*denialCount/NULLIF(${groupBy === 'denialCategory' ? '(SELECT SUM(claimCount) FROM counts)' : 'claimCount'},0),2) denialRate,
    ROUND(100.0*denialCount/NULLIF((SELECT allDenials FROM total),0),2) shareOfDenials FROM counts ORDER BY denialCount DESC, segment`, where.params);
}

export function getProviderPerformance(filters: AnalyticsFilters = {}, db: Database.Database = defaultAnalyticsDatabase): AnalyticsRow[] {
  const where = predicates(filters);
  return rows(db, `SELECT c.provider_id providerId, p.provider_type providerType, p.specialty, substr(c.service_date,1,7) month,
    COUNT(DISTINCT c.claim_id) claimCount, COUNT(*) claimLineCount,
    COUNT(DISTINCT CASE WHEN c.claim_status='Denied' THEN c.claim_id END) denialCount,
    ROUND(100.0*COUNT(DISTINCT CASE WHEN c.claim_status='Denied' THEN c.claim_id END)/NULLIF(COUNT(DISTINCT c.claim_id),0),2) denialRate,
    ROUND(SUM(l.billed_amount),2) billedAmount, ROUND(SUM(l.allowed_amount),2) allowedAmount, ROUND(SUM(l.paid_amount),2) paidAmount,
    COUNT(DISTINCT CASE WHEN c.denial_category='Prior authorization' THEN c.claim_id END) priorAuthorizationDenialCount,
    ROUND(100.0*COUNT(DISTINCT CASE WHEN c.denial_category='Prior authorization' THEN c.claim_id END)/NULLIF(COUNT(DISTINCT c.claim_id),0),2) priorAuthorizationDenialRate,
    GROUP_CONCAT(DISTINCT l.service_category) serviceCategoryMix
    FROM claims c JOIN claim_lines l ON l.claim_id=c.claim_id JOIN providers p ON p.provider_id=c.provider_id WHERE 1=1${where.sql}
    GROUP BY c.provider_id, p.provider_type, p.specialty, month ORDER BY denialCount DESC, providerId`, where.params);
}

export function getCostUtilization(filters: AnalyticsFilters = {}, db: Database.Database = defaultAnalyticsDatabase): AnalyticsRow[] {
  const where = predicates(filters);
  return rows(db, `SELECT substr(c.service_date,1,7) month, c.program, l.service_category serviceCategory,
    COUNT(DISTINCT c.claim_id) claimCount, COUNT(*) claimLineCount, ROUND(SUM(l.billed_amount),2) billedAmount,
    ROUND(SUM(l.allowed_amount),2) allowedAmount, ROUND(SUM(l.paid_amount),2) paidAmount,
    ROUND(AVG(l.billed_amount),2) billedPerLine, ROUND(AVG(l.allowed_amount),2) allowedPerLine, ROUND(AVG(l.paid_amount),2) paidPerLine
    FROM claims c JOIN claim_lines l ON l.claim_id=c.claim_id WHERE 1=1${where.sql}
    GROUP BY month,c.program,l.service_category ORDER BY month,c.program,serviceCategory`, where.params);
}

export function getAuthorizationAnalysis(filters: AnalyticsFilters = {}, db: Database.Database = defaultAnalyticsDatabase): AnalyticsRow[] {
  const where = predicates(filters);
  return rows(db, `SELECT substr(c.service_date,1,7) month, COALESCE(a.authorization_status,'No linked authorization') authorizationStatus,
    l.service_category serviceCategory, c.provider_id providerId, c.program,
    COUNT(*) claimLineCount, COUNT(DISTINCT c.claim_id) claimCount,
    COUNT(DISTINCT CASE WHEN c.denial_category='Prior authorization' THEN c.claim_id END) priorAuthorizationDenialCount,
    ROUND(100.0*COUNT(DISTINCT CASE WHEN c.denial_category='Prior authorization' THEN c.claim_id END)/NULLIF(COUNT(DISTINCT c.claim_id),0),2) priorAuthorizationDenialRate,
    COUNT(DISTINCT CASE WHEN c.claim_status='Denied' THEN c.claim_id END) denialCount
    FROM claims c JOIN claim_lines l ON l.claim_id=c.claim_id LEFT JOIN authorizations a ON a.authorization_id=c.authorization_id
    WHERE 1=1${where.sql} GROUP BY month,authorizationStatus,serviceCategory,providerId,c.program ORDER BY month,serviceCategory,authorizationStatus,providerId`, where.params);
}

export type MemberPopulationFilters = AnalyticsFilters & { ageBand?: string; region?: string; riskCategory?: string };
export function getMemberPopulationImpact(filters: MemberPopulationFilters = {}, db: Database.Database = defaultAnalyticsDatabase): AnalyticsRow[] {
  const { ageBand, region, riskCategory, ...claimFilters } = filters;
  const where = predicates(claimFilters);
  if (ageBand !== undefined && !AGE_BANDS.includes(ageBand)) throw new Error('Unsupported ageBand');
  if (region !== undefined && !REGIONS.includes(region)) throw new Error('Unsupported region');
  if (riskCategory !== undefined && !RISKS.includes(riskCategory)) throw new Error('Unsupported riskCategory');
  const extra: string[] = [];
  const params: Array<string | number> = [...where.params];
  if (ageBand) { extra.push('m.age_band=?'); params.push(ageBand); }
  if (region) { extra.push('m.region=?'); params.push(region); }
  if (riskCategory) { extra.push('m.risk_category=?'); params.push(riskCategory); }
  return rows(db, `SELECT m.program,m.age_band ageBand,m.region,m.risk_category riskCategory,l.service_category serviceCategory,
    COUNT(DISTINCT m.member_id) memberCount,COUNT(DISTINCT c.claim_id) claimCount,COUNT(*) claimLineCount,
    COUNT(DISTINCT CASE WHEN c.claim_status='Denied' THEN c.claim_id END) denialCount,
    ROUND(100.0*COUNT(DISTINCT CASE WHEN c.claim_status='Denied' THEN c.claim_id END)/NULLIF(COUNT(DISTINCT c.claim_id),0),2) denialRate,
    ROUND(SUM(l.billed_amount),2) billedAmount,ROUND(SUM(l.allowed_amount),2) allowedAmount,ROUND(SUM(l.paid_amount),2) paidAmount
    FROM claims c JOIN claim_lines l ON l.claim_id=c.claim_id JOIN members m ON m.member_id=c.member_id WHERE 1=1${where.sql}${extra.length ? ` AND ${extra.join(' AND ')}` : ''}
    GROUP BY m.program,m.age_band,m.region,m.risk_category,l.service_category ORDER BY denialCount DESC,memberCount DESC`, params);
}

export function withAnalyticsDatabase<T>(fn: (db: Database.Database) => T): T {
  const db = new Database(defaultDatabasePath, { readonly: true, fileMustExist: true });
  try { return fn(db); } finally { db.close(); }
}
