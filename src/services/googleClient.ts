import { google } from 'googleapis';

export function createGoogleClient() {
  // TODO: 서비스 계정 또는 OAuth 인증 설정
  const auth = new google.auth.GoogleAuth({
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file'
    ]
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const drive = google.drive({ version: 'v3', auth });

  return { auth, sheets, drive };
}
