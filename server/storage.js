import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, DEFAULT_SETTINGS } from './config.js';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return structuredClone(fallback);
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/* ================= 用户认证 ================= */
const usersFile = path.join(DATA_DIR, 'users.json');
const sessionsFile = path.join(DATA_DIR, 'sessions.json');

function hashPassword(pw, salt) {
  return crypto.scryptSync(String(pw), salt, 32).toString('hex');
}

class AuthStore {
  getUsers() { return readJson(usersFile, {}); }
  saveUsers(u) { writeJson(usersFile, u); }
  getSessions() { return readJson(sessionsFile, {}); }
  saveSessions(s) { writeJson(sessionsFile, s); }

  register(username, password) {
    const users = this.getUsers();
    const name = String(username || '').trim();
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(name)) return { ok: false, error: '用户名需 3-20 位字母/数字/下划线' };
    if (users[name]) return { ok: false, error: '用户名已存在' };
    if (!password || String(password).length < 6) return { ok: false, error: '密码至少 6 位' };
    const salt = crypto.randomBytes(8).toString('hex');
    const isFirst = Object.keys(users).length === 0;
    users[name] = {
      userId: 'u_' + crypto.randomBytes(6).toString('hex'),
      salt,
      hash: hashPassword(password, salt),
      createdAt: new Date().toISOString(),
    };
    this.saveUsers(users);
    return { ok: true, isFirst, user: { username: name, userId: users[name].userId } };
  }

  login(username, password) {
    const users = this.getUsers();
    const name = String(username || '').trim();
    const u = users[name];
    if (!u) return { ok: false, error: '用户名或密码错误' };
    if (hashPassword(password, u.salt) !== u.hash) return { ok: false, error: '用户名或密码错误' };
    const token = crypto.randomBytes(24).toString('hex');
    const sessions = this.getSessions();
    sessions[token] = { userId: u.userId, username: name, createdAt: new Date().toISOString() };
    this.saveSessions(sessions);
    return { ok: true, token, user: { username: name, userId: u.userId } };
  }

  me(token) {
    if (!token) return null;
    const sessions = this.getSessions();
    const s = sessions[token];
    if (!s) return null;
    const users = this.getUsers();
    const u = Object.values(users).find((x) => x.userId === s.userId);
    return u ? { username: s.username, userId: s.userId } : null;
  }

  logout(token) {
    if (!token) return;
    const sessions = this.getSessions();
    delete sessions[token];
    this.saveSessions(sessions);
  }
}

export const auth = new AuthStore();

/* ================= 用户数据（按用户隔离） ================= */
const LEGACY_FILES = ['holdings.json', 'settings.json', 'advice.json', 'pendingOps.json'];

export class UserStore {
  constructor(userId) {
    this.userId = userId;
    this.dir = path.join(DATA_DIR, 'users', userId);
    this.file = (name) => path.join(this.dir, name);
  }

  getHoldings() {
    const list = readJson(this.file('holdings.json'), []);
    return Array.isArray(list) ? list : [];
  }
  saveHoldings(list) { writeJson(this.file('holdings.json'), list); }

  getSettings() {
    const s = readJson(this.file('settings.json'), DEFAULT_SETTINGS);
    return {
      ...structuredClone(DEFAULT_SETTINGS),
      ...s,
      schedule: { ...DEFAULT_SETTINGS.schedule, ...(s.schedule || {}) },
      ai: { ...DEFAULT_SETTINGS.ai, ...(s.ai || {}) },
      vision: { ...DEFAULT_SETTINGS.vision, ...(s.vision || {}) },
    };
  }
  saveSettings(s) { writeJson(this.file('settings.json'), s); }

  getPendingOps() {
    const list = readJson(this.file('pendingOps.json'), []);
    return Array.isArray(list) ? list : [];
  }
  savePendingOps(list) { writeJson(this.file('pendingOps.json'), list); }

  getAdviceList() { return readJson(this.file('advice.json'), {}); }
  getAdvice(date) { return this.getAdviceList()[date] || null; }
  saveAdvice(date, record) {
    const obj = this.getAdviceList();
    obj[date] = record;
    writeJson(this.file('advice.json'), obj);
  }
  listAdviceDates() { return Object.keys(this.getAdviceList()).sort().reverse(); }

  getHolidays() { return readJson(path.join(DATA_DIR, 'holidays.json'), {}); }
  saveHolidays(h) { writeJson(path.join(DATA_DIR, 'holidays.json'), h); }

  // 首个注册用户自动接管旧单用户数据（迁移后清理旧文件，防止重复）
  migrateLegacyIfNeeded() {
    const anyLegacy = LEGACY_FILES.some((f) => fs.existsSync(path.join(DATA_DIR, f)));
    if (!anyLegacy) return;
    ensureDir(this.dir);
    for (const f of LEGACY_FILES) {
      const src = path.join(DATA_DIR, f);
      const dst = this.file(f);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
      }
      if (fs.existsSync(src)) fs.rmSync(src);
    }
  }
}

// 供无鉴权场景（定时任务遍历等）按 userId 获取存储
export function userStoreOf(userId) { return new UserStore(userId); }