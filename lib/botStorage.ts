import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import crypto from "crypto";

export interface BotUserRecord {
  token: string;
  studentName: string;
  groupId: string;
  birthDay: string;
  cookies: string;
  createdAt: string;
  telegramUserId?: number;
  telegramUsername?: string;
  telegramFirstName?: string;
  boundAt?: string;
  lastJournalHash?: string;
  lastTimetableHash?: string;
  journalSnapshot?: any;
  timetableSnapshot?: any;
}

interface BotDbShape {
  users: BotUserRecord[];
}

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "bot-db.json");

async function ensureDb(): Promise<BotDbShape> {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await readFile(DB_PATH, "utf-8");
    return JSON.parse(raw) as BotDbShape;
  } catch {
    const fresh: BotDbShape = { users: [] };
    await writeFile(DB_PATH, JSON.stringify(fresh, null, 2), "utf-8");
    return fresh;
  }
}

async function saveDb(db: BotDbShape) {
  await writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

export async function createLinkRecord(input: {
  studentName: string;
  groupId: string;
  birthDay: string;
  cookies: string;
}) {
  const db = await ensureDb();
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  const now = new Date().toISOString();

  const record: BotUserRecord = {
    token,
    studentName: input.studentName,
    groupId: input.groupId,
    birthDay: input.birthDay,
    cookies: input.cookies,
    createdAt: now,
  };

  db.users.push(record);
  await saveDb(db);

  return record;
}

export async function findByToken(token: string): Promise<BotUserRecord | undefined> {
  const db = await ensureDb();
  return db.users.find((u) => u.token === token);
}

export async function bindTelegramUser(token: string, data: { id: number; username?: string; first_name?: string }) {
  const db = await ensureDb();
  const user = db.users.find((u) => u.token === token);
  if (!user) return undefined;

  user.telegramUserId = data.id;
  user.telegramUsername = data.username;
  user.telegramFirstName = data.first_name;
  user.boundAt = new Date().toISOString();

  await saveDb(db);
  return user;
}

export async function getBoundUsers(): Promise<BotUserRecord[]> {
  const db = await ensureDb();
  return db.users.filter((u) => !!u.telegramUserId);
}

export async function updateSnapshots(
  token: string,
  payload: { journalHash?: string; timetableHash?: string; journalSnapshot?: any; timetableSnapshot?: any }
) {
  const db = await ensureDb();
  const user = db.users.find((u) => u.token === token);
  if (!user) return;
  if (payload.journalHash !== undefined) user.lastJournalHash = payload.journalHash;
  if (payload.timetableHash !== undefined) user.lastTimetableHash = payload.timetableHash;
  if (payload.journalSnapshot !== undefined) user.journalSnapshot = payload.journalSnapshot;
  if (payload.timetableSnapshot !== undefined) user.timetableSnapshot = payload.timetableSnapshot;
  await saveDb(db);
}

export async function overwriteRecord(user: BotUserRecord) {
  const db = await ensureDb();
  const idx = db.users.findIndex((u) => u.token === user.token);
  if (idx !== -1) {
    db.users[idx] = user;
    await saveDb(db);
  }
}

