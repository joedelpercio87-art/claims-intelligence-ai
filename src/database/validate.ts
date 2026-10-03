import { openDatabase } from './connection.js';

const db = openDatabase();
try {
  const tables = ['members', 'providers', 'authorizations', 'claims', 'claim_lines'];
  console.log('ROW COUNTS');
  for (const table of tables) {
    const result = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    console.log(`${table}: ${result.count.toLocaleString()}`);
  }

  console.log('\nCLAIMS AND DENIAL METRICS BY SERVICE MONTH (claim-line weighted)');
  const monthly = db.prepare(`
    SELECT substr(c.service_date, 1, 7) AS month,
      COUNT(*) AS claim_lines,
      COUNT(DISTINCT c.claim_id) AS claims,
      ROUND(100.0 * SUM(CASE WHEN c.claim_status = 'Denied' THEN 1 ELSE 0 END) / COUNT(*), 2) AS denial_rate_pct,
      ROUND(100.0 * SUM(CASE WHEN l.service_category = 'Outpatient imaging' AND c.claim_status = 'Denied' THEN 1 ELSE 0 END) /
        NULLIF(SUM(CASE WHEN l.service_category = 'Outpatient imaging' THEN 1 ELSE 0 END), 0), 2) AS imaging_denial_rate_pct,
      ROUND(AVG(c.processing_days), 2) AS avg_processing_days
    FROM claims c JOIN claim_lines l ON l.claim_id = c.claim_id
    GROUP BY month ORDER BY month
  `).all() as Array<Record<string, string | number>>;
  console.table(monthly);

  console.log('\nDENIAL CATEGORIES BY MONTH');
  const categories = db.prepare(`
    SELECT substr(service_date, 1, 7) AS month, COALESCE(denial_category, 'No denial') AS denial_category,
      COUNT(*) AS claims
    FROM claims GROUP BY month, denial_category ORDER BY month, claims DESC
  `).all();
  console.table(categories);

  console.log('\nPROGRAM PERFORMANCE BY MONTH');
  const program = db.prepare(`
    SELECT substr(c.service_date, 1, 7) AS month, c.program, COUNT(*) AS claim_lines,
      ROUND(100.0 * SUM(CASE WHEN c.claim_status = 'Denied' THEN 1 ELSE 0 END) / COUNT(*), 2) AS denial_rate_pct,
      ROUND(AVG(c.processing_days), 2) AS avg_processing_days
    FROM claims c JOIN claim_lines l ON l.claim_id = c.claim_id
    GROUP BY month, c.program ORDER BY month, c.program
  `).all();
  console.table(program);

  console.log('\nTOP PROVIDER CONCENTRATIONS FOR AUGUST DENIALS');
  const providers = db.prepare(`
    SELECT c.provider_id, p.provider_type, p.specialty, COUNT(*) AS august_claim_lines,
      SUM(CASE WHEN c.claim_status = 'Denied' THEN 1 ELSE 0 END) AS denied_lines,
      ROUND(100.0 * SUM(CASE WHEN c.claim_status = 'Denied' THEN 1 ELSE 0 END) / COUNT(*), 2) AS denial_rate_pct,
      SUM(CASE WHEN c.denial_category = 'Prior authorization' THEN 1 ELSE 0 END) AS authorization_denied_lines
    FROM claims c JOIN claim_lines l ON l.claim_id = c.claim_id JOIN providers p ON p.provider_id = c.provider_id
    WHERE substr(c.service_date, 1, 7) = '2026-08'
    GROUP BY c.provider_id ORDER BY denied_lines DESC LIMIT 12
  `).all();
  console.table(providers);

  console.log('\nAUTHORIZATION RELATED OUTCOMES');
  const auth = db.prepare(`
    SELECT substr(c.service_date, 1, 7) AS month, l.service_category,
      COALESCE(a.authorization_status, 'No linked authorization') AS authorization_status,
      c.denial_category, COUNT(*) AS claim_lines
    FROM claims c JOIN claim_lines l ON l.claim_id = c.claim_id
    LEFT JOIN authorizations a ON a.authorization_id = c.authorization_id
    WHERE l.service_category = 'Outpatient imaging'
    GROUP BY month, l.service_category, authorization_status, c.denial_category
    ORDER BY month, authorization_status, claim_lines DESC
  `).all();
  console.table(auth);

  console.log('\nFOREIGN KEY INTEGRITY');
  const violations = db.pragma('foreign_key_check') as unknown[];
  console.log(violations.length === 0 ? 'PASS: no foreign-key violations' : violations);
} finally {
  db.close();
}
