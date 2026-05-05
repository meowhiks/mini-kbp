import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");
const OFFSET_PATH = join(DATA_DIR, "bot-updates.json");

interface OffsetState {
  offset: number;
}

async function ensureState(): Promise<OffsetState> {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await readFile(OFFSET_PATH, "utf-8");
    return JSON.parse(raw) as OffsetState;
  } catch {
    return { offset: 0 };
  }
}

async function saveState(state: OffsetState) {
  await writeFile(OFFSET_PATH, JSON.stringify(state, null, 2), "utf-8");
}

export async function getOffset() {
  const state = await ensureState();
  return state.offset;
}

export async function setOffset(offset: number) {
  await saveState({ offset });
}

