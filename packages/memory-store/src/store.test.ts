import { describe, expect, it } from 'vitest';
import { FIXTURE, FIXTURE_LOG, projectMemory } from '@hybrid/memory-domain';
import { MemoryEventStore } from './eventStore';
import { loadLog } from './loadFixture';

describe('MemoryEventStore', () => {
  it('replays the fixture log and reproduces the fixture', async () => {
    const store = new MemoryEventStore();
    expect(await loadLog(store)).toBe(FIXTURE_LOG.events.length);
    const log = await store.readLog();
    expect(log).toEqual(FIXTURE_LOG);
    expect(projectMemory(log, { label: FIXTURE.label })).toEqual(FIXTURE);
  });

  it('refuses to load on top of an existing log', async () => {
    const store = new MemoryEventStore(FIXTURE_LOG);
    await expect(loadLog(store)).rejects.toThrow(/refusing to load/);
  });

  it('reads the log after a position', async () => {
    const store = new MemoryEventStore(FIXTURE_LOG);
    const tail = await store.readLog(FIXTURE_LOG.events.length - 2);
    expect(tail.events.map((e) => e.position)).toEqual([
      FIXTURE_LOG.events.length - 1,
      FIXTURE_LOG.events.length,
    ]);
  });
});
