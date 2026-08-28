import type {CatalogGroupDefinition, CatalogGroupImportResult} from "../domain/catalog-group";


type CatalogGroupsResponse = {
  provider: string;
  groups: CatalogGroupDefinition[];
};


type CatalogGroupSearchResponse = CatalogGroupsResponse & {
  query: string;
};


async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {"Content-Type": "application/json", ...(init?.headers ?? {})},
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
  }
  return response.json() as Promise<T>;
}


export async function listProviderCatalogGroups(): Promise<CatalogGroupDefinition[]> {
  return (await requestJson<CatalogGroupsResponse>("/api/v1/catalog/groups")).groups;
}


export async function searchProviderCatalogGroups(query: string): Promise<CatalogGroupDefinition[]> {
  const params = new URLSearchParams({q: query});
  return (await requestJson<CatalogGroupSearchResponse>(`/api/v1/catalog/groups/search?${params.toString()}`)).groups;
}


export function importProviderCatalogGroup(groupKey: string): Promise<CatalogGroupImportResult> {
  return requestJson<CatalogGroupImportResult>(
    `/api/v1/catalog/groups/${encodeURIComponent(groupKey)}/import`,
    {method: "POST"},
  );
}
