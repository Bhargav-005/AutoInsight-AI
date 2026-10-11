"""RQ entrypoint for explicitly approved research plans."""

from app.services.research import run_research


def run_research_job(run_id: str, owner_id: str, approved_plan_hash: str) -> dict:
    return run_research(run_id, owner_id, approved_plan_hash)


def research_failure(job, connection, exc_type, exc_value, traceback):
    """Persist an RQ-level crash that happened outside a graph tool boundary."""
    from uuid import UUID

    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from app.core.config import Settings
    from app.db.models import ResearchRun
    from app.db.session import create_db_engine

    if not job or len(job.args or ()) < 2:
        return
    settings = Settings()
    engine = create_db_engine(settings, runtime=True)
    try:
        with Session(engine) as db, db.begin():
            run = db.scalar(
                select(ResearchRun)
                .where(
                    ResearchRun.id == UUID(job.args[0]),
                    ResearchRun.owner_id == UUID(job.args[1]),
                )
                .with_for_update()
            )
            if run and run.status in {"queued", "running"}:
                run.status = "failed"
                run.plan_json = {
                    **run.plan_json,
                    "failure": "Research execution stopped unexpectedly.",
                }
    finally:
        engine.dispose()
