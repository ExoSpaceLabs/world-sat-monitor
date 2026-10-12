from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path
import unittest

from app.orbital_provider import ProviderError
from app.space_track import ProviderDeferred, SpaceTrackProvider


RECORD = json.loads(Path("backend/tests/fixtures/celestrak_gp_mario.json").read_text())[0]


class FakeOpener:
    def __init__(self, *, fail_login=False, fail_query=False, records=None):
        self.calls = []
        self.fail_login = fail_login
        self.fail_query = fail_query
        self.records = records if records is not None else [RECORD]

    def open(self, request, timeout):
        self.calls.append((request, timeout))
        if request.full_url.endswith("/ajaxauth/login"):
            if self.fail_login:
                return BytesIO(b'{"Login":"Failed"}')
            return BytesIO(b'{"Login":"Success"}')
        if self.fail_query:
            return BytesIO(b"<html>session expired</html>")
        return BytesIO(json.dumps(self.records).encode("utf-8"))

    @property
    def gp_queries(self):
        return [request.full_url for request, _ in self.calls if "/class/gp/" in request.full_url]

    @property
    def logins(self):
        return [request for request, _ in self.calls if request.full_url.endswith("/ajaxauth/login")]


class SpaceTrackProviderTests(unittest.TestCase):
    def setUp(self):
        self.time = [100.0]
        self.opener = FakeOpener()
        self.provider = SpaceTrackProvider(
            "test-user", "test-password", opener=self.opener,
            clock=lambda: self.time[0], batch_size=80,
        )
        self.ids = {"NORAD_CAT_ID": "55123"}

    def test_fetch_latest_never_issues_per_satellite_http(self):
        with self.assertRaises(ProviderDeferred):
            self.provider.fetch_latest(self.ids)
        self.assertEqual(self.opener.calls, [])

    def test_authenticated_gp_json_is_normalized_from_batched_query(self):
        self.provider.prime([self.ids, self.ids, {"NORAD_CAT_ID": "55124"}])
        self.assertEqual(len(self.opener.logins), 1)
        self.assertEqual(len(self.opener.gp_queries), 1)
        self.assertIn("/class/gp/NORAD_CAT_ID/55123,55124/format/json", self.opener.gp_queries[0])
        elements = self.provider.fetch_latest(self.ids)
        self.assertEqual(elements.source, "spacetrack")
        self.assertEqual(elements.source_format, "OMM_JSON")
        self.assertEqual(elements.raw_payload["OBJECT_NAME"], "MARIO")
        self.assertEqual(len(self.opener.gp_queries), 1)
        with self.assertRaisesRegex(ProviderError, "no current GP"):
            self.provider.fetch_latest({"NORAD_CAT_ID": "55124"})

    def test_batch_cache_reused_and_refreshes_no_more_than_hourly(self):
        self.provider.prime([self.ids])
        self.provider.prime([self.ids])
        self.time[0] += 3599
        self.provider.prime([self.ids])
        self.assertEqual(len(self.opener.gp_queries), 1)
        self.time[0] += 2
        self.provider.prime([self.ids])
        self.assertEqual(len(self.opener.gp_queries), 2)
        self.assertEqual(len(self.opener.logins), 1)

    def test_new_objects_are_deferred_until_next_batch(self):
        self.provider.batch_size = 1
        self.provider.prime([self.ids, {"NORAD_CAT_ID": "55124"}])
        self.assertEqual(len(self.opener.gp_queries), 1)
        self.assertEqual(len(self.provider._records), 1)
        self.provider.prime([self.ids, {"NORAD_CAT_ID": "55124"}])
        self.assertEqual(len(self.opener.gp_queries), 2)
        self.assertEqual(len(self.provider._records), 2)

    def test_gp_omm_supports_nine_digit_catalog_ids(self):
        record = dict(RECORD, NORAD_CAT_ID=123456789)
        opener = FakeOpener(records=[record])
        provider = SpaceTrackProvider("user", "secret", opener=opener)
        provider.prime([{"NORAD_CAT_ID": "123456789"}])
        result = provider.fetch_latest({"NORAD_CAT_ID": "123456789"})
        self.assertEqual(result.raw_payload["NORAD_CAT_ID"], 123456789)
        self.assertIn("/NORAD_CAT_ID/123456789/format/json", opener.gp_queries[0])

    def test_invalid_identifier_is_rejected_before_network(self):
        for bad in ("", "-1", "abc", "1,2", "1000000000", "0"):
            with self.subTest(bad=bad), self.assertRaises(ProviderError):
                self.provider.fetch_latest({"NORAD_CAT_ID": bad})
        self.provider.prime([{"NORAD_CAT_ID": "1,2"}])
        self.assertEqual(self.opener.calls, [])

    def test_invalid_session_response_is_never_success(self):
        self.opener.fail_query = True
        with self.assertRaisesRegex(ProviderError, "invalid GP JSON"):
            self.provider.prime([self.ids])
        with self.assertRaises(ProviderError):
            self.provider.fetch_latest(self.ids)
        self.assertEqual(len(self.opener.gp_queries), 1)
        self.provider.prime([self.ids])
        self.assertEqual(len(self.opener.gp_queries), 1)  # 5-minute cooldown

    def test_bad_login_rejected_without_leaking_credentials(self):
        self.opener.fail_login = True
        with self.assertRaises(ProviderError) as caught:
            self.provider.prime([self.ids])
        self.assertNotIn("test-password", str(caught.exception))
        self.assertEqual(len(self.opener.gp_queries), 0)

    def test_budget_limits_queries_below_published_limits(self):
        self.provider.batch_size = 1
        all_ids = [{"NORAD_CAT_ID": str(n)} for n in range(1, 40)]
        for _ in range(30):
            self.provider.prime(all_ids)
        self.assertEqual(len(self.opener.gp_queries), 24)
        self.time[0] += 61
        self.provider.prime(all_ids)
        self.assertEqual(len(self.opener.gp_queries), 25)

    def test_enabled_adapter_does_not_accept_http_origin(self):
        with self.assertRaisesRegex(ProviderError, "HTTPS"):
            SpaceTrackProvider("x", "secret", base_url="http://example.test")


if __name__ == "__main__":
    unittest.main()
