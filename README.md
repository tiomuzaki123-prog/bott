# YongYong Bot (MVP v1.0)

Bot WhatsApp grup berbasis Node.js dengan absensi, jadwal, kuis, tebak kata, poin, EXP, level, rank RPG, leaderboard, dan ekspor CSV.

## Persyaratan
- Node.js 18 atau lebih baru (disarankan versi LTS terbaru)
- Koneksi internet
- WhatsApp yang bisa menautkan perangkat
- VPS Linux untuk berjalan 24 jam (opsional untuk uji coba lokal)

## Instalasi
1. Ekstrak folder proyek.
2. Buka terminal di folder `yongyong-bot`.
3. Salin `.env.example` menjadi `.env`, lalu sesuaikan `OWNER_NUMBER` jika perlu. Nomor gunakan format internasional tanpa `+`, misalnya `6281234567890`.
4. Jalankan:
   ```bash
   npm install
   npm run check
   npm start
   ```
5. QR akan tampil di terminal. Di WhatsApp ponsel buka **Perangkat tertaut > Tautkan perangkat**, lalu scan QR.
6. Setelah status `YongYong Bot aktif`, masukkan akun yang tertaut ke grup yang akan memakai bot.
7. Ketik `.menu` di grup.

Sesi WhatsApp tersimpan di `.wwebjs_auth/`, data bot di `data.json`, dan ekspor CSV di `exports/`. Jangan membagikan folder sesi `.wwebjs_auth/` karena sesi itu dapat memberi akses ke akun WhatsApp yang tertaut.

## Perintah umum
- `.menu`, `.bantuan`, `.ping`, `.info`
- `.masuk`, `.pulang`, `.absen`
- `.jadwal`, `.jadwal besok`, `.jadwal minggu`, `.detailjadwal ID`
- `.quiz [jumlah]` (1–20 soal)
- `.tebakkata`, `.tebakkata petunjuk`
- `.skor`, `.rank`, `.level`, `.profil`, `.ranklist`, `.toprank`
- `.leaderboard`, `.leaderboard minggu`, `.leaderboard bulan`, `.leaderboard level`

Jawaban permainan harus menggunakan fitur Reply pada pesan soal. Beberapa anggota dapat menjawab satu soal; setiap anggota hanya mendapat hadiah sekali per soal.

## Perintah admin
Admin utama diatur dengan `OWNER_NUMBER`. Admin tambahan dapat dikelola lewat `.tambahadmin 628xxxxxxxxxx` dan `.hapusadmin 628xxxxxxxxxx`.

- `.admin`
- `.tambahjadwal` — wizard bertahap; ikuti pertanyaan bot. Gunakan `.batal` untuk membatalkan.
- `.editjadwal ID` — wizard untuk mengganti seluruh detail jadwal.
- `.hapusjadwal ID`, `.semuajadwal`
- `.buatquiz` — wizard untuk soal, pilihan A-D, jawaban, kesulitan.
- `.hapusquiz ID`, `.daftarquiz`
- `.buattebakan` — wizard untuk kata, petunjuk, kesulitan.
- `.hapustebakan ID`, `.daftartebakan`
- `.rekap`, `.rekap minggu`, `.rekap bulan`
- `.eksporabsen [minggu|bulan]`, `.eksporjadwal`, `.ekspordata`
- `.daftaradmin`

Kesulitan soal memiliki tiga kategori `mudah`, `sedang`, dan `sulit` dengan hadiah masing-masing +10 poin/+20 EXP, +20 poin/+40 EXP, dan +30 poin/+60 EXP. Bot memperkirakan kesulitan secara otomatis memakai heuristik lokal sederhana berdasarkan kata kunci, panjang teks, dan pola angka. Ini bukan AI dan tidak selalu tepat; soal bawaan memiliki kategori awal yang sudah disediakan, sedangkan soal baru yang ditambahkan admin dikategorikan otomatis.

## Menjalankan di VPS 24/7 (Ubuntu/Debian)
Pasang Node.js LTS dan dependensi sistem yang diperlukan Puppeteer/Chromium. Lalu instal dependensi proyek dan jalankan dengan pengelola proses seperti `pm2`:
```bash
npm install
npm run check
npm install -g pm2
pm2 start index.js --name yongyong-bot
pm2 save
pm2 startup
```
Ikuti perintah yang dicetak oleh `pm2 startup`. Untuk melihat log: `pm2 logs yongyong-bot`.

## Catatan penting
- `whatsapp-web.js` mengendalikan WhatsApp Web dan bukan WhatsApp Business Platform/API resmi. Penggunaan klien tidak resmi bisa berubah sewaktu-waktu dan dapat menimbulkan risiko pembatasan akun. Untuk mengurangi dampak, uji coba dengan nomor khusus terlebih dahulu dan jangan mengirim pesan massal/spam.
- Bot ini hanya memproses pesan grup (`@g.us`).
- `.rekap` dan perintah ekspor dibatasi ke admin bot.
- Data disimpan di JSON untuk membuat MVP mudah dijalankan tanpa server database tambahan. Backup rutin `data.json` sangat disarankan.
- Penamaan/ID anggota mengacu pada ID WhatsApp; nama tampilan yang disimpan diperbarui dari kontak ketika anggota mengirim pesan.
- Ini versi awal. Uji dulu di grup kecil sebelum dipakai untuk absensi penting.
