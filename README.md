# Sistem Nilai dengan Zero Trust Security

## Identitas
- Nama: Dwiki Muhammad Wasfi
- NPM: 247006111136
- Kelas: E
- Program Studi Informatika, Universitas Siliwangi
- Mata kuliah: Keamanan Informasi

## Deskripsi
Backend pengelolaan nilai dan transkrip dengan pemeriksaan token,
role, kepemilikan data, device terdaftar, dan jam akses.

## Arsitektur
- API Gateway: port 3000.
- Service Nilai: port 3001.
- Service Transkrip: port 3002.
- Database bersama: SQLite.
- Policy Engine: gateway/policy.js.

Seluruh request client dan panggilan antar-service melalui gateway.
Service memeriksa gateway secret serta tanda tangan dan masa berlaku token.

Alur finalisasi:
Dosen -> Gateway -> Service Nilai -> Gateway -> Service Transkrip.

## Instalasi pada Komputer Baru
Diperlukan Node.js dan npm yang kompatibel dengan dependensi proyek.

Jalankan dari folder utama:
    npm ci
    npm run setup
    npm run seed

Script setup membuat .env dengan secret acak jika belum tersedia.
Script seed mengisi data awal jika database belum berisi akun.

## Menjalankan Sistem
Buka tiga terminal pada folder utama proyek:

Terminal 1:
    npm run gateway

Terminal 2:
    npm run nilai

Terminal 3:
    npm run transkrip

Gunakan terminal keempat untuk pengujian.
URL client: http://127.0.0.1:3000

## Akun Awal
Password seluruh akun demo: Demo123!

| Username | Role | NIM | Device ID |
|---|---|---|---|
| admin | admin | - | device-admin |
| dosen1 | dosen | - | device-dosen1 |
| dosen2 | dosen | - | device-dosen2 |
| mhs1 | mahasiswa | 230001 | device-mhs1 |
| mhs2 | mahasiswa | 230002 | device-mhs2 |
| mhs3 | mahasiswa | 230003 | device-mhs3 |

## Kelas Awal
- ID 1: KI-E, Keamanan Informasi - E, pengampu dosen1.
- ID 2: BD-E, Basis Data - E, pengampu dosen2.
- Ketiga mahasiswa memiliki nilai pada kedua kelas.
- Pada database baru, kelas belum final dan transkrip kosong.

## Token
- Access token: JWT, berlaku 10 menit.
- Refresh token: berlaku 1 hari; hash disimpan di database.
- Token service: JWT dengan role service, berlaku 5 menit.
- Logout mencabut refresh token sesi tersebut.
- Access token tetap berlaku sampai kedaluwarsa.

Request resource user membawa:
    Authorization: Bearer <access_token>
    X-Device-ID: <device_id>

Gateway menambahkan X-Gateway-Secret saat meneruskan request.

## Endpoint
| Method | Endpoint | Akses |
|---|---|---|
| POST | /auth/login | Kredensial dan device valid |
| POST | /auth/refresh | Refresh token dan device sesi valid |
| POST | /auth/logout | Mencabut refresh token sesi valid |
| POST | /auth/service | Client ID dan secret service valid |
| GET | /nilai | Mahasiswa pemilik atau dosen pengampu |
| PUT | /nilai/:id | Dosen pengampu, belum final, dalam jam akses |
| POST | /kelas/:id/finalisasi | Dosen pengampu, dalam jam akses |
| GET | /transkrip/:nim | Mahasiswa pemilik atau admin |
| POST | /transkrip/sinkron | Hanya Service Nilai |

Contoh body login:
    {"username":"mhs1","password":"Demo123!"}

Contoh body perubahan nilai:
    {"score":88}

Contoh body refresh atau logout:
    {"refresh_token":"<refresh_token>"}

Contoh body permintaan token service:
    {"client_id":"service-nilai","client_secret":"<secret dari .env>"}

Contoh body sinkronisasi:
    {"class_id":1}

## Jam Akses
Konfigurasi standar pada .env:
    ACCESS_START_HOUR=7
    ACCESS_END_HOUR=21
    TZ=Asia/Jakarta

Perubahan dan finalisasi diizinkan mulai 07.00 sampai sebelum 21.00 WIB.
Pembacaan data tidak dibatasi jam tersebut.
Restart gateway setelah mengubah jam akses.
Untuk demo penerimaan, rentang dapat diatur menjadi 0 sampai 24.
Untuk demo penolakan, gunakan rentang yang tidak mencakup jam sekarang.
Kembalikan konfigurasi standar setelah pengujian.

## Finalisasi
Finalisasi mengunci nilai kelas, lalu menyinkronkan transkrip melalui gateway.
Jika sinkronisasi gagal, nilai tetap final.
Ulangi finalisasi dalam jam akses untuk mencoba sinkronisasi kembali.
Sinkronisasi berulang tidak menggandakan baris transkrip.

## Pengujian
- Login benar diterima; password salah dan device asing ditolak.
- Request tanpa token, token palsu, dan token kedaluwarsa ditolak.
- Device request harus sesuai token dan terdaftar untuk user.
- Mahasiswa hanya dapat membaca data miliknya.
- Dosen hanya dapat membaca dan mengubah nilai kelas yang diampu.
- Nilai final tidak dapat diubah.
- Finalisasi menghasilkan transkrip.
- Admin dapat membaca transkrip seluruh mahasiswa.
- Token user ditolak pada sinkronisasi.
- Token service dibatasi untuk sinkronisasi.
- Refresh berhasil sebelum logout dan ditolak setelah logout.
- Kedua service menolak akses langsung tanpa gateway secret.
- Secret benar dengan token tidak valid tetap ditolak.
- Perubahan dan finalisasi di luar jam akses ditolak.

## Audit Log
Gateway mencatat waktu, subjek, metode, endpoint, device, keputusan,
dan alasan pada tabel audit_logs.

Timestamp database menggunakan UTC.
Kebijakan jam akses menggunakan Asia/Jakarta.
Request langsung ke service tidak masuk audit log gateway.

## Struktur Kode
- gateway/index.js: aplikasi gateway.
- gateway/auth.js: autentikasi dan pengelolaan token.
- gateway/policy.js: kebijakan akses.
- gateway/resources.js: proxy dan pemasangan gateway secret.
- gateway/audit.js: audit log.
- services/nilai/index.js: pengelolaan nilai dan finalisasi.
- services/transkrip/index.js: pembacaan dan sinkronisasi transkrip.
- shared/database.js: koneksi dan skema database.
- shared/seed.js: data awal.
- shared/security.js: verifikasi secret dan token.
- scripts/setup-env.js: pembuat konfigurasi lokal.

## Catatan
Jangan unggah .env, node_modules, atau database runtime.
Sertakan .env.example, package.json, dan package-lock.json.
Restart ketiga aplikasi jika secret berubah.
Seed tidak menghapus hasil pengujian atau status finalisasi.
