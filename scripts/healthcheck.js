// Healthcheck untuk Docker: exit 0 bila /health merespons 200 dan ok=true.
const port = Number(process.env.PORT || 8092);
const url = `http://127.0.0.1:${port}/health`;

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 4000);

try {
  const res = await fetch(url, { signal: controller.signal });
  const body = await res.json();
  clearTimeout(timer);
  if (res.ok && body.ok === true) {
    console.log(`ok port=${port} queue=${JSON.stringify(body.queue || {})}`);
    process.exit(0);
  }
  console.error(`unhealthy status=${res.status} body=${JSON.stringify(body)}`);
  process.exit(1);
} catch (err) {
  clearTimeout(timer);
  console.error(`healthcheck failed: ${err.message}`);
  process.exit(1);
}
