const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const destination = path.join(root, '.env');

if (fs.existsSync(destination)) {
  console.log('.env sudah tersedia. Konfigurasi dipertahankan.');
} else {
  const template = fs.readFileSync(
    path.join(root, '.env.example'), 'utf8'
  );

  const secretKeys = new Set([
    'JWT_SECRET',
    'GATEWAY_SECRET',
    'SERVICE_CLIENT_SECRET'
  ]);

  const content = template.split(/\r?\n/).map(line => {
    const key = line.split('=')[0];

    if (secretKeys.has(key)) {
      return `${key}=${crypto.randomBytes(32).toString('hex')}`;
    }

    return line;
  }).join('\n');

  fs.writeFileSync(destination, content, {
    encoding: 'utf8',
    flag: 'wx'
  });

  console.log('.env berhasil dibuat dengan secret acak.');
}
