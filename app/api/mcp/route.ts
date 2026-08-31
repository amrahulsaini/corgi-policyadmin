import { sql } from '@/lib/db';
import { format } from '@/lib/money';
import { loadPolicyAsOf } from '@/lib/policy/view';
import { listBreaks } from '@/lib/reconciliation';
import { requestApproval, thresholdMinor } from '@/lib/approvals';
import { priceEndorsement } from '@/lib/policy/endorse';
import { minor } from '@/lib/money';
import type { Exposure } from '@/lib/rating';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOOLS = [
  {
    name: 'policy_as_of',
    description:
      'Read a policy exactly as it stood on a past date: coverage, limits, exposures, written, earned and unearned premium. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        policy_number: { type: 'string', description: 'e.g. CGL-CA-100001' },
        as_of: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['policy_number', 'as_of'],
    },
  },
  {
    name: 'explain_balance',
    description:
      'Show every journal line that sums to an account balance, with the entry, its effective and booked dates, and the provider reference behind it. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        account_code: { type: 'string', description: 'e.g. 1000 for cash at processor' },
        as_of: { type: 'string', description: 'optional YYYY-MM-DD cut-off' },
      },
      required: ['account_code'],
    },
  },
  {
    name: 'list_reconciliation_breaks',
    description:
      'List open reconciliation breaks between the provider and this ledger, with amounts and age. Read-only.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'propose_endorsement',
    description:
      'Propose a mid-term endorsement. This NEVER posts to the ledger. It prices the change and files it in the human approval queue, where a member of staff who is not the initiator must approve it.',
    inputSchema: {
      type: 'object',
      properties: {
        policy_number: { type: 'string' },
        effective_date: { type: 'string', description: 'YYYY-MM-DD' },
        limit: { type: 'string', description: 'occurrence limit in dollars, e.g. 2000000.00' },
        deductible: { type: 'string', description: 'deductible in dollars, e.g. 2500.00' },
        vehicles: { type: 'number' },
        square_feet: { type: 'number' },
        description: { type: 'string' },
      },
      required: ['policy_number', 'effective_date', 'description'],
    },
  },
];

function unauthorised() {
  return Response.json(
    { jsonrpc: '2.0', error: { code: -32001, message: 'bearer token required' }, id: null },
    { status: 401 },
  );
}

function authorised(request: Request): boolean {
  const expected = process.env.MCP_TOKEN;
  if (!expected) return false;
  const header = request.headers.get('authorization') ?? '';
  return header === `Bearer ${expected}`;
}

export async function GET() {
  return Response.json({
    name: 'corgi-policy-administration',
    version: '1.0.0',
    transport: 'jsonrpc-over-http',
    endpoint: '/api/mcp',
    authentication: 'Authorization: Bearer <MCP_TOKEN>',
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    never_delegated: NEVER_LIST,
  });
}

export async function POST(request: Request) {
  if (!authorised(request)) return unauthorised();

  const body = (await request.json()) as { method?: string; params?: unknown; id?: unknown };
  const id = body.id ?? null;

  if (body.method === 'initialize') {
    return Response.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'corgi-policy-administration', version: '1.0.0' },
      },
    });
  }

  if (body.method === 'tools/list') {
    return Response.json({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  }

  if (body.method === 'tools/call') {
    const params = body.params as { name?: string; arguments?: Record<string, unknown> };
    try {
      const text = await callTool(params.name ?? '', params.arguments ?? {});
      return Response.json({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text }] },
      });
    } catch (err) {
      return Response.json({
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : 'tool failed' }],
        },
      });
    }
  }

  return Response.json({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `unknown method ${body.method}` },
  });
}

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (name === 'policy_as_of') {
    const policyNumber = String(args.policy_number ?? '');
    const asOf = String(args.as_of ?? '');
    const [row] = await sql<{ id: string }[]>`
      select id from policies where policy_number = ${policyNumber}
    `;
    if (!row) throw new Error(`no policy numbered ${policyNumber}`);

    const view = await loadPolicyAsOf(row.id, asOf);
    if (!view) throw new Error('policy could not be reconstructed for that date');

    return [
      `${view.header.policyNumber} as at ${asOf}`,
      `insured        ${view.header.customerName} (${view.header.stateCode})`,
      `term           ${view.header.termStart} to ${view.header.termEnd}`,
      `status         ${view.header.status}`,
      `limit          ${view.version ? format(view.version.limitMinor) : 'n/a'}`,
      `deductible     ${view.version ? format(view.version.deductibleMinor) : 'n/a'}`,
      `written        ${format(view.writtenMinor)}`,
      `earned         ${format(view.earnedMinor)}`,
      `unearned       ${format(view.unearnedMinor)}`,
      `versions       ${view.versions.map((v) => `#${v.versionNo} ${v.kind} eff ${v.effectiveDate}`).join('; ')}`,
      `exposures      ${(view.version?.exposures ?? []).map((e) => (e.kind === 'vehicle' ? `vehicle ${e.vin}` : `location ${e.squareFeet}sqft`)).join(', ') || 'none'}`,
    ].join('\n');
  }

  if (name === 'explain_balance') {
    const code = String(args.account_code ?? '');
    const asOf = args.as_of ? String(args.as_of) : null;

    const [account] = await sql<{ name: string; normal: string }[]>`
      select name, normal from ledger_accounts where code = ${code}
    `;
    if (!account) throw new Error(`no account ${code}`);

    const lines = await sql<
      {
        seq: bigint;
        effective_date: string;
        booked_at: string;
        event_type: string;
        side: string;
        amount_minor: bigint;
        source: string;
        source_ref: string | null;
        memo: string;
      }[]
    >`
      select e.seq, e.effective_date::text, e.booked_at::text, e.event_type,
             l.side, l.amount_minor, e.source, e.source_ref, e.memo
        from journal_lines l
        join journal_entries e on e.id = l.entry_id
       where l.account_code = ${code}
         and (${asOf}::date is null or e.effective_date <= ${asOf}::date)
       order by e.seq
    `;

    let running = 0n;
    const rendered = lines.map((l) => {
      const signed =
        l.side === account.normal ? BigInt(l.amount_minor) : -BigInt(l.amount_minor);
      running += signed;
      return `#${l.seq}  ${l.effective_date}  ${l.event_type.padEnd(26)} ${l.side.padEnd(6)} ${format(BigInt(l.amount_minor)).padStart(13)}  running ${format(running).padStart(13)}  ${l.source}${l.source_ref ? ` ${l.source_ref}` : ''}`;
    });

    return [
      `${code} ${account.name} — ${lines.length} line(s)${asOf ? ` effective on or before ${asOf}` : ''}`,
      ...rendered,
      `balance ${format(running)}`,
      'This balance is not stored anywhere. It is the sum of the lines above.',
    ].join('\n');
  }

  if (name === 'list_reconciliation_breaks') {
    const breaks = await listBreaks();
    if (breaks.length === 0) return 'No open reconciliation breaks.';
    return breaks
      .map(
        (b) =>
          `${b.kind}  ${b.providerReference ?? '—'}  provider ${b.providerAmountMinor === null ? '—' : format(b.providerAmountMinor)}  ledger ${b.ledgerAmountMinor === null ? '—' : format(b.ledgerAmountMinor)}  age ${b.ageDays}d\n    ${b.detail}`,
      )
      .join('\n');
  }

  if (name === 'propose_endorsement') {
    const policyNumber = String(args.policy_number ?? '');
    const [row] = await sql<{ id: string; state_code: string }[]>`
      select id, state_code from policies where policy_number = ${policyNumber}
    `;
    if (!row) throw new Error(`no policy numbered ${policyNumber}`);

    const [agent] = await sql<{ id: string }[]>`
      select id from users where role = 'staff' order by created_at limit 1
    `;

    const vehicles = Number(args.vehicles ?? 0);
    const squareFeet = Number(args.square_feet ?? 0);
    const exposures: Exposure[] = [];
    for (let i = 0; i < vehicles; i += 1) {
      exposures.push({
        kind: 'vehicle',
        description: `Scheduled unit ${i + 1}`,
        vin: `TESTVIN${String(i + 1).padStart(10, '0')}`,
        garageState: row.state_code,
      });
    }
    if (squareFeet > 0) {
      exposures.push({
        kind: 'location',
        description: 'Primary premises',
        squareFeet,
        state: row.state_code,
      });
    }

    const input = {
      policyId: row.id,
      effectiveDate: String(args.effective_date ?? ''),
      limitMinor: minor(String(args.limit ?? '1000000.00')),
      deductibleMinor: minor(String(args.deductible ?? '2500.00')),
      exposures,
      description: String(args.description ?? ''),
      actor: 'agent:mcp',
    };

    const pricing = await priceEndorsement(input);

    const approvalId = await requestApproval({
      kind: 'endorsement',
      payload: {
        policyId: row.id,
        effectiveDate: input.effectiveDate,
        limitMinor: input.limitMinor.toString(),
        deductibleMinor: input.deductibleMinor.toString(),
        exposures: JSON.stringify(exposures),
        description: input.description,
        actor: 'agent:mcp',
        policyNumber,
        proRataMinor: pricing.proRataPremiumMinor.toString(),
      },
      amountMinor: pricing.totalMinor,
      requestedBy: agent.id,
      requestedVia: 'mcp agent surface',
    });

    return [
      'Nothing was posted to the ledger.',
      `A proposal was filed in the human approval queue as ${approvalId}.`,
      '',
      `policy         ${policyNumber}`,
      `effective      ${input.effectiveDate}`,
      `annual delta   ${format(pricing.annualDeltaMinor)}`,
      `pro-rata       ${format(pricing.proRataPremiumMinor)} over ${pricing.daysRemaining} of ${pricing.termDays} days`,
      `surcharges     ${format(pricing.surchargeTotalMinor)}`,
      `total          ${format(pricing.totalMinor)}`,
      `threshold      ${format(thresholdMinor())}`,
      '',
      'A member of staff must approve this before any money moves, and the agent can never be that approver.',
    ].join('\n');
  }

  throw new Error(`unknown tool ${name}`);
}

const NEVER_LIST = [
  {
    operation: 'Cancelling a policy and issuing the refund',
    why: 'It moves money outward on a real rail and ends cover. A wrong cancellation is not merely a bad number, it leaves a business uninsured.',
  },
  {
    operation: 'Paying a claim',
    why: 'Irreversible outbound payment to a third party. The reserve, the limit and the payee bank check all have to be judged together, and the loss from getting it wrong is unbounded.',
  },
  {
    operation: 'Posting a correction — reversal plus re-book',
    why: 'It rewrites what a closed period reports. Corrections are exactly where a plausible-sounding mistake does the most damage, because the output still reconciles.',
  },
  {
    operation: 'Adjusting commission or issuing a clawback',
    why: 'It changes what a counterparty is owed. That is a commercial negotiation with a person on the other end, not a calculation.',
  },
  {
    operation: 'Approving anything, including its own proposals',
    why: 'Maker-checker exists so a second human understands the change. An agent approving an agent is one actor wearing two hats, and the database rejects it regardless.',
  },
  {
    operation: 'Changing a broker KYB status',
    why: 'That is the gate on who may transact at all. It must come from the provider webhook, never from a caller that can be talked into it.',
  },
];
