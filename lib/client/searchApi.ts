import { parseTimetableHtml } from "@/lib/client/kbpApi";
import { isNativeApp } from "@/lib/client/platform";
import { nativeRequestText } from "@/lib/client/nativeHttp";
import { storageGetObject, storageSetObject, storageRemove } from "@/lib/client/storage";

export interface SearchResult {
  id: string;
  name: string;
  type: "group" | "teacher" | "place" | "subject";
  typeLabel: string;
}

type SearchIndex = {
  savedAt: number;
  items: SearchResult[];
  fetchError?: string;
};

const INDEX_KEY = "timetable_search_index_v1";
const DAY_MS = 24 * 60 * 60 * 1000;

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.,_()\-]/g, "")
    .trim();

async function fetchAndParseIndex(): Promise<SearchIndex> {
  console.log("[Search] Fetching fresh index from server...");

  try {
    const r = await nativeRequestText({
      url: "https://kbp.by/rasp/timetable/view_beta_kbp/?q=",
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru,en;q=0.9",
        "Cache-Control": "no-cache",
      },
    });

    console.log("[Search] Response received, length:", r.data?.length);

    const items = parseSearchResults(r.data);
    console.log("[Search] Parsed items count:", items.length);

    const next: SearchIndex = { savedAt: Date.now(), items };
    await storageSetObject(INDEX_KEY, next);
    console.log("[Search] Index saved to storage");

    return next;
  } catch (err) {
    console.error("[Search] Failed to fetch index:", err);
    // Return empty index with error
    return { savedAt: Date.now(), items: [], fetchError: String(err) };
  }
}

// Get cached index if available
async function getCachedIndex(): Promise<SearchIndex | null> {
  try {
    const cached = await storageGetObject<SearchIndex>(INDEX_KEY);
    if (cached && Array.isArray(cached.items)) {
      console.log("[Search] Cached index found:", cached.items.length, "items");
      return cached;
    }
  } catch (err) {
    console.error("[Search] Error reading cached index:", err);
  }
  return null;
}

async function ensureNativeIndex(forceRefresh = false): Promise<SearchIndex> {
  if (forceRefresh) {
    console.log("[Search] Force refresh requested");
    await storageRemove(INDEX_KEY);
    return fetchAndParseIndex();
  }

  const cached = await storageGetObject<SearchIndex>(INDEX_KEY);
  console.log("[Search] Cached index:", cached ? `found, ${cached.items?.length || 0} items, age: ${Math.round((Date.now() - cached.savedAt) / 1000 / 60)}min` : "not found");

  if (cached && cached.savedAt && Array.isArray(cached.items) && Date.now() - cached.savedAt < DAY_MS) {
    console.log("[Search] Using cached index");
    return cached;
  }

  return fetchAndParseIndex();
}

// Force rebuild the search index (for manual refresh)
export async function forceRebuildSearchIndex(): Promise<{ success: boolean; count: number; error?: string }> {
  console.log("[Search] Force rebuild started");

  try {
    const index = await ensureNativeIndex(true);
    console.log("[Search] Force rebuild complete, items:", index.items.length);
    return { success: true, count: index.items.length };
  } catch (err) {
    console.error("[Search] Force rebuild failed:", err);
    return { success: false, count: 0, error: String(err) };
  }
}

// Get entities from cache first (for instant display), then refresh in background
export async function listTimetableEntities(): Promise<SearchResult[]> {
  console.log("[Search] listTimetableEntities called, native:", isNativeApp());

  if (!isNativeApp()) {
    const res = await fetch(`/api/search?q=`);
    const json = await res.json();
    return json.results || [];
  }

  // Native mode - try to refresh in background, return cached immediately
  const cached = await getCachedIndex();

  // If no cache or cache is old, fetch fresh
  if (!cached || (Date.now() - (cached.savedAt || 0) > DAY_MS)) {
    console.log("[Search] No cache or cache expired, fetching fresh...");
    try {
      const fresh = await fetchAndParseIndex();
      return fresh.items;
    } catch (err) {
      console.error("[Search] Failed to fetch, using cache if available");
      return cached?.items || [];
    }
  }

  // Background refresh if cache is getting old (older than 12 hours)
  if (Date.now() - cached.savedAt > DAY_MS / 2) {
    console.log("[Search] Cache is getting old, refreshing in background...");
    fetchAndParseIndex().catch((err) => {
      console.error("[Search] Background refresh failed:", err);
    });
  }

  return cached.items;
}

// Refresh index in background (call this periodically)
export async function refreshSearchIndexInBackground(): Promise<void> {
  console.log("[Search] Background refresh started");
  try {
    await fetchAndParseIndex();
    console.log("[Search] Background refresh complete");
  } catch (err) {
    console.error("[Search] Background refresh failed:", err);
  }
}

// Parse search results from the timetable search page
export async function searchTimetable(query: string): Promise<SearchResult[]> {
  console.log("[Search] searchTimetable called, query:", query, "native:", isNativeApp());

  if (!query.trim()) {
    console.log("[Search] Empty query, returning empty");
    return [];
  }

  if (!isNativeApp()) {
    // For web mode, use the API route
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const json = await res.json();
    return json.results || [];
  }

  // Native mode - use cached index, search locally
  try {
    const cached = await getCachedIndex();

    if (!cached || cached.items.length === 0) {
      console.warn("[Search] No cached index available, trying to fetch...");
      // Try to fetch if no cache
      const fresh = await fetchAndParseIndex();
      if (fresh.items.length === 0) {
        return [];
      }
      // Use freshly fetched data
      const q = normalize(query);
      const scored = fresh.items
        .map((item) => {
          const n = normalize(item.name);
          let score = 0;
          if (n === q) score += 1000;
          if (n.startsWith(q)) score += 400;
          if (n.includes(q)) score += 220;
          score += Math.max(0, 100 - Math.abs(item.name.length - query.length));
          return { item, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, "ru"))
        .slice(0, 50)
        .map((x) => x.item);
      return scored;
    }

    console.log("[Search] Searching in cached", cached.items.length, "items");

    const q = normalize(query);
    console.log("[Search] Normalized query:", q);

    const scored = cached.items
      .map((item) => {
        const n = normalize(item.name);
        let score = 0;
        if (n === q) score += 1000;
        if (n.startsWith(q)) score += 400;
        if (n.includes(q)) score += 220;
        score += Math.max(0, 100 - Math.abs(item.name.length - query.length));
        return { item, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, "ru"))
      .slice(0, 50)
      .map((x) => x.item);

    console.log("[Search] Found", scored.length, "results");

    // Trigger background refresh if needed
    if (Date.now() - cached.savedAt > DAY_MS / 2) {
      console.log("[Search] Cache old, refreshing in background...");
      refreshSearchIndexInBackground();
    }

    return scored;
  } catch (err) {
    console.error("[Search] searchTimetable error:", err);
    return [];
  }
}

function parseSearchResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  console.log("[Search] parseSearchResults started, html length:", html?.length);

  if (!html || typeof html !== "string") {
    console.error("[Search] Invalid HTML input");
    return results;
  }

  // Find the find_block section
  const findBlockMatch = html.match(/<div class="find_block"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/);
  if (!findBlockMatch) {
    console.warn("[Search] find_block not found in HTML");
    // Try alternative pattern - maybe it's different structure
    const altMatch = html.match(/class="find_block"[^>]*>([\s\S]*?)(?:<\/div>|<script)/);
    if (!altMatch) {
      console.warn("[Search] Alternative pattern also not found");
      return results;
    }
  }

  const findBlock = findBlockMatch ? findBlockMatch[1] : html;
  console.log("[Search] find_block length:", findBlock?.length);

  // Parse each result item - more flexible pattern
  const itemMatches = findBlock.matchAll(
    /<div[^>]*>\s*(?:<span class="type_find">([^<]+)<\/span>\s*)?<a[^>]*href="[^"]*\?cat=(group|teacher|place|subject)(?:&amp;|&)id=([^"&]+)[^"]*">([^<]+)<\/a>\s*<\/div>/gi
  );

  let matchCount = 0;
  for (const match of itemMatches) {
    matchCount++;
    const typeLabel = (match[1] || "").trim();
    const type = match[2].trim() as "group" | "teacher" | "place" | "subject";
    const id = match[3].trim();
    const name = match[4].trim();
    const key = `${type}:${id}`;

    if (seen.has(key)) continue;
    seen.add(key);

    if (!type || !id || !name) {
      console.warn("[Search] Skipping invalid item:", { type, id, name });
      continue;
    }

    results.push({
      id,
      name,
      type,
      typeLabel: typeLabel || type,
    });
  }

  console.log("[Search] Parsed", results.length, "unique results from", matchCount, "matches");
  return results;
}

// Fetch timetable by category and ID
export async function fetchTimetableByCategory(
  category: string,
  id: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  console.log("[Search] fetchTimetableByCategory:", category, id);

  if (!isNativeApp()) {
    const res = await fetch("/api/timetable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, id }),
    });
    return await res.json();
  }

  try {
    // Native mode
    const page = await nativeRequestText({
      url: `https://kbp.by/rasp/timetable/view_beta_kbp/?page=stable&cat=${category}&id=${id}`,
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru,en;q=0.9",
        "Cache-Control": "no-cache",
      },
    });

    const timetableData = parseTimetableFromPage(page.data, id, category);
    console.log("[Search] Timetable parsed, pairs:", timetableData.pairs?.length);
    return { success: true, data: timetableData };
  } catch (err) {
    console.error("[Search] fetchTimetableByCategory error:", err);
    return { success: false, error: String(err) };
  }
}

function parseTimetableFromPage(html: string, id: string, category: string): any {
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s*-\s*Расписание КБП\s*/i, "").trim() : "";
  const data = parseTimetableHtml(html, id, title || `${category}-${id}`);
  data.id = id;
  data.category = category;
  if (title) data.title = title;
  return data;
}
