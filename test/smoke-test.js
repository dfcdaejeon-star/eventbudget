#!/usr/bin/env node
/** Simple smoke test for core API flows. Run after backend is running. */
import fs from 'fs';
const fetcher = globalThis.fetch ? globalThis.fetch.bind(globalThis) : null;
let fetchFunc = fetcher;
if (!fetchFunc) {
  const mod = await import('node-fetch').catch(() => null);
  fetchFunc = mod?.default ?? null;
}
if (!fetchFunc) {
  console.error('No fetch available. Please run on Node 18+ or install node-fetch.');
  process.exit(1);
}
const API = process.env.API_BASE || 'http://localhost:4000/api/events';

async function run() {
  console.log('1) GET events');
  const list = await (await fetchFunc(`${API}`)).json();
  console.log('events count:', (list.events || []).length);

  console.log('2) POST create event');
  const sample = {
    id: `smoke-${Date.now()}`,
    name: 'Smoke Test Event',
    organizer: 'Tester',
    financeManager: 'Tester',
    period: 'today',
    notes: 'auto-generated',
    incomes: [{ id: 'i1', category: 'test', description: 'd', amount: 1000, note: '' }],
    expenses: [{ id: 'e1', date: '2026-01-01', department: 'ops', purpose: 'test', item: 'item', amount: 500, note: '' }]
  };
  const created = await (await fetchFunc(`${API}`, { method: 'POST', body: JSON.stringify(sample), headers: { 'Content-Type': 'application/json' } })).json();
  console.log('created id:', created.event?.id);

  console.log('3) POST backup');
  const backup = await (await fetchFunc(`${API}/backup`, { method: 'POST' })).json();
  console.log('backup created:', backup.backup);

  console.log('4) GET backups');
  const backups = await (await fetchFunc(`${API}/backups`)).json();
  console.log('backups:', backups.backups?.slice(0, 3));

  console.log('5) POST restore (latest)');
  const latest = backups.backups?.[0];
  if (latest) {
    const res = await (await fetchFunc(`${API}/restore`, { method: 'POST', body: JSON.stringify({ backupName: latest }), headers: { 'Content-Type': 'application/json' } })).json();
    console.log('restore result:', res);
  } else {
    console.log('no backups to restore');
  }

  console.log('Smoke test done.');
}

run().catch((err) => {
  console.error('Smoke test failed', err);
  process.exit(1);
});
