"""Atomic Redis server-time permits shared by all online roles and workers."""

from contextlib import contextmanager
from threading import Event, Thread
from time import monotonic, sleep
from uuid import uuid4
from app.core.exceptions import fail

ACQUIRE = """
local t=redis.call('TIME');local now=t[1]*1000+math.floor(t[2]/1000)
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now)
if redis.call('ZCARD',KEYS[1]) < tonumber(ARGV[1]) then
 redis.call('ZADD',KEYS[1],now+tonumber(ARGV[2])*1000,ARGV[3]);redis.call('PEXPIRE',KEYS[1],tonumber(ARGV[2])*2000);return 1
end
return 0
"""
RENEW = """
if not redis.call('ZSCORE',KEYS[1],ARGV[1]) then return 0 end
local t=redis.call('TIME');local now=t[1]*1000+math.floor(t[2]/1000)
redis.call('ZADD',KEYS[1],now+tonumber(ARGV[2])*1000,ARGV[1]);redis.call('PEXPIRE',KEYS[1],tonumber(ARGV[2])*2000);return 1
"""


class Permit:
    def __init__(self, redis, key, owner, lease_s):
        self.redis = redis
        self.key = key
        self.owner = owner
        self.lease_s = lease_s

    def heartbeat(self):
        if not self.redis.eval(RENEW, 1, self.key, self.owner, self.lease_s):
            raise fail("permit_lost", "在线并发许可丢失", "online.permit")

    def release(self):
        self.redis.zrem(self.key, self.owner)


class GlobalPermit:
    def __init__(self, redis, prefix="medical_qc:"):
        self.redis = redis
        self.prefix = prefix

    def acquire(self, key="online", limit=2, lease_s=150, wait_s=900):
        owner = str(uuid4())
        key = self.prefix + "permits:" + key
        deadline = monotonic() + wait_s
        while monotonic() < deadline:
            if self.redis.eval(ACQUIRE, 1, key, limit, lease_s, owner):
                return Permit(self.redis, key, owner, lease_s)
            sleep(0.1)
        raise fail("queue_full", "等待在线调用许可超时", "online.permit", True)

    @contextmanager
    def hold(self, lease_s=150, heartbeat_s=15):
        permit = self.acquire(lease_s=lease_s)
        done = Event()
        errors = []

        def renew():
            while not done.wait(heartbeat_s):
                try:
                    permit.heartbeat()
                except Exception as exc:
                    errors.append(exc)
                    return

        thread = Thread(target=renew, daemon=True)
        thread.start()
        try:
            yield permit
            if errors:
                raise errors[0]
        finally:
            done.set()
            thread.join(timeout=5)
            permit.release()
