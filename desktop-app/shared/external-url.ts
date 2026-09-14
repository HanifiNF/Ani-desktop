export function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return Boolean(url.hostname);
    return url.protocol === "mailto:" && Boolean(url.pathname) && url.pathname.includes("@");
  } catch {
    return false;
  }
}
