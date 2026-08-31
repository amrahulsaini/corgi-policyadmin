import postgres from 'postgres';
import { runMigrations } from '../lib/db/migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

runMigrations(sql)
  .then(async (ran) => {
    console.log(ran.length ? `applied ${ran.join(', ')}` : 'nothing to apply');
    await sql.end();
  })
  .catch(async (err) => {
    console.error(err);
    await sql.end();
    process.exit(1);
  });
