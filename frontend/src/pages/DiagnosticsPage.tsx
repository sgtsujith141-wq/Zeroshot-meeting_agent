import { Fragment, useState } from 'react'
import { api, fmtDateTime } from '../lib/api'
import { Button, ErrorBox, Loading, PageHeader, Section, Status, errText, useLoad, useToast } from '../components/ui'

interface Agg { strict: { precision: number; recall: number; f1: number }; owner_errors: number; dependencies: string; safety_checks_passed: string; cases_fully_correct: number; cases: number }
interface Diag {
  llm: { configured_provider: string; active: { provider: string | null; model: string | null; error?: string }; gemini: { api_key_present: boolean; model: string }
    ollama: { reachable: boolean; model: string; model_available: boolean }; temperature: number; seed: number
    last_live_smoke_test: { ok: boolean; provider?: string; model?: string; latency_ms?: number; error?: string; at: string } | null
    app_calls_by_model: Record<string, { calls: number; errors: number; median_latency_ms: number | null }> }
  speech: { active: string | null; reason: string | null; sarvam: { api_key_present: boolean; model: string; mode: string }
    whisper_local: { installed: boolean; model: string }; verified_by_processed_meeting: string[]; ffmpeg: boolean; ffprobe: boolean }
  outbound: { smtp_configured: boolean; external_calendar_api: boolean; note: string }
  clock: string
  evaluation_runs: { run_id: string; meta: { provider: string; model: string; mode: string; started_at: string; prompt_version?: string; replayed_from?: string }; aggregate: Record<string, Agg> }[]
}

const Ok = ({ ok, yes, no }: { ok: boolean; yes: string; no: string }) => <Status tone={ok ? 'done' : 'ask'}>{ok ? yes : no}</Status>
const PIPE: Record<string, string> = { baseline: 'Baseline', baseline_det: 'Baseline + date rules', candidate: 'Reconciliation engine' }

export default function DiagnosticsPage() {
  const toast = useToast()
  const { data: d, error, loading, reload } = useLoad(() => api.get<Diag>('/api/diagnostics'))
  const [testing, setTesting] = useState(false)
  async function smoke() {
    setTesting(true)
    try { await api.post('/api/diagnostics/llm-smoke') } catch (e) { toast('error', errText(e)) } finally { setTesting(false); reload() }
  }
  if (loading && !d) return <Loading />
  const t = d?.llm.last_live_smoke_test
  return (
    <>
      <PageHeader title="Diagnostics" sub="What is live, what is configured, and what has actually been verified on this server." />
      <ErrorBox error={error} onRetry={reload} />
      {d && (
        <div className="space-y-8">
          <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
            <Section title="Language model" actions={<Button size="sm" loading={testing} onClick={smoke}>{testing ? 'Testing…' : 'Run live test'}</Button>}>
              <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-y-2 border-t border-rule pt-2 text-[14px]">
                <dt className="text-slate">Active</dt><dd>{d.llm.active.provider ? `${d.llm.active.provider} / ${d.llm.active.model}` : <span className="text-cancel">none: {d.llm.active.error}</span>}</dd>
                <dt className="text-slate">Gemini</dt><dd className="flex flex-wrap gap-x-3"><Ok ok={d.llm.gemini.api_key_present} yes="key present" no="no API key" /><span className="text-slate">{d.llm.gemini.model}</span></dd>
                <dt className="text-slate">Local Ollama</dt><dd className="flex flex-wrap gap-x-3"><Ok ok={d.llm.ollama.reachable && d.llm.ollama.model_available} yes="reachable" no="unavailable" /><span className="text-slate">{d.llm.ollama.model}</span></dd>
                <dt className="text-slate">Settings</dt><dd>temperature {d.llm.temperature}, seed {d.llm.seed}</dd>
                <dt className="text-slate">Live test</dt><dd>{t ? (t.ok
                  ? <span className="text-done">passed: {t.provider}/{t.model}, {((t.latency_ms ?? 0) / 1000).toFixed(1)} s, {fmtDateTime(t.at)}</span>
                  : <span className="text-cancel">failed: {t.error}</span>) : <span className="text-slate">not run since the server started</span>}</dd>
              </dl>
              {Object.keys(d.llm.app_calls_by_model).length > 0 && (
                <table className="mt-4 w-full text-[13.5px]">
                  <thead className="text-faint"><tr className="border-b border-rule"><th className="py-1.5 text-left font-medium">Model calls made by the app</th><th className="text-right font-medium">Calls</th><th className="text-right font-medium">Errors</th><th className="text-right font-medium">Median time</th></tr></thead>
                  <tbody>{Object.entries(d.llm.app_calls_by_model).map(([k, v]) => <tr key={k} className="border-b border-rule"><td className="py-1.5">{k}</td><td className="tnum text-right">{v.calls}</td><td className="tnum text-right">{v.errors}</td><td className="tnum text-right">{v.median_latency_ms != null ? `${(v.median_latency_ms / 1000).toFixed(1)} s` : '—'}</td></tr>)}</tbody>
                </table>
              )}
            </Section>
            <Section title="Speech and integrations">
              <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-y-2 border-t border-rule pt-2 text-[14px]">
                <dt className="text-slate">Active</dt><dd>{d.speech.active ?? <span className="text-cancel">none: {d.speech.reason}</span>}</dd>
                <dt className="text-slate">Sarvam</dt><dd className="flex flex-wrap gap-x-3"><Ok ok={d.speech.sarvam.api_key_present} yes="key present" no="no API key" /><span className="text-slate">{d.speech.sarvam.model}, {d.speech.sarvam.mode}, separates speakers</span></dd>
                <dt className="text-slate">Local Whisper</dt><dd className="flex flex-wrap gap-x-3"><Ok ok={d.speech.whisper_local.installed} yes="installed" no="not installed" /><span className="text-slate">{d.speech.whisper_local.model}, no speaker separation</span></dd>
                <dt className="text-slate">Verified here</dt><dd>{d.speech.verified_by_processed_meeting.length ? <span className="text-done">recordings transcribed by: {d.speech.verified_by_processed_meeting.join(', ')}</span> : <span className="text-ask">no recording has been transcribed here</span>}</dd>
                <dt className="text-slate">FFmpeg</dt><dd><Ok ok={d.speech.ffmpeg && d.speech.ffprobe} yes="installed" no="missing" /></dd>
                <dt className="text-slate">Email (SMTP)</dt><dd><Ok ok={d.outbound.smtp_configured} yes="configured" no="not configured: nothing can be emailed" /></dd>
                <dt className="text-slate">Calendar</dt><dd className="text-slate">{d.outbound.note}</dd>
                <dt className="text-slate">Clock</dt><dd>{d.clock}</dd>
              </dl>
            </Section>
          </div>
          <Section title="Baseline vs reconciliation engine (synthetic fixtures)">
            <p className="mb-3 max-w-[80ch] text-[13.5px] text-slate">Twelve synthetic engineering cases from the starter kit. This is not the official evaluation on three real meetings. Each run uses one model for all pipelines; re-scored runs replay recorded model output through newer rules.</p>
            {!d.evaluation_runs.length ? <p className="text-slate">No evaluation has been run. Use <code>python evaluation/run_eval.py</code>.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-[13.5px]">
                  <thead className="text-faint"><tr className="border-b border-rule"><th className="py-1.5 font-medium">Run</th><th className="font-medium">Pipeline</th><th className="text-right font-medium">Strict F1</th><th className="text-right font-medium">Precision</th><th className="text-right font-medium">Recall</th><th className="text-right font-medium">Owner errors</th><th className="text-right font-medium">Safety checks</th><th className="text-right font-medium">Dependencies</th><th className="text-right font-medium">Fully correct</th></tr></thead>
                  <tbody>{d.evaluation_runs.map(r => {
                    const rows = Object.entries(r.aggregate)
                    return (
                      <Fragment key={r.run_id}>
                        {rows.map(([p, a], i) => (
                          <tr key={p} className={i === rows.length - 1 ? 'border-b border-rule' : ''}>
                            {i === 0 && <td rowSpan={rows.length} className="py-1.5 pr-3 align-top"><div className="font-medium text-ink">{r.meta.provider}/{r.meta.model}</div><div className="text-[12px] text-faint">{r.meta.mode}{r.meta.replayed_from ? ', re-scored' : ''}, prompt {r.meta.prompt_version ?? 'v1'}, {fmtDateTime(r.meta.started_at)}</div></td>}
                            <td className={`py-1.5 ${p === 'candidate' ? 'font-medium text-ink' : 'text-slate'}`}>{PIPE[p] ?? p}</td>
                            <td className="tnum text-right">{a.strict.f1.toFixed(2)}</td><td className="tnum text-right">{a.strict.precision.toFixed(2)}</td><td className="tnum text-right">{a.strict.recall.toFixed(2)}</td>
                            <td className="tnum text-right">{a.owner_errors}</td><td className="tnum text-right">{a.safety_checks_passed}</td><td className="tnum text-right">{a.dependencies}</td><td className="tnum text-right">{a.cases_fully_correct}/{a.cases}</td>
                          </tr>))}
                      </Fragment>)
                  })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      )}
    </>
  )
}
