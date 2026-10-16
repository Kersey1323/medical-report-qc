from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from time import sleep
from uuid import uuid4
from redis import Redis
from app.clients.rate_limit import GlobalPermit


def test_shared_limit_and_renewal():
    r = Redis.from_url("redis://127.0.0.1:6379/9")
    prefix = "medical_qc:test:" + str(uuid4()) + ":"
    lock = Lock()
    current = 0
    maximum = 0

    def call(i):
        nonlocal current, maximum
        limiter = GlobalPermit(r, prefix)
        with limiter.hold(lease_s=1, heartbeat_s=0.15):
            with lock:
                current += 1
                maximum = max(current, maximum)
            sleep(1.1)
            with lock:
                current -= 1

    try:
        with ThreadPoolExecutor(6) as pool:
            list(pool.map(call, range(6)))
        assert maximum <= 2
    finally:
        keys = list(r.scan_iter(prefix + "*"))
        if keys:
            r.delete(*keys)
