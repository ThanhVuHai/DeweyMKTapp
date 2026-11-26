import { prisma } from '@/lib/db';
import { sanitizeForLogging, sanitizeString } from '@/lib/redaction';
import { Logger } from '@/lib/logger';

export interface RecordUserActionParams {
  userId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

/**
 * Records an audited user configuration or administrative action.
 * Automatically sanitizes all before/after payloads to ensure zero token or secret leakage.
 * Persists in AuditLog and logs to SyncLog for unified observability.
 */
export async function recordUserAction(params: RecordUserActionParams): Promise<void> {
  const sanitizedAction = sanitizeString(params.action);
  const sanitizedEntityType = sanitizeString(params.entityType);
  const sanitizedEntityId = sanitizeString(params.entityId);

  let beforeJson: string | null = null;
  if (params.before !== undefined && params.before !== null) {
    const cleanBefore = sanitizeForLogging(params.before);
    beforeJson = JSON.stringify(cleanBefore);
  }

  let afterJson: string | null = null;
  if (params.after !== undefined && params.after !== null) {
    const cleanAfter = sanitizeForLogging(params.after);
    afterJson = JSON.stringify(cleanAfter);
  }

  try {
    // 1. Persist to existing AuditLog table
    await prisma.auditLog.create({
      data: {
        userId: params.userId || null,
        action: sanitizedAction,
        entityType: sanitizedEntityType,
        entityId: sanitizedEntityId,
        beforeJson,
        afterJson,
      },
    });
  } catch (err) {
    console.warn(`[AuditLog:Fallback] Failed to persist AuditLog: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Also log to structured SyncLog under USER_ACTION module for unified search and filtering
  try {
    await Logger.info(
      'USER_ACTION',
      sanitizedAction,
      `User performed ${sanitizedAction} on ${sanitizedEntityType} (${sanitizedEntityId})`,
      {},
      {
        actor: params.actorEmail || params.userId || 'system',
        stage: 'user_audit',
        metadata: {
          entityType: sanitizedEntityType,
          entityId: sanitizedEntityId,
          hasBeforeState: !!beforeJson,
          hasAfterState: !!afterJson,
        },
      }
    );
  } catch {
    // Ignored (Logger itself handles fallbacks)
  }
}
