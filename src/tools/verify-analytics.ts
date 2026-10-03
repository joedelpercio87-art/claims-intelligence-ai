import {
  getAuthorizationAnalysis, getClaimsPerformance, getCostUtilization, getDenialAnalysis,
  getMemberPopulationImpact, getProviderPerformance, withAnalyticsDatabase
} from './analytics.js';

function section(title: string, observed: unknown, interpretation: string): void {
  console.log(`\n## ${title}\nOBSERVED FACT\n${JSON.stringify(observed, null, 2)}\n\nINTERPRETATION REQUIRING ADDITIONAL EVIDENCE\n${interpretation}`);
}

withAnalyticsDatabase(db => {
  const claims = getClaimsPerformance({}, db);
  const julSep = claims.filter(r => ['2026-07', '2026-08', '2026-09'].includes(r.month));
  if (julSep.length !== 3) throw new Error('Expected July, August, and September claims results');
  section('Claims performance: July through September 2026', julSep,
    'These are descriptive synthetic claims metrics. Month-to-month differences do not establish their causes or indicate improper conduct.');

  const serviceDenials = getDenialAnalysis({ groupBy: 'serviceCategory' }, db);
  const serviceChanges = serviceDenials.map(r => ({ serviceCategory: r.segment,
    julyDenialRate: getDenialAnalysis({ month: '2026-07', groupBy: 'serviceCategory' }, db).find(x => x.segment === r.segment)?.denialRate,
    augustDenialRate: getDenialAnalysis({ month: '2026-08', groupBy: 'serviceCategory' }, db).find(x => x.segment === r.segment)?.denialRate
  })).map(r => ({ ...r, changePercentagePoints: Number(r.augustDenialRate ?? 0) - Number(r.julyDenialRate ?? 0) }))
    .sort((a, b) => Math.abs(b.changePercentagePoints) - Math.abs(a.changePercentagePoints));
  section('Service categories with largest denial-rate changes', serviceChanges,
    'Rate changes are associations in this generated dataset; differences may reflect mix, sampling variation, and generator assumptions.');

  const denialCategories = getDenialAnalysis({ groupBy: 'denialCategory' }, db);
  const julyCats = getDenialAnalysis({ month: '2026-07', groupBy: 'denialCategory' }, db);
  const augustCats = getDenialAnalysis({ month: '2026-08', groupBy: 'denialCategory' }, db);
  const categoryIncrease = augustCats.map(a => ({ denialCategory: a.segment, julyDenials: Number(julyCats.find(j => j.segment === a.segment)?.denialCount ?? 0), augustDenials: Number(a.denialCount), change: Number(a.denialCount) - Number(julyCats.find(j => j.segment === a.segment)?.denialCount ?? 0) }))
    .filter(r => r.denialCategory !== 'No denial').sort((a, b) => b.change - a.change);
  section('Denial categories contributing most to August increase', { overallDenialCategories: denialCategories, categoryIncrease },
    'The contribution table describes counts in the synthetic data. It does not identify why a denial occurred or whether it was appropriate.');

  const providers = getProviderPerformance({ month: '2026-08' }, db).slice(0, 10);
  section('Providers with largest August denial concentrations', providers,
    'Providers are synthetic. Volume and denial concentration are descriptive signals only and are not evidence of intent, fraud, abuse, or quality of care.');

  const programDenials = ['2026-07', '2026-08', '2026-09'].flatMap(month =>
    getDenialAnalysis({ month, groupBy: 'program' }, db).map(r => ({ month, ...r })));
  const programTotals = new Map<string, { claimLines: number; billed: number; allowed: number; paid: number }>();
  for (const r of getCostUtilization({}, db)) {
    const key = `${r.month}|${r.program}`;
    const value = programTotals.get(key) ?? { claimLines: 0, billed: 0, allowed: 0, paid: 0 };
    value.claimLines += Number(r.claimLineCount); value.billed += Number(r.billedAmount); value.allowed += Number(r.allowedAmount); value.paid += Number(r.paidAmount);
    programTotals.set(key, value);
  }
  section('Medicare Advantage vs Medicaid patterns', { denialByMonthAndProgram: programDenials,
    costAndUtilizationByMonthAndProgram: [...programTotals].map(([key, v]) => { const [month, program] = key.split('|'); return { month, program, claimLines: v.claimLines, billed: round(v.billed), allowed: round(v.allowed), paid: round(v.paid) }; }) },
    'Program differences are unadjusted descriptive comparisons. They do not account for enrollment exposure, member mix, service mix, or other possible explanations.');

  const authorizationRows = getAuthorizationAnalysis({ month: '2026-08', serviceCategory: 'Outpatient imaging' }, db);
  const authorizationMap = new Map<string, { claimLines: number; claims: number; priorAuthorizationDenials: number; deniedClaims: number }>();
  for (const r of authorizationRows) {
    const status = String(r.authorizationStatus);
    const value = authorizationMap.get(status) ?? { claimLines: 0, claims: 0, priorAuthorizationDenials: 0, deniedClaims: 0 };
    value.claimLines += Number(r.claimLineCount); value.claims += Number(r.claimCount);
    value.priorAuthorizationDenials += Number(r.priorAuthorizationDenialCount); value.deniedClaims += Number(r.denialCount);
    authorizationMap.set(status, value);
  }
  const authorization = [...authorizationMap].map(([authorizationStatus, v]) => ({ authorizationStatus, ...v,
    priorAuthorizationDenialRate: v.claims ? round(100 * v.priorAuthorizationDenials / v.claims) : 0 }));
  const statuses = new Set(authorization.map(r => String(r.authorizationStatus)));
  for (const status of ['Approved', 'Denied', 'Expired', 'Pending', 'No linked authorization']) if (!statuses.has(status)) throw new Error(`Missing August imaging authorization status: ${status}`);
  section('August outpatient imaging authorization-status pattern', authorization,
    'An approved authorization associated with a prior-authorization denial is an observed anomaly only. This result does not establish an error, root cause, or causal relationship.');

  const population = getMemberPopulationImpact({}, db);
  section('Synthetic member population segments most affected', population.slice(0, 15),
    'Only aggregated synthetic attributes are shown. Segment comparisons are unadjusted and do not establish causation, member fault, or individual impact.');

  const costs = getCostUtilization({}, db);
  const monthlyTotals = new Map<string, { billed: number; allowed: number; paid: number; claimLines: number }>();
  for (const r of costs) {
    const m = monthlyTotals.get(String(r.month)) ?? { billed: 0, allowed: 0, paid: 0, claimLines: 0 };
    m.billed += Number(r.billedAmount); m.allowed += Number(r.allowedAmount); m.paid += Number(r.paidAmount); m.claimLines += Number(r.claimLineCount);
    monthlyTotals.set(String(r.month), m);
  }
  section('Cost and utilization changes', [...monthlyTotals].map(([month, v]) => ({ month, billed: round(v.billed), allowed: round(v.allowed), paid: round(v.paid), claimLines: v.claimLines })),
    'Amounts and claim-line counts are synthetic. No PMPM is calculated because enrollment periods and member-month denominators are not available.');
});

function round(n: number): number { return Math.round(n * 100) / 100; }

console.log('\nPASS: all six analytics tools returned results and required August authorization statuses were present.');
