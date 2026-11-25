import { setFluxerMediaBase } from './cdn';

const DEFAULT_FLUXER_WEB = 'https://web.fluxer.app';
const DEFAULT_FLUXER_API = 'https://api.fluxer.app';
const DEFAULT_FLUXER_MEDIA = 'https://fluxerusercontent.com';
const DEFAULT_FLUXER_CLIENT_ID = '';

function trimBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export interface FluxerPublicInstance {
  api: string;
  web: string;
  media: string;
  clientId: string;
}

let endpoints: FluxerPublicInstance = {
  api: trimBaseUrl(import.meta.env.VITE_FLUXER_INSTANCE_API || DEFAULT_FLUXER_API),
  web: trimBaseUrl(import.meta.env.VITE_FLUXER_INSTANCE_WEB || DEFAULT_FLUXER_WEB),
  media: trimBaseUrl(import.meta.env.VITE_FLUXER_INSTANCE_MEDIA || DEFAULT_FLUXER_MEDIA),
  clientId: import.meta.env.VITE_FLUXER_CLIENT_ID || DEFAULT_FLUXER_CLIENT_ID,
};

setFluxerMediaBase(endpoints.media);

export function fluxerApiBaseUrl(): string {
  return endpoints.api;
}

export function fluxerWebBaseUrl(): string {
  return endpoints.web;
}

export function fluxerMediaBaseUrl(): string {
  return endpoints.media;
}

export function fluxerClientId(): string {
  return endpoints.clientId;
}

export async function loadInstanceEndpoints(): Promise<void> {
  try {
    const res = await fetch('/api/public/instance');
    if (!res.ok) return;
    const data = (await res.json()) as Partial<FluxerPublicInstance>;
    endpoints = {
      api: trimBaseUrl(data.api || endpoints.api),
      web: trimBaseUrl(data.web || endpoints.web),
      media: trimBaseUrl(data.media || endpoints.media),
      clientId: data.clientId || endpoints.clientId,
    };
    setFluxerMediaBase(endpoints.media);
  } catch {
    /* keep build-time defaults */
  }
}
