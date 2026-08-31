import { createHmac, timingSafeEqual } from 'node:crypto';

const BASE = 'https://api.withpersona.com/api/v1';

function apiKey(): string {
  const key = process.env.PERSONA_API_KEY;
  if (!key) throw new Error('PERSONA_API_KEY is not set');
  if (!key.includes('sandbox')) {
    throw new Error('refusing to start with a Persona key that is not a sandbox key');
  }
  return key;
}

function templateId(): string {
  const id = process.env.PERSONA_TEMPLATE_ID;
  if (!id) throw new Error('PERSONA_TEMPLATE_ID is not set');
  return id;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(12_000),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Persona ${response.status}: ${body.slice(0, 300)}`);
  }
  return JSON.parse(body) as T;
}

export type PersonaInquiry = {
  id: string;
  status: string;
  referenceId: string | null;
};

export async function createInquiry(referenceId: string): Promise<PersonaInquiry> {
  const json = await call<{
    data: { id: string; attributes: { status: string; 'reference-id': string | null } };
  }>('/inquiries', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        attributes: {
          'inquiry-template-id': templateId(),
          'reference-id': referenceId,
        },
      },
    }),
  });

  return {
    id: json.data.id,
    status: json.data.attributes.status,
    referenceId: json.data.attributes['reference-id'],
  };
}

export async function oneTimeLink(inquiryId: string): Promise<string> {
  const json = await call<{ meta?: { 'one-time-link'?: string } }>(
    `/inquiries/${inquiryId}/generate-one-time-link`,
    { method: 'POST' },
  );
  const link = json.meta?.['one-time-link'];
  if (!link) throw new Error('Persona returned no one-time link');
  return link;
}

export async function readInquiry(inquiryId: string): Promise<PersonaInquiry> {
  const json = await call<{
    data: { id: string; attributes: { status: string; 'reference-id': string | null } };
  }>(`/inquiries/${inquiryId}`);
  return {
    id: json.data.id,
    status: json.data.attributes.status,
    referenceId: json.data.attributes['reference-id'],
  };
}

export function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.PERSONA_WEBHOOK_SECRET;
  if (!secret || !header) return false;

  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const [k, ...rest] = p.trim().split('=');
      return [k, rest.join('=')];
    }),
  );

  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;

  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(v1, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function mapStatus(personaStatus: string): 'pending' | 'approved' | 'failed' {
  const s = personaStatus.toLowerCase();
  if (s === 'completed' || s === 'approved') return 'approved';
  if (s === 'failed' || s === 'declined' || s === 'expired') return 'failed';
  return 'pending';
}
