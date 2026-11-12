import { promises as fs } from "node:fs";
import path from "node:path";
import type { Item } from "./types.ts";

/**
 * 저장소: DATABASE_URL이 있으면 Postgres(배포용), 없으면 data/items.json 파일(로컬용).
 * 항목 하나를 JSON 문서 하나로 저장하는 단순 구조라 스키마 마이그레이션이 필요 없습니다.
 */
interface Store {
  list(): Promise<Item[]>;
  get(id: string): Promise<Item | null>;
  save(item: Item): Promise<void>;
  remove(id: string): Promise<void>;
}

/* ───────── 파일 저장소 ───────── */

const FILE = path.join(process.cwd(), "data", "items.json");
let queue: Promise<unknown> = Promise.resolve();

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

function assertWritableEnv() {
  if (process.env.VERCEL) {
    throw new Error("배포 환경에서는 DATABASE_URL(Postgres)을 설정해야 합니다. 서버리스는 파일에 저장할 수 없습니다.");
  }
}

async function readAll(): Promise<Item[]> {
  assertWritableEnv();
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Item[];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

async function writeAll(items: Item[]) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(items, null, 2));
  await fs.rename(tmp, FILE);
}

const fileStore: Store = {
  list: () => serial(readAll),
  get: (id) => serial(async () => (await readAll()).find((i) => i.id === id) ?? null),
  save: (item) =>
    serial(async () => {
      const items = await readAll();
      const idx = items.findIndex((i) => i.id === item.id);
      if (idx >= 0) items[idx] = item;
      else items.push(item);
      await writeAll(items);
    }),
  remove: (id) => serial(async () => writeAll((await readAll()).filter((i) => i.id !== id))),
};

/* ───────── Postgres 저장소 ───────── */

type Sql = import("postgres").Sql;
let sqlPromise: Promise<Sql> | null = null;

function getSql(): Promise<Sql> {
  sqlPromise ??= (async () => {
    const postgres = (await import("postgres")).default;
    const sql = postgres(process.env.DATABASE_URL!, {
      max: Number(process.env.PG_POOL_MAX) || 3,
      prepare: false,
      idle_timeout: 20,
      onnotice: () => {}, // "이미 테이블 있음" 같은 안내 메시지는 로그에 남기지 않음
    });
    await sql`CREATE TABLE IF NOT EXISTS restock_items (
      id text PRIMARY KEY,
      data jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    return sql;
  })();
  return sqlPromise;
}

const pgStore: Store = {
  async list() {
    const sql = await getSql();
    const rows = await sql<{ data: Item }[]>`SELECT data FROM restock_items ORDER BY created_at`;
    return rows.map((r) => r.data);
  },
  async get(id) {
    const sql = await getSql();
    const rows = await sql<{ data: Item }[]>`SELECT data FROM restock_items WHERE id = ${id}`;
    return rows[0]?.data ?? null;
  },
  async save(item) {
    const sql = await getSql();
    const data = sql.json(item as unknown as Parameters<Sql["json"]>[0]);
    await sql`INSERT INTO restock_items (id, data) VALUES (${item.id}, ${data})
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`;
  },
  async remove(id) {
    const sql = await getSql();
    await sql`DELETE FROM restock_items WHERE id = ${id}`;
  },
};

// 모듈을 불러오는 시점(빌드 등)이 아니라 실제 요청 시점의 환경변수로 저장소를 고름
const pick = (): Store => (process.env.DATABASE_URL ? pgStore : fileStore);

export const store: Store = {
  list: () => pick().list(),
  get: (id) => pick().get(id),
  save: (item) => pick().save(item),
  remove: (id) => pick().remove(id),
};

export function storeKind(): "postgres" | "file" {
  return process.env.DATABASE_URL ? "postgres" : "file";
}
