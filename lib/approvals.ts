import { sql } from '@/lib/db';
import { abs, type Minor } from '@/lib/money';
import { applyEndorsement, type EndorseInput } from '@/lib/policy/endorse';

export function thresholdMinor(): Minor {
  const raw = process.env.APPROVAL_THRESHOLD_MINOR;
  return raw ? BigInt(raw) : 50_000n;
}

export type ApprovalRow = {
  id: string;
  kind: string;
  payload: Record<string, string>;
  amountMinor: Minor;
  thresholdMinor: Minor;
  status: 'pending' | 'approved' | 'rejected';
  requestedBy: string;
  requestedByName: string;
  requestedVia: string;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  resultRef: string | null;
  createdAt: string;
};

export async function requestApproval(input: {
  kind: string;
  payload: Record<string, string>;
  amountMinor: Minor;
  requestedBy: string;
  requestedVia: string;
}): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into approvals (kind, payload, amount_minor, threshold_minor, requested_by, requested_via)
    values (${input.kind}, ${sql.json(input.payload)}::jsonb,
            ${abs(input.amountMinor).toString()}::bigint, ${thresholdMinor().toString()}::bigint,
            ${input.requestedBy}::uuid, ${input.requestedVia})
    returning id
  `;
  return row.id;
}

export async function listApprovals(status?: 'pending'): Promise<ApprovalRow[]> {
  const rows = await sql<
    {
      id: string;
      kind: string;
      payload: Record<string, string>;
      amount_minor: bigint;
      threshold_minor: bigint;
      status: 'pending' | 'approved' | 'rejected';
      requested_by: string;
      requested_by_name: string;
      requested_via: string;
      decided_by: string | null;
      decided_by_name: string | null;
      decided_at: string | null;
      decision_note: string | null;
      result_ref: string | null;
      created_at: string;
    }[]
  >`
    select a.id, a.kind, a.payload, a.amount_minor, a.threshold_minor, a.status,
           a.requested_by, ru.name as requested_by_name, a.requested_via,
           a.decided_by, du.name as decided_by_name, a.decided_at::text,
           a.decision_note, a.result_ref, a.created_at::text
      from approvals a
      join users ru on ru.id = a.requested_by
      left join users du on du.id = a.decided_by
     where ${status ? sql`a.status = ${status}` : sql`true`}
     order by a.created_at desc
  `;

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    payload: r.payload,
    amountMinor: BigInt(r.amount_minor),
    thresholdMinor: BigInt(r.threshold_minor),
    status: r.status,
    requestedBy: r.requested_by,
    requestedByName: r.requested_by_name,
    requestedVia: r.requested_via,
    decidedBy: r.decided_by,
    decidedByName: r.decided_by_name,
    decidedAt: r.decided_at,
    decisionNote: r.decision_note,
    resultRef: r.result_ref,
    createdAt: r.created_at,
  }));
}

export class SelfApprovalError extends Error {
  constructor() {
    super('The person who raised a request cannot approve it. A second approver is required.');
    this.name = 'SelfApprovalError';
  }
}

export async function decideApproval(input: {
  approvalId: string;
  deciderId: string;
  approve: boolean;
  note: string;
}): Promise<{ status: 'approved' | 'rejected'; resultRef: string | null; settlementNote: string | null; checkoutUrl: string | null }> {
  const [approval] = await sql<
    {
      id: string;
      kind: string;
      payload: Record<string, string>;
      status: string;
      requested_by: string;
    }[]
  >`select id, kind, payload, status, requested_by from approvals where id = ${input.approvalId}::uuid`;

  if (!approval) throw new Error('no such approval');
  if (approval.status !== 'pending') throw new Error(`this request is already ${approval.status}`);
  if (approval.requested_by === input.deciderId) throw new SelfApprovalError();

  if (!input.approve) {
    await sql`
      update approvals
         set status = 'rejected', decided_by = ${input.deciderId}::uuid,
             decided_at = now(), decision_note = ${input.note}
       where id = ${input.approvalId}::uuid
    `;
    return { status: 'rejected', resultRef: null, settlementNote: null, checkoutUrl: null };
  }

  let resultRef: string | null = null;
  let settlementNote: string | null = null;
  let checkoutUrl: string | null = null;

  if (approval.kind === 'endorsement') {
    const p = approval.payload;
    const endorsement: EndorseInput = {
      policyId: p.policyId,
      effectiveDate: p.effectiveDate,
      limitMinor: BigInt(p.limitMinor),
      deductibleMinor: BigInt(p.deductibleMinor),
      exposures: JSON.parse(p.exposures),
      description: p.description,
      actor: p.actor,
      settleNow: p.settleNow !== 'no',
    };
    const applied = await applyEndorsement(endorsement);
    resultRef = applied.versionId;
    settlementNote = applied.settlement.note;
    checkoutUrl = applied.settlement.kind === 'charge' ? applied.settlement.checkoutUrl : null;
  } else {
    throw new Error(`no executor wired for approval kind ${approval.kind}`);
  }

  await sql`
    update approvals
       set status = 'approved', decided_by = ${input.deciderId}::uuid,
           decided_at = now(), decision_note = ${input.note}, result_ref = ${resultRef}
     where id = ${input.approvalId}::uuid
  `;

  return { status: 'approved', resultRef, settlementNote, checkoutUrl };
}
