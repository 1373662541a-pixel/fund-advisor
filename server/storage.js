import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, DEFAULT_SETTINGS } from './config.js';

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    ensureDir();
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return structuredClone(fallback);
  }
}

function writeJson(file, data) {
  ensureDir();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export class Store {
  constructor() {
    this.file = (name) => path.join(DATA_DIR, name);
    this.holdingsFile = this.file('holdings.json');
    this.settingsFile = this.file('settings.json');
    this.adviceFile = this.file('advice.json');
    this.holidaysFile = this.file('holidays.json');
    this.opsFile = this.file('pendingOps.json');
  }
  getHoldings() {
    const list = readJson(this.holdingsFile, []);
    return Array.isArray(list) ? list : [];
  }
  saveHoldings(list) {
    writeJson(this.holdingsFile, list);
  }
  getPendingOps() {
    const list = readJson(this.opsFile, []);
    return Array.isArray(list) ? list : [];
  }
  savePendingOps(list) {
    writeJson(this.opsFile, list);
  }

  getSettings() {
    const s = readJson(this.settingsFile, DEFAULT_SETTINGS);
    return {
      ...structuredClone(DEFAULT_SETTINGS),
      ...s,
      schedule: { ...DEFAULT_SETTINGS.schedule, ...(s.schedule || {}) },
      ai: { ...DEFAULT_SETTINGS.ai, ...(s.ai || {}) },
      vision: { ...DEFAULT_SETTINGS.vision, ...(s.vision || {}) },
    };
  }

  saveSettings(s) {
    writeJson(this.settingsFile, s);
  }

  getAdviceList() {
    const obj = readJson(this.adviceFile, {});
    return obj || {};
  }

  getAdvice(date) {
    return this.getAdviceList()[date] || null;
  }

  saveAdvice(date, record) {
    const obj = this.getAdviceList();
    obj[date] = record;
    writeJson(this.adviceFile, obj);
  }

  listAdviceDates() {
    return Object.keys(this.getAdviceList()).sort().reverse();
  }

  getHolidays() {
    return readJson(this.holidaysFile, {});
  }

  saveHolidays(h) {
    writeJson(this.holidaysFile, h);
  }
}

export const store = new Store();
