export type CatalogGroupDefinition = {
  provider: string;
  key: string;
  name: string;
  group_type: "constellation";
  available: boolean;
  local: {
    present: boolean;
    group_id: number | null;
    member_count: number;
    active_member_count: number;
  };
};

export type CatalogGroupImportResult = {
  provider: string;
  key: string;
  group: {
    id: number;
    name: string;
    member_count: number;
    active_member_count: number;
  };
  catalog_members: number;
  created_satellites: number;
  removed_memberships: number;
};
