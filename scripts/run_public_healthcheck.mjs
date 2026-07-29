#!/usr/bin/env node

const target = process.env.PUBLIC_APP_URL || 'https://tendencia-infra.vercel.app/';
const timeoutMs = 20_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchChecked(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': 'tendencia-production-healthcheck/1.0' },
  });
  assert(response.ok, `${url} respondeu HTTP ${response.status}`);
  return response;
}

const response = await fetchChecked(target);
const html = await response.text();
assert(/<title>[^<]*Tend/i.test(html), 'titulo esperado nao foi encontrado');
assert(/type=["']module["']/i.test(html), 'script principal nao foi encontrado');

for (const header of [
  'content-security-policy',
  'strict-transport-security',
  'x-content-type-options',
  'referrer-policy',
]) {
  assert(response.headers.has(header), `header obrigatorio ausente: ${header}`);
}

const scriptPath = html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)/i)?.[1];
assert(scriptPath, 'nao foi possivel identificar o asset principal');
const scriptUrl = new URL(scriptPath, response.url);
const scriptResponse = await fetchChecked(scriptUrl);
const script = await scriptResponse.text();
assert(script.length > 1000, 'asset principal parece vazio ou incompleto');

const robotsResponse = await fetchChecked(new URL('/robots.txt', response.url));
const robots = await robotsResponse.text();
assert(/user-agent:/i.test(robots), 'robots.txt invalido');

console.log(
  JSON.stringify({
    healthy: true,
    target: response.url,
    checkedAt: new Date().toISOString(),
    mainAssetBytes: script.length,
  }),
);
