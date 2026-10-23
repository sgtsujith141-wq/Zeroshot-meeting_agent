// Plain-language labels and tones for every state the API reports.
import type { Tone } from '../components/ui'
import type { MeetingSummary } from '../types'

export const BUSY = ['queued', 'transcribing', 'interpreting', 'writing_minutes']
export const OPEN_TASK = ['todo', 'in_progress', 'blocked']

const STEP: Record<string, string> = { queued: 'Queued', transcribing: 'Transcribing', interpreting: 'Interpreting', writing_minutes: 'Writing minutes' }

/** One status per meeting, combining processing and the review of its proposed changes. */
export function meetingStatus(m: Pick<MeetingSummary, 'processing_status' | 'change_set' | 'source_type'>): { label: string; tone: Tone; busy?: boolean; key: string } {
  const p = m.processing_status
  if (BUSY.includes(p)) return { label: `Processing: ${STEP[p].toLowerCase()}`, tone: 'sky', busy: true, key: 'processing' }
  if (p === 'failed') return { label: 'Failed', tone: 'cancel', key: 'failed' }
  if (p === 'created' || !m.source_type) return { label: 'Waiting for upload', tone: 'neutral', key: 'empty' }
  const cs = m.change_set?.state
  if (p === 'transcribed' && !cs) return { label: 'Transcript ready', tone: 'sky', key: 'transcribed' }
  if (cs === 'NEEDS_CLARIFICATION') return { label: 'Needs review', tone: 'ask', key: 'review' }
  if (cs === 'READY_FOR_REVIEW') return { label: 'Ready to approve', tone: 'accent', key: 'review' }
  if (cs === 'APPLIED') return { label: 'Approved', tone: 'done', key: 'approved' }
  if (cs === 'REJECTED') return { label: 'Rejected', tone: 'neutral', key: 'rejected' }
  if (cs === 'FAILED') return { label: 'Apply failed', tone: 'cancel', key: 'failed' }
  if (p === 'ready_for_review') return { label: 'Processed', tone: 'neutral', key: 'processed' }
  return { label: 'Not processed', tone: 'neutral', key: 'empty' }
}

export function changeSetStatus(state: string): { label: string; tone: Tone } {
  return ({
    NEEDS_CLARIFICATION: { label: 'Needs review', tone: 'ask' }, READY_FOR_REVIEW: { label: 'Ready to approve', tone: 'accent' },
    APPLIED: { label: 'Approved', tone: 'done' }, REJECTED: { label: 'Rejected', tone: 'neutral' }, FAILED: { label: 'Apply failed', tone: 'cancel' },
    APPROVED: { label: 'Approving', tone: 'sky' }, DRAFT: { label: 'Draft', tone: 'neutral' },
  } as Record<string, { label: string; tone: Tone }>)[state] ?? { label: state, tone: 'neutral' }
}

export const TASK_LABEL: Record<string, string> = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled' }
export const taskLabel = (s: string) => TASK_LABEL[s] ?? s.replace(/_/g, ' ')
export function taskTone(s: string): Tone {
  return ({ todo: 'neutral', in_progress: 'sky', blocked: 'cancel', done: 'done', cancelled: 'neutral' } as Record<string, Tone>)[s] ?? 'neutral'
}

export function reminderStatus(s: string): { label: string; tone: Tone } {
  return ({
    draft: { label: 'Draft, not scheduled', tone: 'ask' }, scheduled: { label: 'Scheduled', tone: 'accent' }, delivered: { label: 'Delivered in the app', tone: 'done' },
    sent: { label: 'Email sent', tone: 'done' }, failed: { label: 'Not sent', tone: 'cancel' }, cancelled: { label: 'Cancelled', tone: 'neutral' },
  } as Record<string, { label: string; tone: Tone }>)[s] ?? { label: s, tone: 'neutral' }
}

/** Demo and test meetings say so in their title or file name; real meetings never do. */
export const isSynthetic = (m: { title: string; file_name?: string | null }) => /synthetic/i.test(`${m.title} ${m.file_name ?? ''}`)

export const todayIso = () => new Date().toISOString().slice(0, 10)
export const shortDate = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
