import config from '@/config';

const DEFAULT_FLUXER_API = 'https://api.fluxer.app';
const DEFAULT_FLUXER_WEB = 'https://web.fluxer.app';
const DEFAULT_FLUXER_APP = 'https://fluxer.app';
const DEFAULT_FLUXER_MEDIA = 'https://fluxerusercontent.com';
const DEFAULT_FLUXER_CLIENT_ID = '1474069931333816428';
const BOT_PERMISSIONS = '4504699474930806';

function trimBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function hostnameOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const value = raw.includes('://') ? raw : `https://${raw}`;
    return new URL(value).hostname || null;
  } catch {
    return null;
  }
}

let discoveredMedia: string | null = null;
let discoveryAttempted = false;

export async function hydrateFluxerInstanceFromDiscovery(): Promise<void> {
  if (discoveryAttempted || config.instance?.media || !config.instance?.api) return;
  discoveryAttempted = true;
  try {
    const res = await fetch(`${fluxerApiOrigin()}/.well-known/fluxer`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return;
    const doc = (await res.json()) as { endpoints?: { media?: unknown } };
    if (typeof doc.endpoints?.media === 'string' && doc.endpoints.media.trim()) {
      discoveredMedia = trimBaseUrl(doc.endpoints.media);
    }
  } catch {
    /* hosted default stays */
  }
}

export function fluxerApiBaseUrl(): string {
  return trimBaseUrl(config.instance?.api || DEFAULT_FLUXER_API);
}

export function fluxerWebBaseUrl(): string {
  return trimBaseUrl(config.instance?.web || DEFAULT_FLUXER_WEB);
}

export function fluxerMediaBaseUrl(): string {
  return trimBaseUrl(config.instance?.media || discoveredMedia || DEFAULT_FLUXER_MEDIA);
}

export function fluxerApiUrl(pathname: string): string {
  return `${fluxerApiBaseUrl()}/${pathname.replace(/^\/+/, '')}`;
}

export function fluxerWebUrl(pathname: string): string {
  return `${fluxerWebBaseUrl()}/${pathname.replace(/^\/+/, '')}`;
}

export function fluxerAppUrl(pathname: string): string {
  const baseUrl = trimBaseUrl(config.instance?.web || DEFAULT_FLUXER_APP);
  return `${baseUrl}/${pathname.replace(/^\/+/, '')}`;
}

function fluxerOauthClientId(): string {
  if (config.fluxerOAuth?.clientId) return config.fluxerOAuth.clientId;
  return config.instance?.api ? '' : DEFAULT_FLUXER_CLIENT_ID;
}

export function fluxerBotInviteUrl(): string {
  const params = new URLSearchParams({
    client_id: fluxerOauthClientId(),
    scope: 'bot',
    permissions: BOT_PERMISSIONS,
  });
  return `${fluxerWebUrl('/oauth2/authorize')}?${params.toString()}`;
}

export function fluxerApiOrigin(): string {
  try {
    return new URL(fluxerApiBaseUrl()).origin;
  } catch {
    return DEFAULT_FLUXER_API;
  }
}

export function fluxerMediaOrigin(): string {
  try {
    return new URL(fluxerMediaBaseUrl()).origin;
  } catch {
    return DEFAULT_FLUXER_MEDIA;
  }
}

export function fluxerInstanceHosts(): string[] {
  const hosts = new Set<string>();
  for (const raw of [fluxerApiBaseUrl(), fluxerWebBaseUrl(), fluxerMediaBaseUrl(), config.instance?.gateway]) {
    const host = hostnameOf(raw);
    if (host) hosts.add(host);
  }
  return [...hosts];
}

export function fluxerAvatarAssetUrl(userId: string, avatar: string): string {
  return `${fluxerMediaBaseUrl()}/avatars/${userId}/${avatar}.webp?animated=false&size=64`;
}

export function fluxerPublicInstance(): {
  api: string;
  web: string;
  media: string;
  clientId: string;
} {
  return {
    api: fluxerApiBaseUrl(),
    web: fluxerWebBaseUrl(),
    media: fluxerMediaBaseUrl(),
    clientId: fluxerOauthClientId(),
  };
}

export function fluxerClientInstanceOptions(): {
  instance?: { api_public?: string; gateway?: string; media?: string; webapp?: string };
} {
  const instance: { api_public?: string; gateway?: string; media?: string; webapp?: string } = {};
  const media = config.instance?.media || discoveredMedia;
  if (config.instance?.api) instance.api_public = trimBaseUrl(config.instance.api);
  if (config.instance?.gateway) instance.gateway = config.instance.gateway;
  if (media) instance.media = trimBaseUrl(media);
  if (config.instance?.web) instance.webapp = trimBaseUrl(config.instance.web);
  return instance.api_public || instance.gateway || instance.media || instance.webapp ? { instance } : {};
}
