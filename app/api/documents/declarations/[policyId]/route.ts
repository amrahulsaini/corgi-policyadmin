import { currentUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { declarationsPage } from '@/lib/documents/dec-page';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ policyId: string }> },
) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'not signed in' }, { status: 401 });

  const { policyId } = await context.params;
  const url = new URL(request.url);
  const asOf = url.searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return Response.json({ error: 'asOf must be a YYYY-MM-DD date' }, { status: 400 });
  }

  const [allowed] = await sql<{ ok: boolean }[]>`
    select (
      ${user.role} = 'staff'
      or (${user.role} = 'broker' and p.broker_id = ${user.brokerId ?? null}::uuid)
      or (${user.role} = 'customer' and p.customer_id = ${user.customerId ?? null}::uuid)
    ) as ok
    from policies p where p.id = ${policyId}::uuid
  `;

  if (!allowed) return Response.json({ error: 'no such policy' }, { status: 404 });
  if (!allowed.ok) return Response.json({ error: 'not yours to read' }, { status: 403 });

  try {
    const { pdf, hash } = await declarationsPage(policyId, asOf);
    return new Response(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="declarations-${asOf}.pdf"`,
        'x-document-sha256': hash,
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'could not generate the document' },
      { status: 500 },
    );
  }
}
