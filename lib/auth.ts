import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import { compare, hash } from 'bcryptjs';
import { sql } from '@/lib/db';

const COOKIE = 'corgi_session';
const MAX_AGE = 60 * 60 * 12;

export type Role = 'staff' | 'broker' | 'customer';

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  brokerId: string | null;
  customerId: string | null;
};

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error('SESSION_SECRET is not set');
  return new TextEncoder().encode(value);
}

export function hashPassword(plain: string) {
  return hash(plain, 10);
}

export async function signIn(email: string, password: string): Promise<SessionUser | null> {
  const [row] = await sql<
    {
      id: string;
      email: string;
      name: string;
      role: Role;
      password_hash: string;
      broker_id: string | null;
      customer_id: string | null;
    }[]
  >`select id, email, name, role, password_hash, broker_id, customer_id
      from users where lower(email) = lower(${email})`;
  if (!row) return null;
  if (!(await compare(password, row.password_hash))) return null;

  const token = await new SignJWT({ role: row.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(row.id)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  });

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    brokerId: row.broker_id,
    customerId: row.customer_id,
  };
}

export async function signOut() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  let subject: string;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    subject = payload.sub;
  } catch {
    return null;
  }

  const [row] = await sql<
    {
      id: string;
      email: string;
      name: string;
      role: Role;
      broker_id: string | null;
      customer_id: string | null;
    }[]
  >`select id, email, name, role, broker_id, customer_id from users where id = ${subject}::uuid`;
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    brokerId: row.broker_id,
    customerId: row.customer_id,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(landingFor(user.role));
  return user;
}

export function landingFor(role: Role): string {
  if (role === 'staff') return '/staff';
  if (role === 'broker') return '/broker';
  return '/portal';
}
