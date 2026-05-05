import { NextResponse } from "next/server";

export function addCorsHeaders(response: NextResponse, origin?: string): NextResponse {
  // Разрешаем запросы с любых источников для разработки
  // В продакшене можно ограничить конкретными доменами
  const allowedOrigins = [
    "http://localhost:8082",
    "http://localhost:8081",
    "http://localhost:3000",
    "http://127.0.0.1:8082",
    "http://127.0.0.1:8081",
    "http://127.0.0.1:3000",
  ];

  const requestOrigin = origin || "*";
  const allowOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : "*";

  response.headers.set("Access-Control-Allow-Origin", allowOrigin);
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.headers.set("Access-Control-Allow-Credentials", "true");

  return response;
}

export function handleOptionsRequest(origin?: string): NextResponse {
  const response = new NextResponse(null, { status: 204 });
  return addCorsHeaders(response, origin);
}

