import { useState } from 'react'
import { api, fmtDateTime } from '../lib/api'
import { Button, Chip, ErrorBox, Loading, PageHeader, Panel, useLoad } from '../components/ui'

interface Agg { strict: { precision: number; recall: number; f1: number }; lenient: { f1: number }; owner_errors: number; due_errors: number; false_positives: number; dependencies: string; safety_checks_passed: string; clarifications_on_clean_cases: number; cases_fully_correct: number; cases: number }
interface Diag {
  llm: { configured_provider: string; active: { provider: string | null; model: string | null; error?: string }; gemini: { api_key_present: boolean; model: string }
    ollama: { reachable: boolean; model: string; model_available: boolean }; temperature: number; seed: number
    last_live_smoke_test: { ok: boolean; provider?: string; model?: string; latency_ms?: number; error?: string; at: string } | null
    app_calls_by_model: Record<string, { calls: number; errors: number; median_latency_ms: number | null }> }
  speech: { provider: string; model: string; mode: string; api_key_present: boolean; verified_by_processed_meeting: boolean; ffmpeg: boolean; ffprobe: boolean }
  outbound: { smtp_configured: boolean; external_calendar_api: boolean; note: string }
  clock: string
  evaluation_runs: { run_id: string; meta: { provider: string; model: string; mode: string; started_at: string; prompt_version?: string; replayed_from?: string }; aggregate: Record<string, Agg> }[]
}

function Status({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return <Chip tone={ok ? 'create' : 'ask'}>{ok ? yes : no}</Chip>
}

export default function DiagnosticsPage() {
  const { data, error, loading, reload } = useLoad(() => api.get<Diag>('/api/diagnostics'))
  const [smoking, setSmoking] = useState(false)
  if (loading && !data) return <Loading />
  async function smoke() { setSmoking(true); try { await api.post('/api/diagnostics/llm-smoke') } finally { setSmoking(false); reload() } }
  const d = data
  return (
    <>
      <PageHeader title="Diagnostics" sub="What is live, what is configured, and what has actually been verified on this server." />
      <ErrorBox error={error} onRetry={reload} />
      {d && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Language model" actions={<Button onClick={smoke} disabled={smoking}>{smoking ? 'Testing…' : 'Run live test'}</Button>}>
              <dl className="grid grid-cols-[9rem_1fr] gap-y-1.5 text-[14.5px]">
                <dt className="text-slate">Active</dt><dd>{d.llm.active.provider ? `${d.llm.active.provider} / ${d.llm.active.model}` : <span className="text-cancel">none: {d.llm.active.error}</span>}</dd>
                <dt className="text-slate">Gemini</dt><dd><Status ok={d.llm.gemini.api_key_present} yes="key present" no="no API key" /> {d.llm.gemini.model}</dd>
                <dt className="text-slate">Local Ollama</dt><dd><Status ok={d.llm.ollama.reachable && d.llm.ollama.model_available} yes="reachable" no="unavailable" /> {d.llm.ollama.model}</dd>
                <dt className="text-slate">Settings</dt><dd>temperature {d.llm.temperature}, seed {d.llm.seed}</dd>
                <dt className="text-slate">Live test</dt><dd>{d.llm.last_live_smoke_test ? (d.llm.last_live_smoke_test.ok
                  ? <span className="text-create">passed: {d.llm.last_live_smoke_test.provider}/{d.llm.last_live_smoke_test.model}, {((d.llm.last_live_smoke_test.latency_ms ?? 0) / 1000).toFixed(1)} s, {fmtDateTime(d.llm.last_live_smoke_test.at)}</span>
                  : <span className="text-cancel">failed: {d.llm.last_live_smoke_test.error}</span>) : 'not run since the server started'}</dd>
              </dl>
              {Object.keys(d.llm.app_calls_by_model).length > 0 && (
                <table className="mt-3 w-full text-[13.5px]"><thead className="text-slate"><tr><th className="text-left font-medium">Model calls made by the app</th><th className="text-right font-medium">Calls</th><th className="text-right font-medium">Errors</th><th className="text-right font-medium">Median time</th></tr></thead>
                  <tbody>{Object.entries(d.llm.app_calls_by_model).map(([k, v]) => <tr key={k}><td>{k}</td><td className="text-right">{v.calls}</td><td className="text-right">{v.errors}</td><td className="text-right">{v.median_latency_ms != null ? `${(v.median_latency_ms / 1000).toFixed(1)} s` : '—'}</td></tr>)}</tbody></table>
              )}
            </Panel>
            <Panel title="Speech and integrations">
              <dl className="grid grid-cols-[9rem_1fr] gap-y-1.5 text-[14.5px]">
                <dt className="text-slate">Sarvam STT</dt><dd><Status ok={d.speech.api_key_present} yes="key present" no="no API key" /> {d.speech.model}, mode {d.speech.mode}</dd>
                <dt className="text-slate">Verified</dt><dd>{d.speech.verified_by_processed_meeting ? <span className="text-create">a recording was transcribed on this server</span> : <span className="text-ask">not verified: no recording has been transcribed here</span>}</dd>
                <dt className="text-slate">FFmpeg</dt><dd><Status ok={d.speech.ffmpeg && d.speech.ffprobe} yes="installed" no="missing" /></dd>
                <dt className="text-slate">Email (SMTP)</dt><dd><Status ok={d.outbound.smtp_configured} yes="configured" no="not configured: nothing can be emailed" /></dd>
                <dt className="text-slate">External calendar</dt><dd>{d.outbound.note}</dd>
                <dt className="text-slate">Clock</dt><dd>{d.clock}</dd>
              </dl>
            </Panel>
          </div>
          <Panel title="Baseline vs reconciliation engine (synthetic fixtures)">
            <p className="mb-3 text-[14px] text-slate">Twelve synthetic engineering cases from the starter kit. These are not the official evaluation on three real meetings. Each run uses one model for all pipelines; replays re-score recorded model output with newer rules.</p>
            {!d.evaluation_runs.length ? <p className="text-slate">No evaluation has been run. Use <code>python evaluation/run_eval.py</code>.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-[13.5px]">
                  <thead className="text-slate"><tr><th className="py-1 font-medium">Run</th><th className="font-medium">Pipeline</th><th className="text-right font-medium">Strict F1</th><th className="text-right font-medium">Precision</th><th className="text-right font-medium">Recall</th><th className="text-right font-medium">Owner errors</th><th className="text-right font-medium">Safety checks</th><th className="text-right font-medium">Dependencies</th><th className="text-right font-medium">Fully correct</th></tr></thead>
                  <tbody>{d.evaluation_runs.flatMap(r => Object.entries(r.aggregate).map(([p, a], i) => (
                    <tr key={r.run_id + p} className={i === 0 ? 'border-t border-rule' : ''}>
                      <td className="py-1 pr-2 align-top">{i === 0 && <><div className="font-medium">{r.meta.provider}/{r.meta.model}</div><div className="text-[12px] text-slate">{r.meta.mode}{r.meta.replayed_from ? ' (re-scored)' : ''}, prompt {r.meta.prompt_version ?? 'v1'}, {fmtDateTime(r.meta.started_at)}</div></>}</td>
                      <td className={p === 'candidate' ? 'font-semibold' : ''}>{p === 'baseline_det' ? 'baseline + date rules' : p}</td>
                      <td className="text-right tabular-nums">{a.strict.f1.toFixed(2)}</td><td className="text-right tabular-nums">{a.strict.precision.toFixed(2)}</td><td className="text-right tabular-nums">{a.strict.recall.toFixed(2)}</td>
                      <td className="text-right">{a.owner_errors}</td><td className="text-right">{a.safety_checks_passed}</td><td className="text-right">{a.dependencies}</td><td className="text-right">{a.cases_fully_correct}/{a.cases}</td>
                    </tr>)))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}
    </>
  )
}
