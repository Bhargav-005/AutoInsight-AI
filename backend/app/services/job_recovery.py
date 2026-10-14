"""Conservative reconciliation for owner-scoped document and report reads."""

from datetime import UTC, datetime, timedelta

from redis.exceptions import RedisError
from rq import Worker
from rq.exceptions import NoSuchJobError
from rq.job import Job
from rq.serializers import JSONSerializer


def abandoned_job(job_id, since, settings, redis) -> bool:
    """Require both an expired grace period and positive evidence of abandonment.

    An unavailable queue or a mapped busy worker is never grounds to fail a job.
    Queued/scheduled/deferred work may legitimately wait longer than its runtime.
    """
    if redis is None or since is None or not job_id:
        return False
    if since.tzinfo is None:
        since = since.replace(tzinfo=UTC)
    if datetime.now(UTC) - since < timedelta(seconds=settings.max_job_seconds + 60):
        return False
    try:
        if any(
            worker.get_state() == "busy" and worker.get_current_job_id() == job_id
            for worker in Worker.all(connection=redis)
        ):
            return False
        try:
            job = Job.fetch(job_id, connection=redis, serializer=JSONSerializer)
        except NoSuchJobError:
            return True
        status = job.get_status(refresh=True)
        return status is not None and status.value in {
            "failed",
            "stopped",
            "canceled",
            "finished",
            "started",
        }
    except (RedisError, OSError, TimeoutError):
        return False
