const CRM_API_PREFIX = "/api/crm";

export function crmApiUrl(path: string) {
  if (!path.startsWith("/api/")) return path;
  return `${CRM_API_PREFIX}/${path.slice(5)}`;
}
