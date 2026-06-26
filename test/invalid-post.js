#!/usr/bin/env node
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
  const res = await fetchFunc(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  console.log('status:', res.status);
  const body = await res.text();
  console.log('body:', body);
}

run().catch(err => { console.error(err); process.exit(1); });
