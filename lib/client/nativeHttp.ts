import { CapacitorHttp, HttpResponse } from "@capacitor/core";

export type NativeHttpResponse = {
  status: number;
  headers: Record<string, string>;
  data: string;
};

function normalizeHeaders(headers: HttpResponse["headers"]): Record<string, string> {
  if (!headers || typeof headers !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    out[String(k).toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return out;
}

export async function nativeRequestText(opts: {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  data?: string;
}): Promise<NativeHttpResponse> {
  console.log("[HTTP] Request:", opts.method, opts.url);

  type CapacitorHttpOptions = Parameters<typeof CapacitorHttp.request>[0];
  const options: CapacitorHttpOptions = {
    url: opts.url,
    method: opts.method,
    headers: opts.headers,
    responseType: "text",
  };

  // For POST requests with form data
  if (opts.method === "POST" && opts.data) {
    const ct = Object.entries(opts.headers || {}).find(([k]) => k.toLowerCase() === "content-type")?.[1] || "";
    if (ct.toLowerCase().includes("application/x-www-form-urlencoded")) {
      try {
        options.data = Object.fromEntries(new URLSearchParams(opts.data));
      } catch {
        options.data = opts.data;
      }
    } else {
      options.data = opts.data;
    }
  }

  try {
    const res = await CapacitorHttp.request(options);
    const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);

    console.log("[HTTP] Response status:", res.status, "len:", text?.length);

    return {
      status: res.status,
      headers: normalizeHeaders(res.headers),
      data: text,
    };
  } catch (err) {
    console.error("[HTTP] Request failed:", err);
    throw err;
  }
}
