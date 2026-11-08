#!/usr/bin/env python3
"""Print Java proxy properties for Gradle without exposing proxy credentials."""

from __future__ import annotations

import os
import re
import sys
import urllib.parse
import urllib.request


def main() -> None:
    proxies = urllib.request.getproxies()
    value = proxies.get("https") or proxies.get("http")
    if not value:
        return
    proxy = urllib.parse.urlsplit(value)
    if proxy.username or proxy.password:
        raise RuntimeError("Gradle bootstrap does not accept credentialed proxy URLs")
    host = proxy.hostname or ""
    port = proxy.port
    if not re.fullmatch(r"[A-Za-z0-9.:-]+", host) or port is None:
        raise RuntimeError("Could not safely parse the current HTTP proxy host and port")

    properties = [f"-Dhttp.proxyHost={host}", f"-Dhttps.proxyHost={host}", f"-Dhttp.proxyPort={port}", f"-Dhttps.proxyPort={port}"]
    bypass = os.environ.get("NO_PROXY", os.environ.get("no_proxy", ""))
    hosts = []
    for item in bypass.split(","):
        item = item.strip()
        if not item:
            continue
        if item.startswith("."):
            item = "*" + item
        if re.fullmatch(r"[A-Za-z0-9.*:-]+", item):
            hosts.append(item)
    if hosts:
        values = "|".join(hosts)
        properties.extend((f"-Dhttp.nonProxyHosts={values}", f"-Dhttps.nonProxyHosts={values}"))
    print(" ".join(properties))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError) as error:
        print(f"native Gradle proxy setup failed: {error}", file=sys.stderr)
        raise SystemExit(1)
