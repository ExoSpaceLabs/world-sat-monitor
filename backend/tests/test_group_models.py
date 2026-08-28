from __future__ import annotations

import unittest

from pydantic import ValidationError

from app.group_models import SatelliteGroupCreate, SatelliteGroupMemberAdd, SatelliteGroupUpdate


class SatelliteGroupModelTests(unittest.TestCase):
    def test_group_name_is_trimmed_and_custom_is_default(self):
        group = SatelliteGroupCreate(name="  Operator set  ")
        self.assertEqual(group.name, "Operator set")
        self.assertEqual(group.group_type, "custom")

    def test_supported_group_types_are_explicit(self):
        for group_type in ("constellation", "custom", "mission"):
            group = SatelliteGroupCreate(name="Group", group_type=group_type)
            self.assertEqual(group.group_type, group_type)
        with self.assertRaises(ValidationError):
            SatelliteGroupCreate(name="Group", group_type="folder")

    def test_group_patch_and_membership_metadata(self):
        patch = SatelliteGroupUpdate(name="  Renamed  ", metadata={"owner": "ops"})
        member = SatelliteGroupMemberAdd(satellite_id=42, metadata={"slot": "A"})
        self.assertEqual(patch.name, "Renamed")
        self.assertEqual(member.satellite_id, 42)
        self.assertEqual(member.metadata["slot"], "A")

    def test_member_requires_positive_satellite_id(self):
        with self.assertRaises(ValidationError):
            SatelliteGroupMemberAdd(satellite_id=0)


if __name__ == "__main__":
    unittest.main()
