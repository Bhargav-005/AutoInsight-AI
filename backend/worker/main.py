import logging
from pathlib import Path

from rq import Worker
from rq.serializers import JSONSerializer

from app.core.config import Settings
from app.core.logging import configure_logging, log_event
from worker.connection import queue, redis_connection


class SafeWorker(Worker):
    def handle_exception(self, job, *exc_info):
        category = exc_info[0].__name__
        job.meta["error_category"] = category
        job.save_meta()
        log_event("job_failed", job_id=job.id, category=category)

    def handle_job_failure(self, job, queue, started_job_registry=None, exc_string=""):
        if job.func_name == "worker.ml_jobs.train_model":
            from worker.ml_jobs import mark_failed

            try:
                mark_failed(*job.args)
            except Exception:
                log_event("ml_status_update_failed", job_id=job.id)
        # Preserve RQ failure results/retries, but never persist raw exception text.
        return super().handle_job_failure(
            job,
            queue,
            started_job_registry,
            exc_string=job.meta.get("error_category", "JobFailure"),
        )


if __name__ == "__main__":
    configure_logging()
    settings = Settings()
    connection = redis_connection(settings)
    # Blocking dequeue needs a timeout above the worker's dequeue interval.
    connection.connection_pool.connection_kwargs["socket_timeout"] = 60
    worker = SafeWorker(
        [queue(settings, connection)],
        connection=connection,
        serializer=JSONSerializer,
        worker_ttl=60,
        job_monitoring_interval=5,
        log_job_description=False,
    )
    Path("/tmp/autoinsight-worker-name").write_text(worker.name, encoding="utf-8")
    logging.getLogger("rq.worker").setLevel(logging.WARNING)
    worker.work(logging_level="WARNING")
