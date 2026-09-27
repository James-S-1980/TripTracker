const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);

try {
  const response = await fetch("http://127.0.0.1:8772/healthz", { signal: controller.signal });
  const body = await response.text();
  if (!response.ok) {
    console.error(`Health endpoint returned HTTP ${response.status}: ${body}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Health endpoint request failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
