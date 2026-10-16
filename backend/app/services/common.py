import hashlib, json
from datetime import timezone
from sqlalchemy import select, func
from app.core.exceptions import fail


def digest(value):
    return hashlib.sha256(
        json.dumps(
            value,
            sort_keys=True,
            ensure_ascii=False,
            default=str,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()


def require(s, model, id, lock=False):
    query = select(model).where(model.id == str(id))
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    row = s.scalar(query)
    if row is None:
        raise fail("resource_not_found", "记录不存在", "storage.lookup")
    return row


def stamp(dt):
    return dt.replace(tzinfo=timezone.utc).isoformat() if dt else None


def row_dict(row):
    return {
        c.name: stamp(getattr(row, c.name))
        if c.type.python_type.__name__ == "datetime"
        else getattr(row, c.name)
        for c in row.__table__.columns
    }


def page(items, page=1, page_size=20):
    return {
        "items": items[(page - 1) * page_size : page * page_size],
        "total": len(items),
        "page": page,
        "page_size": page_size,
    }
