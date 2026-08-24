import { createServiceClient } from '@/lib/supabase-service';
import { getAdminAuthorization } from '@/lib/admin-auth';

/**
 * Immutable admin audit log (Task 8.8).
 *
 * - Records WHO (authenticated Supabase admin user id + email snapshot), WHAT
 *   (allow-listed action name), on WHAT target (type + id), and WHEN
 *   (server-generated timestamp) for every administrative mutation in Phase 8
 * - Writes are service-role only; the table is RLS-locked with zero policies so
 *   anon/authenticated users can neither read nor write it, and no update/delete
 *   paths exist anywhere in the codebase - audit records are immutable
 * - Best-effort by design: writeAuditLog NEVER throws. A failed audit write is
 *   logged loudly and reported as false so callers can log/observe it, but it never
 *   changes business results (the underlying mutations have already committed).
 *
 * Server-only module: must never be imported by client code.
 */

export const AUDIT_ACTIONS = [
  'category.create',
  'category.update',
  'category.activate',
  'category.deactivate',
  'payment.refund',
  'banned_email.ban',
  'banned_email.unban',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditEntryInput = {
  actorUserId: string;
  actorEmail: string;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  detail?: Record<string, unknown>;
};

function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

/** Insert an immutable audit record. Returns false (and logs loudly) on failure. */
export async function writeAuditLog(entry: AuditEntryInput): Promise<boolean> {
  if (!isAuditAction(entry.action)) {
    console.error('[audit-log] rejected unknown action', JSON.stringify({ action: entry.action }));

    return false;
  }

  const supabase = createServiceClient();

  const { error } = await supabase.from('audit_logs').insert({
    actor_user_id: entry.actorUserId,
    actor_email: entry.actorEmail,
    action: entry.action,
    target_type: entry.targetType ?? null,
    target_id: entry.targetId ?? null,
    detail: entry.detail ?? null,
  });

  if (error) {
    console.error(
      '[audit-log] failed to persist audit record',
      JSON.stringify({ action: entry.action, message: error.message })
    );

    return false;
  }

  return true;
}

const AUDIT_FIELDS =
  'id, actor_user_id, actor_email, action, target_type, target_id, detail, created_at';

export type AuditLogRow = {
  id: number;
  actorUserId: string;
  actorEmail: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: unknown;
  createdAt: string;
};

/** Newest-first bounded read of the audit trail (admin pages). */
export async function readAuditLogs(): Promise<
  { ok: true; entries: AuditLogRow[] } | { ok: false; reason: 'unauthorized' | 'db_error' }
> {
  if (!(await getAdminAuthorization()).authorized) {
    return { ok: false, reason: 'unauthorized' };
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('audit_logs')
    .select(AUDIT_FIELDS)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return { ok: false, reason: 'db_error' };
  }

  type RawRow = {
    id: number;
    actor_user_id: string;
    actor_email: string;
    action: string;
    target_type: string | null;
    target_id: string | null;
    detail: unknown;
    created_at: string;
  };

  const entries = ((data as unknown as RawRow[]) ?? []).map((row) => ({
    id: row.id,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    detail: row.detail,
    createdAt: row.created_at,
  }));

  return { ok: true, entries };
}
