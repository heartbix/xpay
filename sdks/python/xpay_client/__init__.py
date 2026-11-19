"""Zero-dependency XPay HTTP 402 client."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Mapping, Optional

DEFAULT_HUB = "https://xpay.heartbix.com/api/hub"


class XpayError(RuntimeError):
    def __init__(self, message: str, status: int = 0, body: Any = None):
        super().__init__(message)
        self.status = status
        self.body = body


class XpayResponse:
    def __init__(self, status: int, data: Any, headers: Mapping[str, str]):
        self.status_code = status
        self._data = data
        self.headers = headers
        self.ok = 200 <= status < 300

    def json(self) -> Any:
        return self._data


class Client:
    def __init__(self, api_key: Optional[str] = None, hub: Optional[str] = None):
        self.api_key = api_key or os.environ.get("XPAY_API_KEY", "")
        self.hub = (hub or os.environ.get("XPAY_HUB") or os.environ.get("XPAY_HUB_URL") or DEFAULT_HUB).rstrip("/")

    def _hub(self, method: str, path: str, json_body: Any = None) -> Any:
        if not self.api_key:
            raise XpayError("XPAY_API_KEY missing")
        data = None
        headers = {"Accept": "application/json", "x-api-key": self.api_key}
        if json_body is not None:
            data = json.dumps(json_body).encode()
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.hub + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                raw = res.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            raw = e.read().decode()
            try:
                body = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                body = {"error": raw}
            raise XpayError(str(body.get("error") or e.code), status=e.code, body=body) from None

    def quote(self, url: str) -> dict:
        q = urllib.parse.urlencode({"url": url})
        return self._hub("GET", f"/x402/pay-url?{q}")

    def pay(self, url: str) -> dict:
        return self._hub("POST", "/x402/pay-url", {"url": url})

    def me(self) -> dict:
        return self._hub("GET", "/me")

    def create_endpoint(
        self,
        slug: str = "price1",
        price_atomic: Optional[str] = None,
        price_usdt: Optional[float] = None,
        description: str = "USDT micropayment via XPay x402",
    ) -> dict:
        atomic = price_atomic
        if atomic is None and price_usdt is not None:
            atomic = str(int(round(float(price_usdt) * 1_000_000)))
        return self._hub(
            "POST",
            "/merchants",
            {"slug": slug, "priceAtomic": atomic or "1000", "description": description},
        )

    def get(self, url: str, headers: Optional[Mapping[str, str]] = None) -> XpayResponse:
        hdrs = {"Accept": "application/json", **(headers or {})}
        req = urllib.request.Request(url, headers=hdrs, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                raw = res.read().decode()
                data = json.loads(raw) if raw else {}
                return XpayResponse(res.status, data, dict(res.headers))
        except urllib.error.HTTPError as e:
            raw = e.read().decode()
            try:
                data = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                data = {"error": raw}
            if e.code != 402:
                raise XpayError(str(data.get("error") or e.code), status=e.code, body=data) from None
            paid = self.pay(url)
            return XpayResponse(200, paid, {"content-type": "application/json", "x-xpay-paid": "1"})


_default = Client()


def xpay_get(url: str) -> XpayResponse:
    return Client().get(url)


def quote(url: str) -> dict:
    return Client().quote(url)


def pay(url: str) -> dict:
    return Client().pay(url)
