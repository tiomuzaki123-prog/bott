'use strict';

require('dotenv').config();
console.log('[ENV DEBUG]', {
  cwd: process.cwd(),
  root: __dirname,
  envPath: require('path').join(__dirname, '.env'),
  envLoaded: require('fs').existsSync(require('path').join(__dirname, '.env'))
});
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('path').join(__dirname, 'ffmpeg.exe');
ffmpeg.setFfmpegPath(ffmpegPath);

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');
const EXPORT_DIR = path.join(ROOT, 'exports');
const OWNER_NUMBER = normalizeNumber(process.env.OWNER_NUMBER || '6285827884148');
console.log('[OWNER DEBUG]', {
  env: process.env.OWNER_NUMBER,
  owner: OWNER_NUMBER
});
const TZ = process.env.TZ || 'Asia/Jakarta';
const GAME_TIMEOUT_SECONDS = Math.max(15, Number(process.env.GAME_TIMEOUT_SECONDS || 60));

function normalizeNumber(value) {
  return String(value || '').replace(/\D/g, '').replace(/^0/, '62');
}
function localDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function localTime(date = new Date()) {
  return new Intl.DateTimeFormat('id-ID', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
}
function localDateTime(date = new Date()) { return `${localDate(date)} ${localTime(date)} WIB`; }
function safeName(value) { return String(value || 'Anggota').replace(/[\r\n]+/g, ' ').trim().slice(0, 60) || 'Anggota'; }
function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }

const defaultData = () => ({
  version: 1,
  admins: [],
  members: {},
  attendance: {},
  schedules: [],
  quizQuestions: [
    { id: 1, question: 'Berapakah hasil dari 12 × 8?', options: ['86', '96', '108', '112'], answer: 1, difficulty: 'mudah', enabled: true },
    { id: 2, question: 'Planet terbesar di tata surya adalah?', options: ['Bumi', 'Mars', 'Jupiter', 'Venus'], answer: 2, difficulty: 'mudah', enabled: true },
    { id: 3, question: 'Apa ibu kota Australia?', options: ['Sydney', 'Canberra', 'Melbourne', 'Perth'], answer: 1, difficulty: 'sedang', enabled: true },
    { id: 4, question: 'Unsur kimia dengan simbol Fe adalah?', options: ['Fluorin', 'Fosfor', 'Besi', 'Perak'], answer: 2, difficulty: 'sedang', enabled: true },
    { id: 5, question: 'Bilangan prima terkecil yang lebih besar dari 20 adalah?', options: ['21', '23', '25', '27'], answer: 1, difficulty: 'sulit', enabled: true }
  ],
  wordQuestions: [
    { id: 1, word: 'RUMAH', clue: 'Bangunan tempat tinggal.', difficulty: 'mudah', enabled: true },
    { id: 2, word: 'KOMPUTER', clue: 'Perangkat elektronik untuk mengolah data.', difficulty: 'sedang', enabled: true },
    { id: 3, word: 'GALAKSI', clue: 'Kumpulan besar bintang, gas, dan debu kosmik.', difficulty: 'sulit', enabled: true },
    { id: 4, word: 'SEKOLAH', clue: 'Tempat untuk belajar bersama guru.', difficulty: 'mudah', enabled: true },
    { id: 5, word: 'PETUALANGAN', clue: 'Perjalanan atau pengalaman yang penuh tantangan.', difficulty: 'sulit', enabled: true }
  ],
  nextScheduleId: 1,
  nextQuizId: 6,
  nextWordId: 6,
  pointEvents: [],
  notifiedSchedules: []
});

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return defaultData();
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const base = defaultData();
    return {
      ...base, ...raw,
      admins: Array.isArray(raw.admins) ? raw.admins : [],
      members: raw.members || {},
      attendance: raw.attendance || {},
      schedules: Array.isArray(raw.schedules) ? raw.schedules : [],
      quizQuestions: Array.isArray(raw.quizQuestions) ? raw.quizQuestions : base.quizQuestions,
      wordQuestions: Array.isArray(raw.wordQuestions) ? raw.wordQuestions : base.wordQuestions,
      pointEvents: Array.isArray(raw.pointEvents) ? raw.pointEvents : [],
      notifiedSchedules: Array.isArray(raw.notifiedSchedules) ? raw.notifiedSchedules : []
    };
  } catch (error) {
    console.error('Gagal membaca data.json:', error.message);
    throw new Error('data.json tidak bisa dibaca. Amankan/cadangkan file lalu perbaiki JSON.');
  }
}

let data = loadData();
let isSaving = false;

async function saveData() {
  if (isSaving) return;
  isSaving = true;
  try {
    const temp = `${DATA_FILE}.tmp`;
    await fsPromises.writeFile(temp, JSON.stringify(data, null, 2), 'utf8');
    await fsPromises.rename(temp, DATA_FILE);
  } catch (err) {
    console.error('Gagal menyimpan data:', err.message);
  } finally {
    isSaving = false;
  }
}

function ensureMember(id, name) {
  if (!data.members[id]) data.members[id] = { id, name: safeName(name), points: 0, exp: 0, createdAt: localDateTime() };
  data.members[id].name = safeName(name || data.members[id].name);
  if (!Number.isFinite(data.members[id].points)) data.members[id].points = 0;
  if (!Number.isFinite(data.members[id].exp)) data.members[id].exp = 0;
  return data.members[id];
}

function rankFor(points) {
  const ranks = [
    [0, 'Novice', '🌱'], [100, 'Bronze Adventurer', '🥉'], [300, 'Silver Knight', '🛡️'],
    [700, 'Gold Warrior', '⚔️'], [1500, 'Platinum Elite', '💠'], [3000, 'Diamond Champion', '💎'],
    [5000, 'Master Guardian', '🛡️'], [7500, 'Grandmaster', '👑'], [10000, 'Mythic Hero', '🔥'],
    [15000, 'Immortal', '🌌'], [25000, 'Divine Legend', '✨'], [50000, 'Eternal Overlord', '👑']
  ];
  let result = ranks[0], next = null;
  for (let i = 0; i < ranks.length; i++) {
    if (points >= ranks[i][0]) result = ranks[i];
    else { next = ranks[i]; break; }
  }
  return { name: result[1], icon: result[2], threshold: result[0], nextThreshold: next ? next[0] : null, nextName: next ? next[1] : null };
}

function levelFor(totalExp) {
  let level = 1, remaining = Math.max(0, Number(totalExp) || 0), need = 100;
  while (remaining >= need && level < 500) { remaining -= need; level++; need = 100 + (level - 1) * 50; }
  const title = level <= 5 ? 'Beginner' : level <= 10 ? 'Apprentice' : level <= 20 ? 'Fighter' : level <= 30 ? 'Veteran' : level <= 50 ? 'Expert' : level <= 75 ? 'Master' : level <= 99 ? 'Grandmaster' : 'Transcendent';
  return { level, title, currentExp: remaining, nextExp: need };
}

function difficultyReward(difficulty) {
  const key = String(difficulty || '').toLowerCase();
  if (key === 'sulit') return { points: 30, exp: 60, label: 'Sulit', icon: '🔴' };
  if (key === 'sedang') return { points: 20, exp: 40, label: 'Sedang', icon: '🟡' };
  return { points: 10, exp: 20, label: 'Mudah', icon: '🟢' };
}

function inferDifficulty(text, options = []) {
  const combined = `${text} ${options.join(' ')}`.toLowerCase();
  const hardTerms = ['analisis', 'mengapa', 'bandingkan', 'integral', 'turunan', 'probabilitas', 'konfigurasi', 'metamorfosis', 'fotosintesis', 'konstitusi', 'algoritma', 'kompleksitas'];
  const mediumTerms = ['menghitung', 'persentase', 'perkalian', 'pembagian', 'sejarah', 'geografi', 'unsur kimia', 'jelaskan', 'perbedaan', 'fungsi'];
  const digits = (combined.match(/\d+/g) || []).length;
  const words = combined.split(/\s+/).filter(Boolean).length;
  if (hardTerms.some(term => combined.includes(term)) || digits >= 3 || words > 35) return 'sulit';
  if (mediumTerms.some(term => combined.includes(term)) || digits >= 2 || words > 18) return 'sedang';
  return 'mudah';
}

function recordReward(memberId, memberName, difficulty, game, questionId) {
  const member = ensureMember(memberId, memberName);
  const reward = difficultyReward(difficulty);
  member.points += reward.points;
  member.exp += reward.exp;
  data.pointEvents.push({ memberId, memberName: member.name, points: reward.points, exp: reward.exp, game, questionId, date: localDate(), at: localDateTime() });
  if (data.pointEvents.length > 50000) data.pointEvents = data.pointEvents.slice(-50000);
  saveData();
  return { member, reward, rank: rankFor(member.points), level: levelFor(member.exp) };
}

function isAdmin(senderId) {
  
  const number = normalizeNumber(
    String(senderId || '').split('@')[0].split(':')[0]
  );

  console.log('[ADMIN DEBUG]', {
    senderId,
    number,
    owner: OWNER_NUMBER,
    matchOwner: number === OWNER_NUMBER,
    admins: data.admins
  });

  return Boolean(
    number &&
    (number === OWNER_NUMBER || data.admins.includes(number))
  );
}

async function isAdminMessage(msg, senderId) {
  // Pemeriksaan admin biasa
  if (isAdmin(senderId)) return true;

  const authorId = msg.author || msg.from;

  // Pemeriksaan tambahan untuk WhatsApp LID
  if (!authorId || !authorId.endsWith('@lid')) {
    return false;
  }

  try {
    const result = await client.getContactLidAndPhone([authorId]);
    const phoneId = result?.[0]?.pn || '';
    const phone = normalizeNumber(
      String(phoneId).split('@')[0].split(':')[0]
    );

    console.log('[OWNER LID DEBUG]', {
      authorId,
      phone,
      owner: OWNER_NUMBER,
      matchOwner: phone === OWNER_NUMBER
    });

    return Boolean(
      phone &&
      (phone === OWNER_NUMBER || data.admins.includes(phone))
    );
  } catch (err) {
    console.error('[OWNER LID ERROR]', err.message || err);
    return false;
  }
}


async function isOwnerMessage(msg, senderId) {
  const number = normalizeNumber(
    String(senderId || '').split('@')[0].split(':')[0]
  );

  // Jika nomor pengirim cocok dengan pemilik utama
  if (number === OWNER_NUMBER) return true;

  const authorId = msg.author || msg.from;

  // Jika bukan WhatsApp LID, tolak
  if (!authorId || !authorId.endsWith('@lid')) {
    return false;
  }

  try {
    const result = await client.getContactLidAndPhone([authorId]);
    const phoneId = result?.[0]?.pn || '';
    const phone = normalizeNumber(
      String(phoneId).split('@')[0].split(':')[0]
    );

    console.log('[OWNER CHECK DEBUG]', {
      authorId,
      phone,
      owner: OWNER_NUMBER,
      match: phone === OWNER_NUMBER
    });

    return Boolean(phone && phone === OWNER_NUMBER);
  } catch (err) {
    console.error('[OWNER CHECK ERROR]', err.message || err);
    return false;
  }
}


function senderKey(msg) {
  const raw = msg.fromMe ? '' : (msg.author || msg.from || '');
  return String(raw).split('@')[0].split(':')[0];
}

async function memberNameFromMessage(msg) {
  try {
    const contact = await msg.getContact();
    return safeName(contact.pushname || contact.name || contact.shortName || contact.number || 'Anggota');
  } catch { return 'Anggota'; }
}

function groupOnly(msg) { return String(msg.from || '').endsWith('@g.us'); }
function mentionId(msg) { return Array.isArray(msg.mentionedIds) && msg.mentionedIds.length ? msg.mentionedIds[0] : null; }
function mentionLabel(id) { return id ? `@${id.split('@')[0]}` : 'anggota'; }
function activeDateKey(date = new Date()) { return localDate(date); }
function attendanceKey(date, memberId) { return `${date}|${memberId}`; }

function parseDateArg(input) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input || '')) return null;
  const d = new Date(`${input}T12:00:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : input;
}
function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00+07:00`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
function monthStart(dateStr) { return `${dateStr.slice(0, 7)}-01`; }
function weekStart(dateStr) {
  const d = new Date(`${dateStr}T12:00:00+07:00`); const day = d.getUTCDay(); d.setUTCDate(d.getUTCDate() - ((day + 6) % 7)); return d.toISOString().slice(0, 10);
}

function escapeText(s) { return String(s ?? '').replace(/\r/g, '').trim(); }

async function downloadMediaWithRetry(message, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`[STIKER] Percobaan unduh ${i + 1}/${retries}`);

      const media = await Promise.race([
        message.downloadMedia(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Timeout unduh media setelah 20 detik')),
            20000
          )
        )
      ]);

      if (media && media.data) {
        console.log('[STIKER] Media berhasil diunduh');
        return media;
      }

      throw new Error('Media kosong atau gagal diunduh');
    } catch (err) {
      console.error('[STIKER] Unduhan gagal:', err.message || err);

      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
  }

  return null;
}


const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'yongyong-bot' }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] }
});

const activeGames = new Map();
const pendingFlows = new Map();

client.on('qr', qr => {
  console.log('\nScan QR ini lewat WhatsApp > Perangkat tertaut > Tautkan perangkat:\n');
  qrcode.generate(qr, { small: true });
});
client.on('authenticated', () => console.log('WhatsApp berhasil diautentikasi.'));
client.on('ready', () => {
  console.log('YongYong Bot aktif. Waktu server:', localDateTime());
  startScheduleNotifier();
});
client.on('auth_failure', msg => console.error('Autentikasi gagal:', msg));
client.on('disconnected', reason => console.warn('WhatsApp terputus:', reason));

async function send(chatId, text, options = {}) {
  try { return await client.sendMessage(chatId, text, options); }
  catch (e) { console.error('Gagal mengirim pesan:', e.message); return null; }
}

function startScheduleNotifier() {
  setInterval(async () => {
    try {
      const today = localDate();
      const currentTime = localTime();
      for (const s of data.schedules) {
        if (s.date === today && !data.notifiedSchedules.includes(s.id)) {
          if (s.start <= currentTime) {
            data.notifiedSchedules.push(s.id);
            await saveData();
          }
        }
      }
    } catch (e) {
      console.error('Error Schedule Notifier:', e.message);
    }
  }, 60000);
}


function helpText(admin) {
  return `🤖 *YONGYONG BOT*
━━━━━━━━━━━━━━
📋 *MENU UTAMA*

1. 📋 Absensi
   .menuabsen

2. 🎮 Permainan
   .menupermainan

3. 👤 Profil & Ranking
   .menuprofil

4. 📅 Jadwal
   .menujadwal

5. 🎨 Stiker
   .menustiker

6. ℹ️ Informasi
   .menuinfo
${admin ? `
7. 👑 Admin
   .menuadmin
` : ''}
Ketik *.allmenu* untuk melihat semua perintah.
━━━━━━━━━━━━━━`;
}

function categoryMenu(command, admin) {
  const menus = {
    '.menuabsen': `📋 *MENU ABSENSI*

• .masuk — Absen masuk
• .pulang — Absen pulang
• .absen — Cek absensi
• .rekap [hari|minggu|bulan] — Rekap laporan`,

    '.menupermainan': `🎮 *MENU PERMAINAN*

• .quiz [jumlah soal] — Mulai kuis
• .tebakkata [acak|petunjuk] — Tebak kata

💡 Jawab soal dengan membalas (Reply) pesan soal.`,

    '.menuprofil': `👤 *MENU PROFIL & RANKING*

• .profil — Profil anggota
• .skor — Skor dan EXP
• .level — Level karakter
• .rank [@anggota] — Cek rank
• .ranklist — Daftar rank
• .toprank — Peringkat RPG
• .leaderboard [minggu|bulan|level]`,

    '.menujadwal': `📅 *MENU JADWAL*

• .jadwal [besok|minggu] — Lihat jadwal
• .detailjadwal ID — Detail jadwal`,

    '.menustiker': `🎨 *MENU STIKER*

• .stiker
• .s

Kirim atau balas gambar dengan caption perintah di atas.`,

    '.menuinfo': `ℹ️ *MENU INFORMASI*

• .menu — Menu utama
• .bantuan — Bantuan
• .allmenu — Semua perintah
• .ping — Cek bot aktif
• .info — Informasi bot`
  };

  if (command === '.menuadmin') {
    if (!admin) return '⛔ Menu ini khusus admin bot.';

    return `👑 *MENU ADMIN*

📋 *Absensi & Data*
• .rekap [hari|minggu|bulan]
• .eksporabsen [hari|minggu|bulan]
• .ekspordata

📅 *Jadwal*
• .tambahjadwal
• .editjadwal ID
• .hapusjadwal ID
• .semuajadwal
• .eksporjadwal

🎮 *Kelola Permainan*
• .buatquiz
• .hapusquiz ID
• .daftarquiz
• .buattebakan
• .hapustebakan ID
• .daftartebakan

👑 *Admin Bot*
• .tambahadmin 628xxxxxxxxxx
• .hapusadmin 628xxxxxxxxxx
• .daftaradmin`;
  }

  return menus[command] || null;
}

function allMenuText(admin) {
  let text = `🤖 *YONGYONG BOT — SEMUA MENU*

${categoryMenu('.menuabsen', admin)}

${categoryMenu('.menupermainan', admin)}

${categoryMenu('.menuprofil', admin)}

${categoryMenu('.menujadwal', admin)}

${categoryMenu('.menustiker', admin)}

${categoryMenu('.menuinfo', admin)}`;

  if (admin) text += `\n\n${categoryMenu('.menuadmin', admin)}`;

  return text;
}

async function askFlow(chatId, key, flow) {
  pendingFlows.set(key, flow);
  await send(chatId, flow.prompt);
}
function flowKey(chatId, senderId) { return `${chatId}|${senderId}`; }

async function handleFlow(msg, key, body, name) {
  const flow = pendingFlows.get(key);
  if (!flow) return false;
  if (body.toLowerCase() === '.batal') { pendingFlows.delete(key); await msg.reply('Proses dibatalkan.'); return true; }

  if (flow.type === 'schedule-add' || flow.type === 'schedule-edit') {
    const fields = ['name', 'date', 'start', 'end', 'note'];
    const current = fields[flow.step];
    flow.values[current] = body;
    flow.step++;
    if (flow.step < fields.length) {
      const prompts = ['Masukkan nama kegiatan:', 'Masukkan tanggal (YYYY-MM-DD):', 'Masukkan waktu mulai (HH:mm):', 'Masukkan waktu selesai (HH:mm):', 'Masukkan keterangan (ketik - jika kosong):'];
      flow.prompt = prompts[flow.step]; pendingFlows.set(key, flow); await msg.reply(flow.prompt); return true;
    }
    const v = flow.values;
    if (!v.name || !parseDateArg(v.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.end)) {
      pendingFlows.delete(key); await msg.reply('❌ Format data tidak valid. Mulai lagi dengan .tambahjadwal atau .editjadwal ID.'); return true;
    }
    if (flow.type === 'schedule-add') {
      const id = data.nextScheduleId++;
      data.schedules.push({ id, name: v.name, date: v.date, start: v.start, end: v.end, note: v.note === '-' ? '' : v.note, createdBy: name });
      saveData(); pendingFlows.delete(key);
      await msg.reply(`✅ Jadwal #${id} berhasil ditambahkan.\n📅 ${v.name}\n🗓️ ${v.date}\n🕒 ${v.start}–${v.end}\n📝 ${v.note === '-' ? '-' : v.note}`); return true;
    }
    const schedule = data.schedules.find(s => s.id === flow.id);
    if (!schedule) { pendingFlows.delete(key); await msg.reply('Jadwal tidak ditemukan.'); return true; }
    Object.assign(schedule, { name: v.name, date: v.date, start: v.start, end: v.end, note: v.note === '-' ? '' : v.note });
    saveData(); pendingFlows.delete(key); await msg.reply(`✅ Jadwal #${flow.id} berhasil diperbarui.`); return true;
  }
  if (flow.type === 'quiz-add') {
    const fields = ['question', 'a', 'b', 'c', 'd', 'answer'];
    const current = fields[flow.step]; flow.values[current] = body; flow.step++;
    const prompts = ['Ketik pertanyaan kuis:', 'Pilihan A:', 'Pilihan B:', 'Pilihan C:', 'Pilihan D:', 'Jawaban benar (A/B/C/D):'];
    if (flow.step < fields.length) { pendingFlows.set(key, flow); await msg.reply(prompts[flow.step]); return true; }
    const v = flow.values; const answer = v.answer.toUpperCase();
    if (!['A', 'B', 'C', 'D'].includes(answer)) { pendingFlows.delete(key); await msg.reply('❌ Jawaban tidak valid. Ulangi dengan .buatquiz.'); return true; }
    const options = [v.a, v.b, v.c, v.d]; const difficulty = inferDifficulty(v.question, options);
    const id = data.nextQuizId++;
    data.quizQuestions.push({ id, question: v.question, options, answer: ['A','B','C','D'].indexOf(answer), difficulty, enabled: true });
    saveData(); pendingFlows.delete(key); await msg.reply(`✅ Soal kuis #${id} ditambahkan (kesulitan: *${difficulty}*).`); return true;
  }
  if (flow.type === 'word-add') {
    const fields = ['word', 'clue']; const current = fields[flow.step]; flow.values[current] = body; flow.step++;
    const prompts = ['Masukkan kata jawaban (tanpa spasi):', 'Masukkan petunjuk:'];
    if (flow.step < fields.length) { pendingFlows.set(key, flow); await msg.reply(prompts[flow.step]); return true; }
    const v = flow.values; const word = v.word.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (word.length < 2) { pendingFlows.delete(key); await msg.reply('❌ Kata minimal dua huruf. Ulangi dengan .buattebakan.'); return true; }
    const difficulty = inferDifficulty(`${word} ${v.clue}`);
    const id = data.nextWordId++;
    data.wordQuestions.push({ id, word, clue: v.clue, difficulty, enabled: true }); saveData(); pendingFlows.delete(key);
    await msg.reply(`✅ Tebakan #${id} ditambahkan (kesulitan: *${difficulty}*).`); return true;
  }
  return false;
}

function shuffledWord(word) {
  const chars = [...word];
  for (let i = chars.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  if (chars.join('') === word && chars.length > 1) [chars[0], chars[1]] = [chars[1], chars[0]];
  return chars.join(' - ');
}

function randomUnused(list, used) {
  const available = list.filter(q => q.enabled !== false && !used.has(q.id));
  if (!available.length) return null;
  return available[Math.floor(Math.random() * available.length)];
}

async function startQuiz(chatId, count = 1) {
  if (activeGames.has(chatId)) { await send(chatId, '⏳ Masih ada permainan aktif di grup ini.'); return; }
  const total = Math.min(20, Math.max(1, Number(count) || 1));
  const game = { type: 'quiz', used: new Set(), round: 0, total, timer: null, messageId: null, messageRawId: null, question: null, winners: new Set() };
  activeGames.set(chatId, game);
  await sendQuizRound(chatId, game);
}

async function sendQuizRound(chatId, game) {
  const question = randomUnused(data.quizQuestions, game.used);
  if (!question) { activeGames.delete(chatId); await send(chatId, 'Soal kuis habis.'); return; }
  game.question = question; game.used.add(question.id); game.round++; game.winners = new Set();
  const r = difficultyReward(question.difficulty);
  const text = `🧠 *KUIS YONGYONG* (${game.round}/${game.total})\n\n${question.question}\n\nA. ${question.options[0]}\nB. ${question.options[1]}\nC. ${question.options[2]}\nD. ${question.options[3]}\n\n${r.icon} Kesulitan: ${r.label}\n🎁 Hadiah: +${r.points} poin / +${r.exp} EXP\n\n⏱️ Waktu: ${GAME_TIMEOUT_SECONDS} detik\nBalas pesan ini dengan A, B, C, atau D.`;
  const sent = await send(chatId, text);
  if (!sent) { activeGames.delete(chatId); return; }
  game.messageId = sent.id._serialized;
  game.messageRawId = sent.id.id;
  game.timer = setTimeout(async () => {
    if (activeGames.get(chatId) !== game) return;
    await send(chatId, `⏰ Waktu habis! Jawaban: *${'ABCD'[question.answer]}. ${question.options[question.answer]}*`);
    if (game.round < game.total) { await sendQuizRound(chatId, game); }
    else { activeGames.delete(chatId); await send(chatId, `🏁 *KUIS SELESAI!*`); }
  }, GAME_TIMEOUT_SECONDS * 1000);
}

async function startWord(chatId, mode = 'acak') {
  if (activeGames.has(chatId)) { await send(chatId, '⏳ Masih ada permainan aktif di grup ini.'); return; }
  const question = randomUnused(data.wordQuestions, new Set());
  if (!question) { await send(chatId, 'Belum ada kata tebak yang tersedia.'); return; }
  const r = difficultyReward(question.difficulty); const isClue = mode === 'petunjuk';
  const prompt = isClue ? `Petunjuk: ${question.clue}` : `Susun huruf ini menjadi kata yang benar:\n\n*${shuffledWord(question.word)}*\n\nPetunjuk: ${question.clue}`;
  const text = `🔤 *TEBAK KATA YONGYONG*\n\n${prompt}\n\n${r.icon} Kesulitan: ${r.label}\n🎁 Hadiah: +${r.points} poin / +${r.exp} EXP\n⏱️ Waktu: ${GAME_TIMEOUT_SECONDS} detik\n\nBalas pesan ini dengan jawabanmu!`;
  const sent = await send(chatId, text);
  if (!sent) return;
  const game = { type: 'word', question, used: new Set([question.id]), round: 1, total: 1, timer: null, messageId: sent.id._serialized, messageRawId: sent.id.id, winners: new Set() };
  activeGames.set(chatId, game);
  game.timer = setTimeout(async () => {
    if (activeGames.get(chatId) !== game) return;
    activeGames.delete(chatId);
    await send(chatId, `⏰ Waktu habis! Jawabannya adalah *${question.word}*.`);
  }, GAME_TIMEOUT_SECONDS * 1000);
}

async function handleGameReply(msg, body, senderId, name) {
  if (!msg.hasQuotedMsg) return false;
  const game = activeGames.get(msg.from);
  if (!game) return false;

  let quoted;
  try { quoted = await msg.getQuotedMessage(); } catch { return false; }
  if (!quoted) return false;

  const quotedSerialized = quoted.id._serialized;
  const quotedRaw = quoted.id.id;

  const isMatchingMessage = (game.messageId && quotedSerialized === game.messageId) || 
                            (game.messageRawId && quotedRaw === game.messageRawId);

  if (!isMatchingMessage) return false;

  if (game.winners.has(senderId)) {
    await msg.reply('Kamu sudah menjawab benar untuk soal ini!');
    return true;
  }

  const normalized = body.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  let correct = false;

  if (game.type === 'quiz') {
    correct = normalized === 'ABCD'[game.question.answer];
  } else {
    correct = normalized === game.question.word.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  if (!correct) {
    await msg.reply('Belum tepat 😅 Coba lagi sebelum waktunya habis!');
    return true;
  }

  game.winners.add(senderId);
  const result = recordReward(senderId, name, game.question.difficulty, game.type, game.question.id);
  await msg.reply(`✅ *Jawaban benar, ${name}!*\n⭐ +${result.reward.points} poin | ✨ +${result.reward.exp} EXP\n${result.rank.icon} Rank: ${result.rank.name}\n📈 Level: ${result.level.level} (${result.level.title})`);
  return true;
}

function getAttendanceRecords(period) {
  const today = localDate(); let from = today, to = today;
  if (period === 'minggu') { from = weekStart(today); to = today; }
  if (period === 'bulan') { from = monthStart(today); to = today; }
  return Object.values(data.attendance).filter(a => a.date >= from && a.date <= to).sort((a,b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

function attendanceReport(period) {
  const records = getAttendanceRecords(period); const title = period === 'minggu' ? 'MINGGU INI' : period === 'bulan' ? 'BULAN INI' : 'HARI INI';
  if (!records.length) return `📋 *REKAP ABSENSI ${title}*\nBelum ada data absensi.`;
  const lines = records.slice(0, 50).map(a => `• ${a.name} — ${a.date}\n  Masuk: ${a.inTime || '-'} | Pulang: ${a.outTime || '-'}`);
  return `📋 *REKAP ABSENSI ${title}*\nJumlah catatan: ${records.length}\n\n${lines.join('\n')}\n${records.length > 50 ? '\nMenampilkan 50 catatan pertama.' : ''}`;
}

function formatSchedule(s) { return `#${s.id} • ${s.date} • ${s.start}–${s.end}\n📌 ${s.name}${s.note ? `\n📝 ${s.note}` : ''}`; }

function scheduleList(period = 'today') {
  const today = localDate(); let from = today, to = today;
  if (period === 'besok') from = to = shiftDate(today, 1);
  if (period === 'minggu') to = shiftDate(today, 6);
  const list = data.schedules.filter(s => s.date >= from && s.date <= to).sort((a,b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  if (!list.length) return '📅 Belum ada jadwal untuk periode tersebut.';
  return `📅 *JADWAL ${period === 'besok' ? 'BESOK' : period === 'minggu' ? 'MINGGU INI' : 'HARI INI'}*\n\n${list.slice(0, 30).map(formatSchedule).join('\n\n')}`;
}

function profileText(member) {
  const rank = rankFor(member.points); const level = levelFor(member.exp);
  const next = rank.nextThreshold === null ? 'Rank tertinggi tercapai!' : `Menuju ${rank.nextName}: kurang ${rank.nextThreshold - member.points} poin`;
  return `╔══ ⚔️ *YONGYONG RPG* ⚔️ ══╗\n👤 Nama: ${member.name}\n🏆 Rank: ${rank.icon} ${rank.name}\n⭐ Total poin: ${member.points}\n📈 Level: ${level.level} — ${level.title}\n✨ EXP level: ${level.currentExp}/${level.nextExp}\n🎯 ${next}\n╚════════════════════╝`;
}

function leaderboard(mode = 'all') {
  const today = localDate(); let events = data.pointEvents;
  if (mode === 'minggu') { const start = weekStart(today); events = events.filter(e => e.date >= start && e.date <= today); }
  if (mode === 'bulan') { const start = monthStart(today); events = events.filter(e => e.date >= start && e.date <= today); }
  if (mode === 'level') {
    const list = Object.values(data.members).map(m => ({ ...m, levelData: levelFor(m.exp) })).sort((a,b) => b.levelData.level - a.levelData.level || b.exp - a.exp).slice(0, 10);
    if (!list.length) return 'Belum ada pemain.';
    return `🏆 *LEADERBOARD LEVEL*\n\n${list.map((m,i) => `${i+1}. ${m.name} — Level ${m.levelData.level} (${m.levelData.title})`).join('\n')}`;
  }
  const totals = new Map();
  if (mode === 'all') { for (const m of Object.values(data.members)) totals.set(m.id, { name: m.name, points: m.points || 0 }); }
  else { for (const e of events) { const old = totals.get(e.memberId) || { name: e.memberName, points: 0 }; old.points += e.points; totals.set(e.memberId, old); } }
  const list = [...totals.values()].sort((a,b) => b.points - a.points).slice(0, 10);
  if (!list.length) return 'Belum ada pemain.';
  const title = mode === 'minggu' ? 'MINGGUAN' : mode === 'bulan' ? 'BULANAN' : 'KESELURUHAN';
  return `🏆 *LEADERBOARD ${title}*\n\n${list.map((m,i) => `${i+1}. ${m.name} — ${m.points} poin${mode === 'all' ? ` | ${rankFor(m.points).name}` : ''}`).join('\n')}`;
}

function exportCsv(filename, headers, rows) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const content = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
  const file = path.join(EXPORT_DIR, filename); fs.writeFileSync(file, '\uFEFF' + content, 'utf8'); return file;
}

async function sendFile(chatId, file, caption) {
  const media = MessageMedia.fromFilePath(file);
  await client.sendMessage(chatId, media, { caption });
}

client.on('message', async msg => {
  try {
    if (msg.fromMe || !groupOnly(msg)) return;
    const body = escapeText(msg.body);
    const senderId = senderKey(msg);
    const chatId = msg.from;
    const name = await memberNameFromMessage(msg);
    if (!senderId || !body) return;

    const member = ensureMember(senderId, name);
    saveData();

    const key = flowKey(chatId, senderId);
    if (pendingFlows.has(key) && !body.startsWith('.')) { await handleFlow(msg, key, body, name); return; }
    if (await handleGameReply(msg, body, senderId, name)) return;
    if (!body.startsWith('.')) return;

    const [rawCommand, ...argParts] = body.split(/\s+/);
    const command = rawCommand.toLowerCase();
    const args = argParts.join(' ').trim();
    const admin = await isAdminMessage(msg, senderId);

    // ==================== FITUR STIKER ====================
   
    // ==================== FITUR STIKER ====================
    if (['.stiker', '.s', '.sticker'].includes(command)) {
      let targetMsg = msg;

      if (msg.hasQuotedMsg) {
        try {
          targetMsg = await msg.getQuotedMessage();
        } catch (err) {
          console.error('[STIKER] Gagal mengambil pesan:', err);
          return msg.reply('⚠️ Gagal mengambil pesan yang dibalas.');
        }
      }

      if (!targetMsg.hasMedia) {
        return msg.reply(
          '⚠️ Kirim gambar dengan caption *.stiker* atau reply gambar yang ingin dijadikan stiker!'
        );
      }

      try {
        await msg.reply('⏳ Sedang memproses stiker...');

        
console.log('[STIKER] ID pesan:', {
  serialized: targetMsg.id?._serialized,
  fallback: targetMsg.id?.$1,
  remote: targetMsg.id?.remote,
  mediaType: targetMsg.type
});


if (targetMsg.id && !targetMsg.id._serialized && targetMsg.id.$1) {
  targetMsg.id._serialized = targetMsg.id.$1;
  console.log('[STIKER] ID pesan berhasil diperbaiki sementara');
}

        const media = await downloadMediaWithRetry(targetMsg);

        if (!media || !media.data) {
          return msg.reply(
            '❌ Gagal mengunduh media. Coba kirim ulang gambar lalu ketik .stiker'
          );
        }

        await client.sendMessage(chatId, media, {
          sendMediaAsSticker: true,
          stickerName: 'YongYong Bot Sticker',
          stickerAuthor: 'YongYong Bot 🤖'
        });

        console.log('[STIKER] Stiker berhasil dibuat.');
      } catch (err) {
        console.error(
          '[STIKER] Gagal membuat stiker:',
          err.stack || err
        );

        await msg.reply(
          '❌ Gagal membuat stiker. Cek terminal bot untuk detail error.'
        );
      }

      return;
    }

if (['.menu', '.bantuan'].includes(command)) {
  return msg.reply(helpText(admin));
}

if (command === '.allmenu') {
  return msg.reply(allMenuText(admin));
}

if ([
  '.menuabsen',
  '.menupermainan',
  '.menuprofil',
  '.menujadwal',
  '.menustiker',
  '.menuinfo',
  '.menuadmin'
].includes(command)) {
  return msg.reply(categoryMenu(command, admin));
}

    if (command === '.ping') return msg.reply('🏓 YongYong Bot aktif!');
    if (command === '.info') return msg.reply(`🤖 *YongYong Bot v1.0*\nZona waktu: ${TZ}\nGrup: aktif\nData anggota: ${Object.keys(data.members).length}\nSoal kuis: ${data.quizQuestions.length}\nSoal tebak kata: ${data.wordQuestions.length}`);

    if (command === '.masuk' || command === '.pulang') {
      const date = activeDateKey(); const keyA = attendanceKey(date, senderId); const record = data.attendance[keyA];
      if (command === '.masuk') {
        if (record && record.inTime) return msg.reply(`⚠️ ${name}, absensi masukmu hari ini sudah tercatat pada ${record.inTime} WIB.`);
        data.attendance[keyA] = { date, memberId: senderId, name, inTime: localTime(), outTime: record?.outTime || '', inAt: localDateTime(), outAt: record?.outAt || '' };
        saveData(); return msg.reply(`✅ *ABSENSI MASUK BERHASIL*\n👤 Nama: ${name}\n📅 Tanggal: ${date}\n🕗 Waktu masuk: ${data.attendance[keyA].inTime} WIB\n\nSemangat beraktivitas! 💪`);
      }
      if (!record || !record.inTime) return msg.reply('⚠️ Kamu belum absen masuk hari ini. Ketik .masuk terlebih dahulu.');
      if (record.outTime) return msg.reply(`⚠️ Absensi pulangmu hari ini sudah tercatat pada ${record.outTime} WIB.`);
      record.outTime = localTime(); record.outAt = localDateTime(); record.name = name; saveData();
      return msg.reply(`✅ *ABSENSI PULANG BERHASIL*\n👤 Nama: ${name}\n📅 Tanggal: ${date}\n🕔 Waktu pulang: ${record.outTime} WIB\n\nHati-hati di jalan! 🏡`);
    }

    if (command === '.absen') {
      const target = mentionId(msg); const id = target ? target.split('@')[0] : senderId; const date = localDate(); const rec = data.attendance[attendanceKey(date, id)];
      if (!rec) return msg.reply(target ? `📋 Belum ada absensi hari ini untuk ${mentionLabel(target)}.` : '📋 Kamu belum memiliki catatan absensi hari ini.');
      return msg.reply(`📋 *STATUS ABSENSI*\n👤 ${rec.name}\n📅 ${rec.date}\n🕗 Masuk: ${rec.inTime || '-'} WIB\n🕔 Pulang: ${rec.outTime || '-'} WIB`);
    }

    if (command === '.rekap') {
      if (!admin) return msg.reply('⛔ Perintah rekap laporan hanya untuk admin bot.');
      const period = ['minggu', 'bulan'].includes(args.toLowerCase()) ? args.toLowerCase() : 'hari'; return msg.reply(attendanceReport(period));
    }

    if (command === '.jadwal') return msg.reply(scheduleList(['besok','minggu'].includes(args.toLowerCase()) ? args.toLowerCase() : 'today'));
    if (command === '.detailjadwal') {
      const id = Number(args); const s = data.schedules.find(x => x.id === id); return msg.reply(s ? `📅 *DETAIL JADWAL #${s.id}*\n${formatSchedule(s)}\nDibuat oleh: ${s.createdBy || '-'}` : 'Jadwal tidak ditemukan.');
    }

    if (command === '.quiz') return startQuiz(chatId, args ? Number(args) : 1);
    if (command === '.tebakkata') return startWord(chatId, args.toLowerCase() === 'petunjuk' ? 'petunjuk' : 'acak');
    if (command === '.skor') return msg.reply(`⭐ *SKOR RPG*\nNama: ${member.name}\nTotal poin: ${member.points}\nTotal EXP: ${member.exp}\nRank: ${rankFor(member.points).name}\nLevel: ${levelFor(member.exp).level}`);
    if (command === '.rank') {
      const target = mentionId(msg); const id = target ? target.split('@')[0] : senderId; const targetMember = data.members[id];
      return msg.reply(targetMember ? `🏆 ${targetMember.name}\n${rankFor(targetMember.points).icon} ${rankFor(targetMember.points).name}\n⭐ ${targetMember.points} poin` : 'Data anggota belum tersedia.');
    }
    if (command === '.level') { const l = levelFor(member.exp); return msg.reply(`📈 *LEVEL KARAKTER*\nNama: ${member.name}\nLevel: ${l.level} — ${l.title}\nEXP: ${l.currentExp}/${l.nextExp}\nTotal EXP: ${member.exp}`); }
    if (command === '.profil') return msg.reply(profileText(member));
    if (command === '.ranklist') return msg.reply(`⚔️ *DAFTAR RANK RPG*\n🌱 Novice — 0\n🥉 Bronze Adventurer — 100\n🛡️ Silver Knight — 300\n⚔️ Gold Warrior — 700\n💠 Platinum Elite — 1.500\n💎 Diamond Champion — 3.000\n🛡️ Master Guardian — 5.000\n👑 Grandmaster — 7.500\n🔥 Mythic Hero — 10.000\n🌌 Immortal — 15.000\n✨ Divine Legend — 25.000\n👑 Eternal Overlord — 50.000 poin`);
    if (command === '.toprank') return msg.reply(leaderboard('all'));
    if (command === '.leaderboard') return msg.reply(leaderboard(['minggu','bulan','level'].includes(args.toLowerCase()) ? args.toLowerCase() : 'all'));

    if (command === '.admin') return admin ? msg.reply(helpText(true)) : msg.reply('⛔ Kamu bukan admin bot.');
    if (command === '.tambahjadwal') {
      if (!admin) return msg.reply('⛔ Khusus admin bot.');
      return askFlow(chatId, key, { type: 'schedule-add', step: 0, values: {}, prompt: '📅 *Tambah jadwal*\nMasukkan nama kegiatan (ketik .batal untuk membatalkan):' });
    }
    if (command === '.editjadwal') {
      if (!admin) return msg.reply('⛔ Khusus admin bot.'); const id = Number(args); const s = data.schedules.find(x => x.id === id);
      if (!s) return msg.reply('Jadwal tidak ditemukan. Gunakan .semuajadwal untuk melihat ID.');
      return askFlow(chatId, key, { type: 'schedule-edit', id, step: 0, values: {}, prompt: `✏️ *Edit jadwal #${id}*\nMasukkan nama kegiatan baru:` });
    }
    if (command === '.hapusjadwal') {
      if (!admin) return msg.reply('⛔ Khusus admin bot.'); const id = Number(args); const index = data.schedules.findIndex(x => x.id === id);
      if (index < 0) return msg.reply('Jadwal tidak ditemukan.'); data.schedules.splice(index, 1); saveData(); return msg.reply(`✅ Jadwal #${id} dihapus.`);
    }
    if (command === '.semuajadwal') { if (!admin) return msg.reply('⛔ Khusus admin bot.'); return msg.reply(data.schedules.length ? `📅 *SEMUA JADWAL*\n\n${data.schedules.slice().sort((a,b) => a.date.localeCompare(b.date)).map(formatSchedule).join('\n\n')}` : 'Belum ada jadwal.'); }
    if (command === '.buatquiz') { if (!admin) return msg.reply('⛔ Khusus admin bot.'); return askFlow(chatId, key, { type: 'quiz-add', step: 0, values: {}, prompt: '🧠 *Tambah soal kuis*\nKetik pertanyaan (ketik .batal untuk membatalkan):' }); }
    if (command === '.hapusquiz') { if (!admin) return msg.reply('⛔ Khusus admin bot.'); const id = Number(args); const q = data.quizQuestions.find(x => x.id === id); if (!q) return msg.reply('Soal tidak ditemukan.'); q.enabled = false; saveData(); return msg.reply(`✅ Soal kuis #${id} dinonaktifkan.`); }
    if (command === '.daftarquiz') { if (!admin) return msg.reply('⛔ Khusus admin bot.'); return msg.reply(`🧠 *DAFTAR SOAL KUIS*\n${data.quizQuestions.map(q => `#${q.id} [${q.enabled === false ? 'nonaktif' : q.difficulty}] ${q.question}`).join('\n') || 'Kosong'}`); }
    if (command === '.buattebakan') { if (!admin) return msg.reply('⛔ Khusus admin bot.'); return askFlow(chatId, key, { type: 'word-add', step: 0, values: {}, prompt: '🔤 *Tambah tebak kata*\nMasukkan kata jawaban (ketik .batal untuk membatalkan):' }); }
    if (command === '.hapustebakan') { if (!admin) return msg.reply('⛔ Khusus admin bot.'); const id = Number(args); const q = data.wordQuestions.find(x => x.id === id); if (!q) return msg.reply('Tebakan tidak ditemukan.'); q.enabled = false; saveData(); return msg.reply(`✅ Tebakan #${id} dinonaktifkan.`); }
    if (command === '.daftartebakan') { if (!admin) return msg.reply('⛔ Khusus admin bot.'); return msg.reply(`🔤 *DAFTAR TEBAK KATA*\n${data.wordQuestions.map(q => `#${q.id} [${q.enabled === false ? 'nonaktif' : q.difficulty}] ${q.word} — ${q.clue}`).join('\n') || 'Kosong'}`); }
    if (command === '.tambahadmin') {
  if (!(await isOwnerMessage(msg, senderId))) {
    return msg.reply('⛔ Hanya pemilik utama yang boleh menambahkan admin bot.');
  }

  const number = normalizeNumber(args);

  if (!/^\d{10,15}$/.test(number)) {
    return msg.reply('Format nomor tidak valid. Contoh: .tambahadmin 6281234567890');
  }

  if (number === OWNER_NUMBER) {
    return msg.reply('Nomor tersebut sudah menjadi pemilik bot.');
  }

  if (data.admins.includes(number)) {
    return msg.reply('Nomor tersebut sudah menjadi admin bot.');
  }

  data.admins.push(number);
  saveData();

  return msg.reply(`✅ Admin bot ditambahkan: ${number}`);
}

if (command === '.hapusadmin') {
  if (!(await isOwnerMessage(msg, senderId))) {
    return msg.reply('⛔ Hanya pemilik utama yang boleh menghapus admin bot.');
  }

  const number = normalizeNumber(args);

  if (!/^\d{10,15}$/.test(number)) {
    return msg.reply('Format nomor tidak valid. Contoh: .hapusadmin 6281234567890');
  }

  if (number === OWNER_NUMBER) {
    return msg.reply('Pemilik utama tidak bisa dihapus lewat perintah ini.');
  }

  if (!data.admins.includes(number)) {
    return msg.reply('Nomor tersebut bukan admin bot.');
  }

  data.admins = data.admins.filter(n => n !== number);
  saveData();

  return msg.reply(`✅ Akses admin untuk ${number} dihapus.`);
}
    
if (command === '.daftaradmin') {
  if (!admin) return msg.reply('⛔ Khusus admin bot.');

  const adminList = [];

  for (let i = 0; i < data.admins.length; i++) {
    const id = String(data.admins[i]);
    let nomor = id;

    // Jika data berupa LID, coba cari nomor teleponnya
    if (id.includes('@lid') || /^\d{10,20}$/.test(id)) {
      try {
        const result = await client.getContactLidAndPhone([
          id.includes('@') ? id : `${id}@lid`
        ]);

        const phoneId = result?.[0]?.pn;
        if (phoneId) {
          nomor = phoneId.split('@')[0].split(':')[0];
        }
      } catch (err) {
        console.error('[DAFTAR ADMIN ERROR]', err.message || err);
      }
    }

    adminList.push(`${i + 1}. ${nomor}`);
  }

  return msg.reply(
    `👑 *DAFTAR ADMIN YONGYONG BOT*\n\n` +
    `Pemilik utama: ${OWNER_NUMBER}\n\n` +
    `Admin tambahan:\n${adminList.length ? adminList.join('\n') : 'Belum ada admin tambahan.'}\n\n` +
    `Total admin tambahan: ${data.admins.length}`
  );
}

    if (command === '.eksporabsen') {
      if (!admin) return msg.reply('⛔ Khusus admin bot.'); const period = ['minggu','bulan'].includes(args.toLowerCase()) ? args.toLowerCase() : 'hari'; const rows = getAttendanceRecords(period).map(a => [a.date, a.memberId, a.name, a.inTime, a.outTime, a.inAt, a.outAt]);
      const file = exportCsv(`absensi-${period}-${localDate()}.csv`, ['Tanggal','ID Anggota','Nama','Masuk','Pulang','Waktu Masuk','Waktu Pulang'], rows); await sendFile(chatId, file, `📄 Ekspor absensi (${period})`); return;
    }
    if (command === '.eksporjadwal') {
      if (!admin) return msg.reply('⛔ Khusus admin bot.'); const rows = data.schedules.map(s => [s.id,s.name,s.date,s.start,s.end,s.note,s.createdBy]); const file = exportCsv(`jadwal-${localDate()}.csv`, ['ID','Kegiatan','Tanggal','Mulai','Selesai','Keterangan','Dibuat oleh'], rows); await sendFile(chatId, file, '📄 Ekspor jadwal'); return;
    }
    if (command === '.ekspordata') {
      if (!admin) return msg.reply('⛔ Khusus admin bot.'); const file = exportCsv(`rpg-${localDate()}.csv`, ['ID Anggota','Nama','Total Poin','Total EXP','Level','Gelar Level','Rank'], Object.values(data.members).map(m => [m.id,m.name,m.points,m.exp,levelFor(m.exp).level,levelFor(m.exp).title,rankFor(m.points).name])); await sendFile(chatId, file, '📄 Ekspor data RPG anggota'); return;
    }
    if (command === '.batal') { if (pendingFlows.has(key)) { pendingFlows.delete(key); return msg.reply('Proses dibatalkan.'); } }
  } catch (error) {
    console.error('Kesalahan saat memproses pesan:', error.stack || error);
  }
});

process.on('SIGINT', async () => { console.log('\nMematikan YongYong Bot...'); try { await saveData(); await client.destroy(); } catch {} process.exit(0); });
process.on('SIGTERM', async () => { try { await saveData(); await client.destroy(); } catch {} process.exit(0); });

console.log('Menyiapkan YongYong Bot...');
client.initialize();