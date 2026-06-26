import express from 'express';

const router = express.Router();

router.post('/', (req, res) => {
  const { password } = req.body ?? {};
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    console.error('ADMIN_PASSWORD 환경변수가 설정되지 않았습니다.');
    return res.status(500).json({ error: '서버 설정 오류입니다.' });
  }

  if (password === adminPassword) {
    return res.json({ ok: true });
  }

  return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
});

export default router;
