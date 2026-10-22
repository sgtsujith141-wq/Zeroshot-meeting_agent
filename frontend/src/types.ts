export interface MeetingSummary {
  id: number; title: string; scheduled_at: string; timezone: string; organiser: string
  consent_confirmed: boolean; source_type: string | null; file_name: string | null
  duration_seconds: number | null; processing_status: string; processing_error: string | null
  stt_provider: string | null; segments: number
  change_set: { id: number; state: string } | null; created_at: string
}

export interface Segment {
  seg_key: string; speaker_label: string; start_seconds: number; end_seconds: number | null
  text: string; revision: number; source_type: string
}

export interface Participant { speaker_label: string; display_name: string | null; confirmed_identity: boolean; anonymous_label: boolean }

export interface MeetingDetail extends Omit<MeetingSummary, 'segments'> {
  consent_statement: string | null; language_hint: string | null
  processing_log: { at: string; step: string; status: string; detail: string | null }[]
  minutes: { summary?: string; discussion?: { topic: string; summary: string; segment_ids: string[] }[]; generated_by?: string; dropped_unsupported_items?: number }
  participants: Participant[]; segments: Segment[]
  decisions: { id: number; text: string; rationale: string | null; evidence_segment_ids: string[]; approval_status: string }[]
  open_questions: { id: number; text: string; evidence_segment_ids: string[]; status: string }[]
  events: { seq: number; type: string; task_key: string | null; payload: Record<string, unknown>; segment_ids: string[]; interpretation_status: string; rejection_reason: string | null }[]
  llm_runs: { id: number; purpose: string; provider: string; model: string; latency_ms: number; attempts: number; error: string | null; created_at: string }[]
  timestamp_granularity: string
}

export interface Deadline { raw: string | null; date: string | null; kind: string; ambiguous: boolean; candidates: string[]; time_text: string | null; note: string | null }

export interface ProposalItem {
  key: string; title: string; existing_task_id: string | null; operation: string; state: string
  owner: string | null; owner_status: string; owner_note: string | null; owner_candidate: string | null
  deadline: Deadline; priority: { value: string | null; basis: string }
  depends_on: { key: string; title: string; existing_task_id: string | null }[]
  blocked_reason: string | null; evidence_segment_ids: string[]
  history: { type: string; summary: string; segment_ids: string[] }[]
  clarification_ids: string[]; excluded?: boolean
  before: { title: string; owner: string | null; due_date: string | null; status: string; depends_on: string[] } | null
  plan?: { calendar_event: boolean; in_app_reminder_at: string | null }
}

export interface Clarification {
  id: string; kind: string; rank: number; question: string; item_keys: string[]; segment_ids: string[]
  data: Record<string, unknown> & { candidates?: string[]; candidate?: string; speaker_label?: string }
  blocking: boolean; deferred: boolean; answer?: { choice: string; value: string | null } | null
}

export interface ChangeSet {
  id: number; meeting_id: number; meeting_title: string | null; state: string; version: number
  proposal: {
    items: ProposalItem[]; clarifications: Clarification[]
    decisions_review: { id: number; text: string; rationale: string | null; evidence_segment_ids: string[]; include: boolean }[]
    open_questions: { text: string; segment_ids: string[] }[]
    warnings: { kind: string; segment_ids: string[]; detail: string }[]
    rejected_events: { reason: string }[]
  }
  ledger_snapshot: { code: string; revision: number }[]
  proposal_hash: string; applied_result: { created?: Record<string, string>; updated?: string[]; cancelled?: string[]; completed?: string[] }
  error: string | null; updated_at: string
  segments: Record<string, { speaker_label: string; start_seconds: number; end_seconds: number | null; text: string }>
}

export interface Task {
  id: number; code: string; title: string; owner: string | null; owner_certainty: string
  due_date: string | null; deadline_raw: string | null; deadline_kind: string; timezone: string
  priority: string | null; priority_basis: string | null; status: string; blocked_reason: string | null
  revision: number; origin_meeting_id: number; last_meeting_id: number | null
  evidence: { meeting_id: number; seg_key: string }[]
  prerequisites: { code: string; title: string; status: string }[]
  dependents: { code: string; title: string; status: string }[]
  is_blocked: boolean; allowed_transitions: string[]
}

export interface TaskDetail extends Task {
  revisions: { revision: number; snapshot: Record<string, unknown>; actor: string; reason: string; change_set_id: number | null; meeting_id: number | null; created_at: string }[]
  evidence_detail: { meeting_id: number; seg_key: string; meeting_title: string | null; speaker_label: string | null; text: string | null; start_seconds: number | null; exists: boolean }[]
  calendar_event: { date: string; sync_state: string; uid: string } | null
  reminders: Reminder[]
}

export interface Reminder {
  id: number; task_id: number; task_code?: string; scheduled_at: string; scheduled_at_local?: string
  channel: string; recipients: string[]; message: string; delivery_state: string; attempts: number
  last_error: string | null; delivered_at: string | null; approval_id: number | null
}

export interface Passage {
  passage_id: string; doc_type: string; doc_id: string; text: string; meeting_id: number | null
  meeting_title: string | null; meeting_date: string | null; seg_key?: string; speaker?: string
  start_seconds?: number; task_code?: string; task_status?: string
}
