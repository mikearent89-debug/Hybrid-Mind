import { FIXTURE_LABEL } from '@hybrid/memory-domain';
import { loadLog } from './loadFixture';
import { PgEventStore, createPool, migrate } from './pg';

const command = process.argv[2];
const pool = createPool();

try {
  if (command === 'migrate') {
    const ran = await migrate(pool);
    console.log(ran.length ? `applied ${ran.join(', ')}` : 'nothing to apply');
  } else if (command === 'load-fixture') {
    await migrate(pool);
    const n = await loadLog(new PgEventStore(pool));
    console.log(`loaded ${n} events of "${FIXTURE_LABEL}"`);
  } else {
    console.error('usage: cli.ts migrate | load-fixture');
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
