export interface LaunchStatus {
  mode: "live" | "fake";
  graphVersion: string | null;
  defaultTimezone: string;
  /** Whether Instagram could fetch media from the S3 endpoint: https on a public host. */
  mediaUrlPublic: boolean;
  /** Host (and port) of the media endpoint; never credentials. */
  mediaHost: string;
  /** App secret and verify token are both set, so Meta's webhook can be verified. */
  webhookConfigured: boolean;
}

export interface LaunchStatusInput {
  instagramMode: "live" | "fake";
  instagramGraphVersion: string | undefined;
  defaultTimezone: string;
  s3: { endpoint: string };
  meta: { appSecret?: string | undefined; webhookVerifyToken?: string | undefined };
}

function hostOf(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** True for an https URL whose host is not loopback, private, link-local or a bare name. */
export function isPublicHttpsUrl(url: string): boolean {
  const parsed = hostOf(url);
  if (!parsed || parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.startsWith("[") || host.endsWith(".local")) return false;
  if (!host.includes(".")) return false;
  const octets = host.split(".").map(Number);
  if (octets.length === 4 && octets.every((n) => Number.isInteger(n))) {
    const [a, b] = octets as [number, number, number, number];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
  }
  return true;
}

export function launchStatus(input: LaunchStatusInput): LaunchStatus {
  return {
    mode: input.instagramMode,
    graphVersion: input.instagramGraphVersion ?? null,
    defaultTimezone: input.defaultTimezone,
    mediaUrlPublic: isPublicHttpsUrl(input.s3.endpoint),
    mediaHost: hostOf(input.s3.endpoint)?.host ?? "",
    webhookConfigured: Boolean(input.meta.appSecret && input.meta.webhookVerifyToken),
  };
}
