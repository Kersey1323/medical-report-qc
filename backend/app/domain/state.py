from pydantic import BaseModel


class ReportSummary(BaseModel):
    completeness: str
    anomaly: str


def summarize_report(outcomes, selected, invalid=False):
    if invalid:
        return ReportSummary(completeness="invalid", anomaly="unknown")
    status = [o.status for o in outcomes]
    findings = [o.finding for o in outcomes]
    complete = len(status) == len(selected) and all(s == "succeeded" for s in status)
    completeness = (
        "complete"
        if complete
        else "partial"
        if "succeeded" in status
        else "cancelled"
        if "cancelled" in status
        else "failed"
        if status and all(s == "failed" for s in status)
        else "partial"
    )
    anomaly = (
        "issue"
        if "issue" in findings
        else "needs_review"
        if "needs_review" in findings
        else "normal"
        if complete and all(f == "no_issue" for f in findings)
        else "unknown"
    )
    return ReportSummary(completeness=completeness, anomaly=anomaly)


def summarize_run(counts, cancel_requested=False):
    if counts.get("running", 0) or counts.get("pending", 0):
        return "running"
    if counts.get("cancelled", 0):
        return "cancelled"
    if counts.get("failed", 0) or counts.get("invalid_rows", 0):
        return "partial" if counts.get("succeeded", 0) else "failed"
    return "completed"
