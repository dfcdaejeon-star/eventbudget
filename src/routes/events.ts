import express from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { loadEvents, saveEvent, getEvent, attachReceipt, getUploadDirectory, getEventUploadDirectory, deleteEvent, createBackup, listBackups, restoreBackup } from '../store.ts';
import Ajv from 'ajv';
import eventSchema from '../schemas/eventSchema.ts';

const uploadDir = getUploadDirectory();
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const eventId = req.body?.eventId ?? 'misc';
    const targetDir = getEventUploadDirectory(eventId);
    fs.mkdir(targetDir, { recursive: true })
      .then(() => cb(null, targetDir))
      .catch((error) => cb(error, targetDir));
  },
  filename: (_req, file, cb) => {
    // sanitize original name
    const base = path.basename(file.originalname || 'file');
    const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  }
});
// Accept images and PDFs only, and limit size to 8MB
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /^(image\/.*|application\/pdf)$/i;
    if (allowed.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('허용되지 않는 파일 형식입니다. 이미지 또는 PDF만 업로드 가능합니다.'));
    }
  }
});

async function compressReceiptImage(filePath: string, mimeType: string) {
  if (!mimeType.startsWith('image/')) {
    return filePath;
  }

  const originalSize = (await fs.stat(filePath)).size;
  const maxBytes = 800 * 1024;
  if (originalSize <= maxBytes) {
    return filePath;
  }

  const extension = path.extname(filePath).toLowerCase();
  const targetPath = extension === '.jpg' || extension === '.jpeg' ? filePath : `${filePath}.jpg`;
  let quality = 85;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await sharp(filePath)
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .jpeg({ quality })
      .toFile(targetPath);

    const compressedSize = (await fs.stat(targetPath)).size;
    if (compressedSize <= maxBytes || quality <= 50) {
      break;
    }
    quality -= 10;
  }

  if (targetPath !== filePath) {
    await fs.unlink(filePath).catch(() => undefined);
  }

  return targetPath;
}

const ajv = new Ajv({ allErrors: true, strict: false });
const validateEventSchema = ajv.compile(eventSchema as any);

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const eventData = req.body;
    const valid = validateEventSchema(eventData as any);
    if (!valid) {
      return res.status(400).json({ error: '유효성 검사 실패', details: validateEventSchema.errors });
    }

    const saved = await saveEvent(eventData);
    res.json({ event: saved });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '이벤트 저장 중 오류가 발생했습니다.' });
  }
});

router.post('/backup', async (_req, res) => {
  try {
    const backupName = await createBackup();
    res.json({ backup: backupName });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '백업 생성 중 오류가 발생했습니다.' });
  }
});

router.get('/backups', async (_req, res) => {
  try {
    const backups = await listBackups();
    res.json({ backups });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '백업 목록을 가져오는 중 오류가 발생했습니다.' });
  }
});

router.post('/restore', async (req, res) => {
  try {
    const { backupName } = req.body;
    if (!backupName) return res.status(400).json({ error: 'backupName이 필요합니다.' });
    await restoreBackup(backupName);
    res.json({ restored: backupName });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '복원 중 오류가 발생했습니다.' });
  }
});

router.get('/', async (_req, res) => {
  try {
    const events = await loadEvents();
    res.json({ events });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '이벤트 목록을 불러오는 중 오류가 발생했습니다.' });
  }
});

router.get('/:eventId', async (req, res) => {
  try {
    const eventId = req.params.eventId;
    const event = await getEvent(eventId);
    if (!event) {
      return res.status(404).json({ error: '이벤트를 찾을 수 없습니다.' });
    }
    res.json({ event });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '이벤트 조회 중 오류가 발생했습니다.' });
  }
});

router.delete('/:eventId', async (req, res) => {
  try {
    const eventId = req.params.eventId;
    const events = await deleteEvent(eventId);
    res.json({ events });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '이벤트 삭제 중 오류가 발생했습니다.' });
  }
});

router.post('/receipt', upload.single('file'), async (req, res) => {
  try {
    const { eventId, expenseId } = req.body;
    if (!eventId || !expenseId) {
      return res.status(400).json({ error: 'eventId와 expenseId가 필요합니다.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: '파일이 첨부되지 않았습니다.' });
    }

    // additional extension check
    const allowedExt = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.tif', '.tiff'];
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    if (!allowedExt.includes(ext)) {
      // remove uploaded file
      await fs.unlink(req.file.path).catch(() => undefined);
      return res.status(400).json({ error: '허용되지 않는 파일 확장자입니다.' });
    }

    const compressedFilePath = await compressReceiptImage(req.file.path, req.file.mimetype);
    const finalFileName = path.basename(compressedFilePath);
    req.file.path = compressedFilePath;
    req.file.filename = finalFileName;

    const relativePath = `/uploads/${eventId}/${finalFileName}`;
    const receiptData = {
      receiptName: req.file.originalname,
      receiptPath: relativePath,
      receiptUploadedAt: new Date().toISOString()
    };

    const updatedExpense = await attachReceipt(eventId, expenseId, receiptData);
    res.json({ expense: updatedExpense });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '영수증 업로드 중 오류가 발생했습니다.' });
  }
});

export default router;
