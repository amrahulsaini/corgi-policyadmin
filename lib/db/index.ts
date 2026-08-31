import postgres from 'postgres';

declare global {
  var __corgiSql: ReturnType<typeof postgres> | undefined;
}

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return postgres(url, {
    max: 5,
    idle_timeout: 20,
    prepare: false,
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (v: bigint | number) => v.toString(),
        parse: (v: string) => BigInt(v),
      },
    },
  });
}

export const sql = globalThis.__corgiSql ?? connect();

if (process.env.NODE_ENV !== 'production') globalThis.__corgiSql = sql;
