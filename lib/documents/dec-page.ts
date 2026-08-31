import PDFDocument from 'pdfkit';
import { createHash } from 'node:crypto';
import { sql } from '@/lib/db';
import { format } from '@/lib/money';
import { dayCount, layerEarnedAsOf, type IsoDate } from '@/lib/premium';
import { loadPolicyAsOf } from '@/lib/policy/view';

const INK = '#16130f';
const SOFT = '#5b544c';
const ACCENT = '#d1541f';
const LINE = '#e7e0d6';

export async function declarationsPage(
  policyId: string,
  asOf: IsoDate,
  knownAt: Date | null = null,
): Promise<{ pdf: Buffer; hash: string }> {
  const view = await loadPolicyAsOf(policyId, asOf, knownAt);
  if (!view) throw new Error('policy not found');

  const { header } = view;

  const doc = new PDFDocument({ size: 'LETTER', margin: 54, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  doc.fillColor(ACCENT).rect(54, 54, 26, 26).fill();
  doc.fillColor(INK).fontSize(18).font('Helvetica-Bold').text('Corgi', 90, 58);
  doc.fillColor(SOFT).fontSize(9).font('Helvetica').text('Commercial General Liability', 90, 78);

  doc
    .fillColor(INK)
    .fontSize(15)
    .font('Helvetica-Bold')
    .text('Declarations Page', 54, 110);

  doc
    .fillColor(SOFT)
    .fontSize(9)
    .font('Helvetica')
    .text(
      `The policy as it stood on ${asOf}${knownAt ? `, as known at ${knownAt.toISOString().slice(0, 16)}` : ''}. Generated from the ledger, not transcribed.`,
      54,
      130,
      { width: 500 },
    );

  let y = 158;
  y = section(doc, y, 'Named insured and policy');
  y = pair(doc, y, 'Policy number', header.policyNumber, 'Status', header.status);
  y = pair(doc, y, 'Named insured', header.customerName, 'Risk state', header.stateCode);
  y = pair(
    doc,
    y,
    'Policy period',
    `${header.termStart} to ${header.termEnd}`,
    'Days in term',
    String(dayCount(header.termStart, header.termEnd)),
  );
  y = pair(doc, y, 'Produced by', header.brokerName, 'Product', header.productCode);

  y += 10;
  y = section(doc, y, 'Limits of insurance');
  y = pair(
    doc,
    y,
    'Each occurrence limit',
    view.version ? format(view.version.limitMinor) : '—',
    'Deductible',
    view.version ? format(view.version.deductibleMinor) : '—',
  );

  y += 10;
  y = section(doc, y, 'Schedule of covered exposures');
  const exposures = view.version?.exposures ?? [];
  if (exposures.length === 0) {
    doc.fillColor(SOFT).fontSize(9).font('Helvetica').text('None scheduled.', 54, y);
    y += 16;
  } else {
    for (const e of exposures) {
      const text =
        e.kind === 'vehicle'
          ? `Vehicle · ${e.description} · VIN ${e.vin} · garaged ${e.garageState}`
          : `Location · ${e.description} · ${e.squareFeet.toLocaleString('en-US')} sq ft · ${e.state}`;
      doc.fillColor(INK).fontSize(9).font('Helvetica').text(text, 54, y, { width: 500 });
      y += 14;
    }
  }

  y += 10;
  y = section(doc, y, 'Premium');

  const rows: [string, string][] = [
    ['Written premium', format(view.writtenMinor)],
    [`Earned as at ${asOf}`, format(view.earnedMinor)],
    ['Unearned premium', format(view.unearnedMinor)],
  ];
  for (const [label, value] of rows) {
    doc.fillColor(SOFT).fontSize(9).font('Helvetica').text(label, 54, y);
    doc.fillColor(INK).font('Helvetica-Bold').text(value, 380, y, { width: 174, align: 'right' });
    y += 15;
  }

  y += 6;
  doc.moveTo(54, y).lineTo(558, y).strokeColor(LINE).stroke();
  y += 10;

  doc.fillColor(SOFT).fontSize(8).font('Helvetica-Bold').text('PREMIUM LAYERS', 54, y);
  y += 14;
  doc.fontSize(8).font('Helvetica');
  doc.fillColor(SOFT).text('From', 54, y).text('To', 130, y).text('Amount', 206, y);
  doc.text(`Earned at ${asOf}`, 300, y);
  y += 12;

  for (const layer of view.layers) {
    doc.fillColor(INK).fontSize(8).font('Helvetica');
    doc.text(layer.startsOn, 54, y);
    doc.text(layer.endsOn, 130, y);
    doc.text(format(layer.amountMinor), 206, y);
    doc.text(format(layerEarnedAsOf(layer, asOf)), 300, y);
    y += 12;
  }

  y += 10;
  y = section(doc, y, 'Taxes and fees');
  const surcharges = await sql<{ account_code: string; name: string; amount: bigint }[]>`
    select l.account_code, a.name,
           sum(case when l.side = 'credit' then l.amount_minor else -l.amount_minor end) as amount
      from journal_lines l
      join journal_entries e on e.id = l.entry_id
      join ledger_accounts a on a.code = l.account_code
     where e.policy_id = ${policyId}::uuid
       and l.account_code in ('2100', '2110', '4100')
       and e.effective_date <= ${asOf}::date
     group by l.account_code, a.name
     order by l.account_code
  `;

  if (surcharges.length === 0) {
    doc.fillColor(SOFT).fontSize(9).font('Helvetica').text('None charged.', 54, y);
    y += 15;
  } else {
    for (const s of surcharges) {
      doc.fillColor(SOFT).fontSize(9).font('Helvetica').text(s.name, 54, y);
      doc
        .fillColor(INK)
        .font('Helvetica')
        .text(format(BigInt(s.amount)), 380, y, { width: 174, align: 'right' });
      y += 15;
    }
    doc
      .fillColor(SOFT)
      .fontSize(8)
      .font('Helvetica-Oblique')
      .text(
        'Taxes and fees are collected alongside premium and are excluded from the earned-premium calculation above.',
        54,
        y + 2,
        { width: 500 },
      );
    y += 24;
  }

  y += 8;
  y = section(doc, y, 'Endorsement schedule');
  const endorsements = view.versions.filter((v) => v.versionNo > 1);
  if (endorsements.length === 0) {
    doc.fillColor(SOFT).fontSize(9).font('Helvetica').text('No endorsements attach to this policy.', 54, y);
    y += 15;
  } else {
    for (const v of endorsements) {
      doc
        .fillColor(INK)
        .fontSize(9)
        .font('Helvetica-Bold')
        .text(`No. ${v.versionNo} — ${v.kind}`, 54, y);
      doc
        .fillColor(SOFT)
        .fontSize(8)
        .font('Helvetica')
        .text(`Effective ${v.effectiveDate} · booked ${v.bookedAt.slice(0, 16)}`, 54, y + 12);
      doc.fillColor(INK).fontSize(8).text(v.description, 54, y + 23, { width: 500 });
      y += 42;
    }
  }

  doc
    .fillColor(SOFT)
    .fontSize(7)
    .font('Helvetica')
    .text(
      'Sandbox document. No live keys, no real money, no real personal data. Every figure on this page is summed from immutable journal entries at the moment of generation.',
      54,
      720,
      { width: 504 },
    );

  doc.end();
  const pdf = await done;
  const hash = createHash('sha256').update(pdf).digest('hex');

  await sql`
    insert into documents (policy_id, version_id, kind, as_of_date, content, content_hash)
    values (${policyId}::uuid, ${view.version?.id ?? null}::uuid, 'declarations',
            ${asOf}::date, ${pdf}, ${hash})
  `;

  return { pdf, hash };
}

function section(doc: PDFKit.PDFDocument, y: number, title: string): number {
  doc.fillColor(ACCENT).fontSize(8).font('Helvetica-Bold').text(title.toUpperCase(), 54, y);
  doc.moveTo(54, y + 12).lineTo(558, y + 12).strokeColor(LINE).stroke();
  return y + 20;
}

function pair(
  doc: PDFKit.PDFDocument,
  y: number,
  leftLabel: string,
  leftValue: string,
  rightLabel: string,
  rightValue: string,
): number {
  doc.fillColor(SOFT).fontSize(8).font('Helvetica').text(leftLabel, 54, y);
  doc.fillColor(INK).fontSize(9).font('Helvetica-Bold').text(leftValue, 54, y + 10, { width: 240 });
  doc.fillColor(SOFT).fontSize(8).font('Helvetica').text(rightLabel, 310, y);
  doc.fillColor(INK).fontSize(9).font('Helvetica-Bold').text(rightValue, 310, y + 10, { width: 240 });
  return y + 30;
}
