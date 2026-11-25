import { monitorEventLoopDelay } from 'node:perf_hooks';

const eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
eventLoopHistogram.enable();

let glitchTipErrors = 0;

export function recordGlitchTipError(): void {
  glitchTipErrors += 1;
}

export function getGlitchTipErrorCount(): number {
  return glitchTipErrors;
}

export interface EventLoopMetrics {
  p95Ms: number;
  maxMs: number;
  status: 'Healthy' | 'Degraded' | 'High';
}

export function getEventLoopMetrics(): EventLoopMetrics {
  const p95Ms = eventLoopHistogram.percentile(95) / 1_000_000;
  const maxMs = eventLoopHistogram.max / 1_000_000;
  eventLoopHistogram.reset();

  return {
    p95Ms: Number.isFinite(p95Ms) ? p95Ms : 0,
    maxMs: Number.isFinite(maxMs) ? maxMs : 0,
    status: p95Ms < 50 ? 'Healthy' : p95Ms < 200 ? 'Degraded' : 'High',
  };
}
