import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Ajv from 'ajv';
import eventSchema from './schemas/eventSchema.ts';

const baseDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(baseDir, '../data/events');
const uploadDir = path.join(baseDir, '../uploads');
const backupDir = path.join(baseDir, '../backups');

export type EventData = Record<string, any>;

async function ensureStorage() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(uploadDir, { recursive: true });
}

function getEventFilePath(eventId: string) {
  return path.join(dataDir, `${eventId}.json`);
}

export function getUploadDirectory() {
  return uploadDir;
}

export function getEventUploadDirectory(eventId: string) {
  return path.join(uploadDir, eventId);
}

export async function loadEvents() {
  await ensureStorage();
  const entries = await fs.readdir(dataDir);
  const events: EventData[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const filePath = path.join(dataDir, entry);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as EventData;
      if (parsed?.id) {
        events.push(parsed);
      }
    } catch {
      // Ignore malformed event files and continue.
    }
  }

  return events.sort((left, right) => (left.name ?? '').localeCompare(right.name ?? ''));
}

export async function createBackup() {
  await ensureStorage();
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(backupDir, `backup-${stamp}`);
  // copy dataDir to dest
  await fs.cp(dataDir, dest, { recursive: true });
  return path.basename(dest);
}

export async function listBackups() {
  await ensureStorage();
  try {
    const entries = await fs.readdir(backupDir);
    return entries.filter((e) => e.startsWith('backup-')).sort().reverse();
  } catch {
    return [];
  }
}

export async function restoreBackup(backupName: string) {
  await ensureStorage();
  const src = path.join(backupDir, backupName);
  // ensure backup exists
  try {
    await fs.access(src);
  } catch (err) {
    throw new Error('백업을 찾을 수 없습니다.');
  }

  // clear dataDir and copy
  const tempDir = path.join(baseDir, `../data/_tmp_restore_${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  await fs.cp(src, tempDir, { recursive: true });

  // Validate JSON files in the temp restore directory before moving into place
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(eventSchema as any);

  async function validateRecursive(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await validateRecursive(full);
        continue;
      }
      if (!entry.name.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(full, 'utf8');
        const parsed = JSON.parse(raw);
        const ok = validate(parsed as any);
        if (!ok) {
          // cleanup temp and throw with validation details
          await fs.rm(tempDir, { recursive: true, force: true });
          throw new Error(`복원 데이터 유효성 검사 실패: ${full} - ${JSON.stringify(validate.errors)}`);
        }
      } catch (err) {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
        throw err;
      }
    }
  }

  await validateRecursive(tempDir);

  // remove existing dataDir contents and move temp into place
  const entries = await fs.readdir(dataDir).catch(() => []);
  for (const entry of entries) {
    const p = path.join(dataDir, entry);
    await fs.rm(p, { recursive: true, force: true });
  }

  // copy restored files back to dataDir
  await fs.cp(tempDir, dataDir, { recursive: true });
  // cleanup temp
  await fs.rm(tempDir, { recursive: true, force: true });
  return true;
}

export async function getEvent(eventId: string) {
  await ensureStorage();
  const filePath = getEventFilePath(eventId);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as EventData;
  } catch {
    return null;
  }
}

export async function saveEvent(eventData: EventData) {
  await ensureStorage();
  const filePath = getEventFilePath(eventData.id);
  await fs.writeFile(filePath, JSON.stringify(eventData, null, 2), 'utf8');
  return eventData;
}

export async function attachReceipt(eventId: string, expenseId: string, receiptData: Record<string, any>) {
  const event = await getEvent(eventId);
  if (!event) {
    throw new Error(`Event not found: ${eventId}`);
  }

  const expenseIndex = event.expenses?.findIndex((expense: Record<string, any>) => expense.id === expenseId);
  if (expenseIndex == null || expenseIndex < 0) {
    throw new Error(`Expense item not found: ${expenseId}`);
  }

  event.expenses[expenseIndex] = {
    ...event.expenses[expenseIndex],
    ...receiptData
  };

  await saveEvent(event);
  return event.expenses[expenseIndex];
}

export async function deleteEvent(eventId: string) {
  await ensureStorage();
  const filePath = getEventFilePath(eventId);
  const eventUploadDir = getEventUploadDirectory(eventId);

  await fs.rm(filePath, { force: true });
  await fs.rm(eventUploadDir, { recursive: true, force: true });
  return loadEvents();
}
