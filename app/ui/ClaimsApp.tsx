import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BadgeCheck, BarChart3, BookOpen,
  Check, ChevronDown, CircleHelp, ClipboardList, Clock3, Database, FileSearch, Fingerprint,
  HeartPulse, LockKeyhole, MessageSquareText, Network, Send, ShieldCheck, Sparkles,
  Stethoscope, Workflow, X
} from 'lucide-react';

type Metric = {
  month: string; claimCount: number; claimLineCount: number; denialRate: number;
  denialCount: number; averageProcessingDays: number;
  comparisonToPreviousMonth: Record<string, number | null> | null;
};
type PolicyEvidence = {
  sourceFilename: string; policyTitle: string; sectionHeading: string;
  similarityScore: number; passage: string;
};
type McpEvent = {
  evidenceId: string; tool: string; parameters: Record<string, unknown>;
  resultRowCount: number | null; returnedToModel: boolean; resultPreview?: unknown[];
};
type Investigation = {
  question: string; answer: string; evidenceGaps: string[];
  unsupportedCausationAppeared: boolean; responsibleAiBoundariesPreserved: boolean;
  mcpCallCount: number; policySearchCount: number;
  trace: { mcpCalls: McpEvent[]; policySearches: Array<{
    evidenceId: string; query: string; topK: number; minSimilarity: number; resultCount: number; results: PolicyEvidence[]
  }> };
};
type Dashboard = { reportingPeriod: string; comparisonPeriod: string; overall: Metric[]; imaging: Metric[] };

const questions = [
  'Something changed in our claims performance in August 2026. Investigate the data and tell me what you find.',
  'Why did denial performance deteriorate in August 2026, and what actions should management take according to company policy?',
  'What is unusual about prior-authorization denials for outpatient imaging in August?',
  'Which service categories experienced the largest deterioration in August?',
  'Can AI automatically deny these claims?'
];

const sectionHeadings = [
  { match: /^OBSERVED FACTS?$/i, title: 'Observed operational facts', icon: Activity, tone: 'teal' },
  { match: /^OBSERVED OPERATIONAL FACTS?$/i, title: 'Observed operational facts', icon: Activity, tone: 'teal' },
  { match: /^INTERPRETATION REQUIRING ADDITIONAL EVIDENCE$/i, title: 'Evidence-based interpretation', icon: FileSearch, tone: 'blue' },
  { match: /^MANAGEMENT ACTIONS(?: UNDER FICTIONAL INTERNAL COMPANY POLICY)?$/i, title: 'Recommended management actions', icon: ClipboardList, tone: 'gold' },
  { match: /^RECOMMENDED MANAGEMENT ACTIONS$/i, title: 'Recommended management actions', icon: ClipboardList, tone: 'gold' },
  { match: /^APPLICABLE FICTIONAL POLICY$/i, title: 'Applicable fictional policy', icon: BookOpen, tone: 'violet' }
] as const;

function splitAnswer(answer: string) {
  const blocks: Array<{ title: string; content: string; icon?: typeof Activity; tone?: string }> = [];
  let title = 'Executive summary';
  let content: string[] = [];
  const flush = () => {
    const text = content.join('\n').trim();
    if (text) {
      const heading = sectionHeadings.find(section => section.title === title);
      blocks.push({ title, content: text, icon: heading?.icon, tone: heading?.tone });
    }
    content = [];
  };
  for (const line of answer.split(/\r?\n/)) {
    const normalized = line.trim();
    const found = sectionHeadings.find(section => section.match.test(normalized));
    if (found) {
      flush();
      title = found.title;
    } else content.push(line);
  }
  flush();
  if (blocks.length === 1 && blocks[0]?.title === 'Executive summary') return blocks;
  const lead = blocks.find(block => block.title === 'Executive summary');
  if (!lead) {
    const observed = blocks.find(block => block.title === 'Observed operational facts');
    const firstParagraph = observed?.content.split(/\n\s*\n/)[0]?.trim();
    if (firstParagraph) blocks.unshift({ title: 'Executive summary', content: firstParagraph, tone: 'summary' });
  }
  return blocks;
}

function AnswerBody({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const result: React.ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!.trim();
    if (!line) { index++; continue; }
    if (line.startsWith('|')) {
      const table: string[][] = [];
      while (index < lines.length && lines[index]!.trim().startsWith('|')) {
        const cells = lines[index]!.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
        if (!cells.every(cell => /^:?-{2,}:?$/.test(cell))) table.push(cells);
        index++;
      }
      const [head, ...rows] = table;
      if (head) result.push(<div className="answer-table-wrap" key={`table-${index}`}><table className="answer-table"><thead><tr>{head.map((cell, i) => <th key={i}>{cell}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index]!)) items.push(lines[index++]!.replace(/^\s*[-*]\s+/, ''));
      result.push(<ul key={`ul-${index}`}>{items.map((item, i) => <li key={i}>{item}</li>)}</ul>);
      continue;
    }
    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index]!)) items.push(lines[index++]!.replace(/^\s*\d+[.)]\s+/, ''));
      result.push(<ol key={`ol-${index}`}>{items.map((item, i) => <li key={i}>{item}</li>)}</ol>);
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index]!.trim() && !lines[index]!.trim().startsWith('|') && !/^\s*[-*]\s+/.test(lines[index]!) && !/^\s*\d+[.)]\s+/.test(lines[index]!)) paragraph.push(lines[index++]!.trim());
    result.push(<p key={`p-${index}`}>{paragraph.join(' ')}</p>);
  }
  return <div className="answer-body">{result}</div>;
}

function formatNumber(value: number | null | undefined, digits = 2) {
  return typeof value === 'number' ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
}
function changeLabel(value: number | null | undefined, suffix: string) {
  if (typeof value !== 'number') return 'Compared with July';
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatNumber(value)} ${suffix} vs July`;
}

async function readDashboard(): Promise<Dashboard> {
  const response = await fetch('/api/dashboard');
  if (!response.ok) throw new Error('August metrics are temporarily unavailable.');
  return response.json() as Promise<Dashboard>;
}

function stageName(event: McpEvent) {
  if (event.tool === 'getClaimsPerformance') return 'Claims performance';
  if (event.tool === 'getDenialAnalysis') {
    return event.parameters.groupBy === 'serviceCategory' || event.parameters.serviceCategory ? 'Service category analysis' : 'Denial analysis';
  }
  if (event.tool === 'getProviderPerformance' || event.parameters.groupBy === 'provider' || event.parameters.providerId) return 'Provider analysis';
  if (event.tool === 'getAuthorizationAnalysis') return 'Authorization analysis';
  if (event.tool === 'getCostUtilization') return 'Cost & utilization';
  if (event.tool === 'getMemberPopulationImpact') return 'Population impact';
  return 'Operational analytics';
}
const stageOrder = ['Claims performance', 'Denial analysis', 'Service category analysis', 'Provider analysis', 'Authorization analysis', 'Cost & utilization', 'Population impact', 'Policy retrieval', 'Final synthesis'];

function TraceStage({ title, children, count }: { title: string; children: React.ReactNode; count: number }) {
  return <details className="trace-stage">
    <summary><span className="trace-stage-title"><span className="trace-dot" />{title}</span><span className="trace-stage-meta">{count} {count === 1 ? 'event' : 'events'} <ChevronDown size={15} /></span></summary>
    <div className="trace-stage-content">{children}</div>
  </details>;
}

function ClaimsApp() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [dashboardError, setDashboardError] = useState('');
  const [question, setQuestion] = useState('');
  const [investigation, setInvestigation] = useState<Investigation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { readDashboard().then(setDashboard).catch(error => setDashboardError(error instanceof Error ? error.message : 'Metrics unavailable.')); }, []);

  const sections = useMemo(() => investigation ? splitAnswer(investigation.answer) : [], [investigation]);
  const outOfScope = !!investigation && investigation.mcpCallCount === 0 && investigation.policySearchCount === 0;
  const overall = dashboard?.overall.find(metric => metric.month === '2026-08');
  const imaging = dashboard?.imaging.find(metric => metric.month === '2026-08');

  async function submitQuestion(value = question) {
    const trimmed = value.trim();
    if (trimmed.length < 8 || busy) return;
    setQuestion(trimmed);
    setBusy(true); setError(''); setInvestigation(null);
    try {
      const response = await fetch('/api/investigate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed })
      });
      const body = await response.json() as Investigation | { error?: string };
      if (!response.ok || !('answer' in body)) throw new Error(('error' in body && body.error) || 'The investigation could not be completed.');
      setInvestigation(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The investigation could not be completed.');
    } finally { setBusy(false); }
  }

  function onSubmit(event: FormEvent) { event.preventDefault(); void submitQuestion(); }
  function onQuestionKey(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submitQuestion(); }
  }

  const traceGroups = useMemo(() => {
    if (!investigation) return [];
    const grouped = new Map<string, McpEvent[]>();
    for (const call of investigation.trace.mcpCalls) {
      const stage = stageName(call);
      grouped.set(stage, [...(grouped.get(stage) ?? []), call]);
    }
    const groups = [...grouped.entries()].map(([name, calls]) => ({ name, calls, count: calls.length }));
    for (const search of investigation.trace.policySearches) groups.push({ name: 'Policy retrieval', calls: [], count: search.results.length || 1 });
    groups.push({ name: 'Final synthesis', calls: [], count: 1 });
    return groups.sort((a, b) => stageOrder.indexOf(a.name) - stageOrder.indexOf(b.name));
  }, [investigation]);

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-lockup">
        <div className="brand-mark"><Activity size={21} strokeWidth={2.1} /></div>
        <div><div className="brand-name">CLAIMS <span>INTELLIGENCE</span> AI</div><div className="brand-subtitle">Governed Healthcare Claims Investigation</div></div>
      </div>
      <div className="topbar-right">
        <div className="reporting-period"><span>REPORTING PERIOD</span><strong>August 2026</strong></div>
        <div className="top-divider" />
        <div className="trust-pills"><span><span className="status-dot" />Synthetic data</span><span>No PHI</span><span>Decision support only</span></div>
      </div>
    </header>

    <main className="page-content">
      <section className="welcome-row">
        <div><div className="eyebrow"><span className="eyebrow-line" />EXECUTIVE OVERVIEW <span className="eyebrow-date">JULY — AUGUST 2026</span></div>
          <h1>Claims performance, <span>in context.</span></h1>
          <p className="welcome-copy">Explore synthetic operational trends with governed analytics and traceable evidence.</p>
        </div>
        <div className="overview-stamp"><div className="stamp-icon"><BarChart3 size={19} /></div><div><span>DATASET STATUS</span><strong><i /> Ready for investigation</strong></div></div>
      </section>

      <section className="kpi-grid" aria-label="August synthetic claims metrics">
        <article className="kpi-card kpi-primary"><div className="kpi-top"><span>OVERALL DENIAL RATE</span><span className="kpi-icon"><Activity size={17} /></span></div>
          <div className="kpi-value">{overall ? `${formatNumber(overall.denialRate)}%` : '—'}</div><div className="kpi-foot"><span className="delta-up"><ArrowUpRight size={14} />{changeLabel(overall?.comparisonToPreviousMonth?.denialRate, 'pp')}</span><span>vs July · {overall ? formatNumber(overall.claimCount, 0) : '—'} claims</span></div></article>
        <article className="kpi-card"><div className="kpi-top"><span>AVERAGE PROCESSING TIME</span><span className="kpi-icon"><Clock3 size={17} /></span></div>
          <div className="kpi-value">{overall ? `${formatNumber(overall.averageProcessingDays, 1)} <small>days</small>` : '—'}</div><div className="kpi-foot"><span className="delta-up"><ArrowUpRight size={14} />{changeLabel(overall?.comparisonToPreviousMonth?.averageProcessingDays, 'days')}</span><span>service month average</span></div></article>
        <article className="kpi-card kpi-accent"><div className="kpi-top"><span>OUTPATIENT IMAGING DENIAL RATE</span><span className="kpi-icon"><HeartPulse size={17} /></span></div>
          <div className="kpi-value">{imaging ? `${formatNumber(imaging.denialRate)}%` : '—'}</div><div className="kpi-foot"><span className="delta-up"><ArrowUpRight size={14} />{changeLabel(imaging?.comparisonToPreviousMonth?.denialRate, 'pp')}</span><span>{imaging ? formatNumber(imaging.claimCount, 0) : '—'} claims in August</span></div></article>
        <article className="kpi-card kpi-neutral"><div className="kpi-top"><span>DENIAL VOLUME</span><span className="kpi-icon"><BarChart3 size={17} /></span></div>
          <div className="kpi-value">{overall ? formatNumber(overall.denialCount, 0) : '—'}</div><div className="kpi-foot"><span className="delta-up"><ArrowUpRight size={14} />{overall?.comparisonToPreviousMonth?.denialCount !== undefined ? `+${formatNumber(overall.comparisonToPreviousMonth.denialCount, 0)} claims` : 'July comparison'}</span><span>synthetic August claims</span></div></article>
      </section>
      {dashboardError && <div className="metric-note"><CircleHelp size={15} />{dashboardError}</div>}
      <div className="kpi-caption"><span><span className="caption-dot" />Synthetic August 2026 metrics</span><span>Compared with July 2026 · Values served through governed MCP analytics</span></div>

      <section className="investigation-layout" id="investigate">
        <div className="ask-panel">
          <div className="ask-heading"><div className="ask-icon"><Sparkles size={19} /></div><div><div className="ask-kicker">ASK CLAIMS INTELLIGENCE AI</div><h2>What would you like to investigate?</h2></div></div>
          <p className="ask-description">Ask a claims operations question. The agent will retrieve only relevant analytics and, when useful, fictional policy evidence.</p>
          <form onSubmit={onSubmit} className="question-form">
            <label className="sr-only" htmlFor="question">Your investigation question</label>
            <textarea ref={inputRef} id="question" value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={onQuestionKey} maxLength={2000} placeholder="Ask about claims performance, denials, authorizations, or policy…" rows={3} disabled={busy} />
            <div className="composer-footer"><span><LockKeyhole size={13} />Do not enter PHI or member identifiers</span><button className="submit-button" type="submit" disabled={busy || question.trim().length < 8}>{busy ? <><span className="button-spinner" />Investigating</> : <>Investigate <Send size={15} /></>}</button></div>
          </form>
          <div className="example-header"><span>EXAMPLE INVESTIGATIONS</span><span>SELECT TO ASK <ArrowRight size={12} /></span></div>
          <div className="example-list">{questions.map((example, index) => <button key={example} type="button" className="example-question" onClick={() => { setQuestion(example); inputRef.current?.focus(); }}>
            <span className="example-index">0{index + 1}</span><span>{example}</span><ArrowRight size={15} className="example-arrow" />
          </button>)}</div>
          <p className="composer-hint"><span>↵</span> to submit <span className="hint-separator">·</span> Shift + ↵ for a new line</p>
        </div>

        <aside className="trust-panel">
          <div className="trust-panel-head"><span className="trust-shield"><ShieldCheck size={18} /></span><div><span>GOVERNANCE BY DESIGN</span><h3>Evidence you can inspect.</h3></div></div>
          <p className="trust-intro">A decision-support workflow designed to keep data, policy, and human judgment in their proper roles.</p>
          <div className="trust-items">
            <div><span><Database size={15} /></span><p><strong>Synthetic data only</strong><small>No PHI or live claims data</small></p><Check size={15} /></div>
            <div><span><Network size={15} /></span><p><strong>Governed MCP analytics</strong><small>Validated, read-only tools</small></p><Check size={15} /></div>
            <div><span><FileSearch size={15} /></span><p><strong>Policy retrieval through RAG</strong><small>Relevant passages with provenance</small></p><Check size={15} /></div>
            <div><span><Fingerprint size={15} /></span><p><strong>Human decision authority</strong><small>No autonomous claim adjudication</small></p><Check size={15} /></div>
          </div>
          <div className="trust-footer"><Workflow size={15} /><span>Observed evidence stays distinct from interpretation.</span></div>
        </aside>
      </section>

      {(busy || error || investigation) && <section className="results-section" aria-live="polite">
        <div className="results-topline"><div><div className="eyebrow"><span className="eyebrow-line" />INVESTIGATION WORKSPACE</div><h2>{busy ? 'Following the evidence' : error ? 'Investigation status' : 'Investigation result'}</h2></div>
          {investigation && <div className="result-badges"><span><Check size={13} />Evidence trace captured</span><span>{investigation.mcpCallCount} MCP calls</span>{investigation.policySearchCount > 0 && <span>{investigation.policySearchCount} policy {investigation.policySearchCount === 1 ? 'search' : 'searches'}</span>}</div>}
        </div>
        {busy && <div className="working-card"><span className="working-pulse"><Stethoscope size={19} /></span><div><strong>Investigating your question</strong><p>Gathering relevant operational evidence and policy context. This may take a moment.</p></div><span className="working-dots"><i /><i /><i /></span></div>}
        {error && <div className="error-card"><X size={18} /><div><strong>The investigation could not be completed.</strong><p>{error}</p></div></div>}
        {investigation && <>
          {outOfScope && <div className="scope-note"><CircleHelp size={17} /><span>This question is outside the claims operations and policy scope. No analytics or policy evidence was retrieved.</span></div>}
          {investigation.unsupportedCausationAppeared ? <div className="evidence-note evidence-note-attention"><CircleHelp size={17} /><div><strong>Additional evidence is needed.</strong><p>The agent flagged a causal or wrongdoing statement for review. See the answer and evidence gaps below.</p></div></div> : <div className="evidence-note"><ShieldCheck size={17} /><div><strong>Evidence boundary preserved</strong><p>Observed patterns are presented separately from interpretation. No unsupported causal conclusion was flagged.</p></div></div>}
          <div className="answer-grid">
            <div className="answer-column"><div className="answer-cards">{sections.map((section, index) => <article key={`${section.title}-${index}`} className={`answer-card tone-${section.tone ?? 'plain'}`}>
              <div className="answer-card-title">{section.icon && <span className="answer-title-icon"><section.icon size={15} /></span>}<span>{section.title}</span>{section.title === 'Applicable fictional policy' && <span className="fictional-pill">FICTIONAL</span>}</div>
              <AnswerBody text={section.content} />
            </article>)}</div>
              <article className="gaps-card"><div className="gaps-heading"><span><CircleHelp size={15} /></span><div><strong>Evidence gaps / limitations</strong><small>What the available evidence cannot establish</small></div></div>
                {investigation.evidenceGaps.length ? <ul>{investigation.evidenceGaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul> : <p className="no-gaps">No additional evidence gaps were reported by the agent.</p>}
              </article>
            </div>
            <aside className="trace-column">
              <div className="trace-panel"><div className="trace-panel-heading"><div><span className="trace-kicker">OBSERVABLE INVESTIGATION TRACE</span><h3>Evidence path</h3></div><span className="trace-lock"><LockKeyhole size={14} />AUDITABLE</span></div>
                <p className="trace-caption">A record of the capabilities used. This trace does not include private model reasoning.</p>
                <div className="trace-timeline">
                  {traceGroups.map(group => <TraceStage key={group.name} title={group.name} count={group.count}>
                    {group.calls.map(call => <div className="trace-event" key={call.evidenceId}>
                      <div className="trace-event-top"><span className="event-id">{call.evidenceId}</span><strong>{call.tool}</strong></div>
                      <div className="trace-event-label">Validated parameters</div><pre>{JSON.stringify(call.parameters, null, 2)}</pre>
                      <div className="trace-result-line"><span>{call.resultRowCount === null ? 'Result format unavailable' : `${call.resultRowCount.toLocaleString()} aggregate rows`}</span><span>{call.returnedToModel ? 'Returned to agent' : 'Withheld from agent'}</span></div>
                      {call.returnedToModel && call.resultPreview?.length ? <details className="fact-preview"><summary>Preview factual metrics <ChevronDown size={13} /></summary><pre>{JSON.stringify(call.resultPreview, null, 2)}</pre></details> : null}
                    </div>)}
                    {group.name === 'Policy retrieval' && investigation.trace.policySearches.map(search => <div className="trace-event" key={search.evidenceId}>
                      <div className="trace-event-top"><span className="event-id policy-event-id">{search.evidenceId}</span><strong>searchCompanyPolicies</strong></div>
                      <div className="trace-event-label">Query</div><p className="trace-query">{search.query}</p><div className="trace-result-line"><span>top {search.topK} · min score {search.minSimilarity.toFixed(2)}</span><span>{search.resultCount} passages</span></div>
                    </div>)}
                    {group.name === 'Final synthesis' && <div className="synthesis-event"><span className="synthesis-icon"><Sparkles size={15} /></span><div><strong>Agent response returned</strong><small>Evidence gaps and responsible-use flags included</small></div></div>}
                  </TraceStage>)}
                </div>
              </div>
            </aside>
          </div>

          <div className="evidence-panels">
            <details className="evidence-panel"><summary><span className="panel-icon operational-icon"><Database size={16} /></span><span><strong>Operational context used</strong><small>{investigation.mcpCallCount} governed MCP calls · factual aggregates only</small></span><ChevronDown size={17} /></summary>
              <div className="operational-context">{investigation.trace.mcpCalls.length ? investigation.trace.mcpCalls.map(call => <article className="operational-item" key={call.evidenceId}>
                <div className="operational-item-head"><span>{call.evidenceId}</span><strong>{call.tool}</strong><code>{JSON.stringify(call.parameters)}</code></div>
                {call.resultPreview?.length ? <div className="operational-preview"><span>RESULT PREVIEW · {call.resultRowCount} aggregate rows</span><pre>{JSON.stringify(call.resultPreview, null, 2)}</pre></div> : <div className="operational-limited">{call.resultRowCount?.toLocaleString() ?? 'No'} rows · {call.returnedToModel ? 'No preview available' : 'Oversized result withheld from model context'}</div>}
              </article>) : <p className="empty-evidence">No operational analytics were needed for this response.</p>}</div>
            </details>
            <details className="evidence-panel"><summary><span className="panel-icon policy-icon"><BookOpen size={16} /></span><span><strong>Policy context used</strong><small>Fictional policy passages, separately identified</small></span><ChevronDown size={17} /></summary>
              <div className="policy-context">{investigation.trace.policySearches.flatMap(search => search.results).length ? investigation.trace.policySearches.flatMap(search => search.results).map((policy, index) => <article className="policy-item" key={`${policy.sourceFilename}-${policy.sectionHeading}-${index}`}>
                <div className="policy-item-top"><span className="fictional-label"><BookOpen size={12} />FICTIONAL POLICY — PORTFOLIO DEMONSTRATION</span><span className="similarity-score">SIMILARITY <strong>{policy.similarityScore.toFixed(4)}</strong></span></div>
                <h4>{policy.policyTitle}</h4><div className="policy-meta"><span>{policy.sourceFilename}</span><span>{policy.sectionHeading}</span></div><blockquote>{policy.passage}</blockquote>
              </article>) : <p className="empty-evidence">No policy search was needed for this response.</p>}</div>
            </details>
          </div>
        </>}
      </section>}

      <footer className="app-footer"><div className="footer-brand"><div className="footer-mark"><Activity size={14} /></div><span>CLAIMS INTELLIGENCE AI</span></div><div className="footer-note"><BadgeCheck size={14} />Synthetic portfolio demonstration <span>·</span> Evidence-led decision support <span>·</span> Human review remains essential</div><span className="footer-version">LOCAL DEMO</span></footer>
    </main>
  </div>;
}

export default ClaimsApp;
